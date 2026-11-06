/**
 * GitlabWebhookService — a GitLab webhook delivery becomes the same events the
 * `gitlab` source connector emits when it polls, only sooner.
 *
 * The route (`app/api/webhooks/gitlab/route.ts`) hands over the raw body and
 * headers; this service checks the secret, finds every enabled `gitlab`
 * source that lists the delivery's project on the delivery's instance, maps
 * the delivery with each source's own settings (deploy branch, branch prefix)
 * and emits through `EventService`. The dedupe keys are the connector's
 * (`gitlab:…`), so a delivery and the next poll never fire an automation twice.
 *
 * One secret per deployment (`GITLAB_WEBHOOK_SECRET`), as GitHub's is: GitLab
 * sends it verbatim in `X-Gitlab-Token` (it does not sign the body), the check
 * is constant-time, and the workspace is found from the payload's project.
 *
 * WHAT IS READ FROM THE API, AND WHY. A merge request hook names the actor,
 * not the author, and carries no head pipeline; a pipeline hook names a
 * pipeline, not the jobs that are its checks; an approval hook carries no
 * note id, which is what the poll keys an approval on. So, with the source's
 * own credential, the receiver reads the merge request whole, the head
 * pipeline's jobs, and the approval notes — and builds the event from what it
 * read, exactly as the poll would. A source with no credential still gets the
 * lifecycle events built from the hook; its checks and approvals arrive with
 * the next poll.
 *
 * Dependencies are injected so the mapping and the fan-out can be tested
 * without a database; the route passes the real ones.
 */

import type { GithubEvent } from '@/libs/github/events';
import type { GitlabClient } from '@/libs/gitlab/client';
import type { GitlabMergeRequest, GitlabNote } from '@/libs/gitlab/events';
import type { GitlabConfig } from '@/libs/sources/gitlab';
import { matchesBranchPrefix } from '@/libs/github/events';
import { createGitlabClient, hostOfBaseUrl, projectId } from '@/libs/gitlab/client';
import { eventForMergeRequestAction, eventsFromGitlabWebhook, mergeRequestChecksEvent, mergeRequestReviewEvents, verifyGitlabToken } from '@/libs/gitlab/events';
import { gitlabConfigSchema, headPipelineJobs } from '@/libs/sources/gitlab';

/** A `gitlab` source that lists the delivery's project. */
export type GitlabSourceRef = {
  orgId: string;
  sourceId: number;
  apiTokenId: string | null;
  config: GitlabConfig;
};

export type GitlabWebhookDeps = {
  /** Every enabled `gitlab` source, across orgs, whose `projects` names this project on this instance host. */
  sourcesForProject: (project: string, host: string | null) => Promise<GitlabSourceRef[]>;
  /** A client on the source's instance with its credential (refreshed first when it is a login), or null when it holds none. */
  clientFor: (source: GitlabSourceRef) => Promise<GitlabClient | null>;
  emit: (orgId: string, sourceId: number, event: GithubEvent) => Promise<void>;
};

export type GitlabWebhookOutcome = { status: number; body: Record<string, unknown> };

/** How far back an approval note may be and still be the one this delivery is about. */
const APPROVAL_WINDOW_MS = 10 * 60_000;

async function defaultDeps(): Promise<GitlabWebhookDeps> {
  const { db } = await import('@/libs/DB');
  const { sql } = await import('drizzle-orm');
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const { emitEvent } = await import('@/services/EventService');
  const { resolveGitlabAccess } = await import('@/libs/gitlab/token');
  return {
    async sourcesForProject(project, host) {
      const rows = await db
        .select({ id: knowledgeSourceSchema.id, orgId: knowledgeSourceSchema.orgId, configJson: knowledgeSourceSchema.configJson, apiTokenId: knowledgeSourceSchema.apiTokenId, enabled: knowledgeSourceSchema.enabled })
        .from(knowledgeSourceSchema)
        .where(sql`${knowledgeSourceSchema.kind} = 'gitlab' or ${knowledgeSourceSchema.configJson} ->> '_connector' = 'gitlab'`);
      const wanted = project.toLowerCase();
      const refs: GitlabSourceRef[] = [];
      for (const row of rows) {
        if (row.enabled === 'false') {
          continue;
        }
        const parsed = gitlabConfigSchema.safeParse(row.configJson);
        if (parsed.success && parsed.data.projects.some(p => p.toLowerCase() === wanted) && (host === null || hostOfBaseUrl(parsed.data.baseUrl) === host)) {
          refs.push({ orgId: row.orgId, sourceId: row.id, apiTokenId: row.apiTokenId, config: parsed.data });
        }
      }
      return refs;
    },
    async clientFor(source) {
      const credentials = await getCredentialsForConnector({ orgId: source.orgId, connectorSlug: 'gitlab', apiTokenId: source.apiTokenId }).catch(() => undefined);
      const access = await resolveGitlabAccess(credentials as Record<string, unknown> | undefined, { kind: 'persist', orgId: source.orgId, sourceId: source.sourceId, warn: message => console.warn('[gitlab webhook]', message) }, source.config.baseUrl).catch(() => null);
      return access ? createGitlabClient({ token: access.token, baseUrl: access.baseUrl, maxRetries: 1 }) : null;
    },
    async emit(orgId, sourceId, event) {
      // Background: GitLab gives a delivery ten seconds before it counts as failed.
      await emitEvent({ orgId, type: event.type, payload: event.payload, dedupeKey: event.dedupeKey, invokedBy: `webhook:gitlab:${sourceId}`, dispatchMode: 'background' });
    },
  };
}

/**
 * `pr.checks_completed` for a merge request, read whole with its head pipeline's jobs.
 * @param client - The source's client.
 * @param project - The project path.
 * @param iid - The merge request.
 */
async function hydrateChecks(client: GitlabClient, project: string, iid: number): Promise<GithubEvent | null> {
  const mr = await client.get<GitlabMergeRequest>(`/projects/${projectId(project)}/merge_requests/${iid}`);
  if (!mr.ok || mr.data.state !== 'opened') {
    return null;
  }
  const jobs = await headPipelineJobs(client, project, mr.data);
  return jobs.ok && jobs.jobs ? mergeRequestChecksEvent(project, mr.data, jobs.jobs) : null;
}

/**
 * Handle one delivery end to end. Never throws for a bad delivery: the
 * outcome carries the status the route should answer with.
 * @param input - The raw delivery.
 * @param input.rawBody - The body exactly as received.
 * @param input.headers - The request headers.
 * @param input.secret - `GITLAB_WEBHOOK_SECRET`.
 * @param deps - Injected for tests; the route passes none.
 * @param now - The clock, for the approval window.
 */
export async function handleGitlabWebhook(
  input: { rawBody: string; headers: Headers; secret: string | undefined },
  deps?: GitlabWebhookDeps,
  now: Date = new Date(),
): Promise<GitlabWebhookOutcome> {
  const verified = verifyGitlabToken(input.headers.get('x-gitlab-token'), input.secret);
  if (!verified.ok) {
    return { status: verified.reason === 'missing_secret' ? 501 : 401, body: { error: `token check failed: ${verified.reason}` } };
  }
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: 'body is not JSON' } };
  }
  const eventName = input.headers.get('x-gitlab-event') ?? '';
  const probe = eventsFromGitlabWebhook(eventName, body, 'main');
  if (!probe) {
    return { status: 200, body: { ok: true, ignored: 'delivery names no project' } };
  }
  const resolved = deps ?? (await defaultDeps());
  const sources = await resolved.sourcesForProject(probe.project, probe.host);
  if (sources.length === 0) {
    return { status: 200, body: { ok: true, ignored: `no gitlab source lists ${probe.project}` } };
  }

  let emitted = 0;
  for (const source of sources) {
    const mapping = eventsFromGitlabWebhook(eventName, body, source.config.deployBranch)!;
    const id = projectId(mapping.project);
    const needsApi = mapping.mergeRequest !== null || mapping.checksFor.length > 0 || mapping.branchPipeline !== null;
    const client = needsApi ? await resolved.clientFor(source) : null;
    let events = [...mapping.events];

    if (mapping.mergeRequest && client) {
      // Read whole: the author, the head, the state, the same payload the poll builds.
      const mr = await client.get<GitlabMergeRequest>(`/projects/${id}/merge_requests/${mapping.mergeRequest.iid}`);
      if (mr.ok) {
        const action = mapping.mergeRequest.action;
        if (action === 'approved' || action === 'unapproved' || action === 'approval' || action === 'unapproval') {
          const notes = await client.get<GitlabNote[]>(`/projects/${id}/merge_requests/${mr.data.iid}/notes`, { sort: 'desc', order_by: 'created_at', per_page: '20' });
          events = notes.ok ? mergeRequestReviewEvents(mapping.project, mr.data, notes.data, new Date(now.getTime() - APPROVAL_WINDOW_MS)) : [];
        } else {
          const pushed = Boolean((body as { object_attributes?: { oldrev?: string } }).object_attributes?.oldrev);
          const event = eventForMergeRequestAction(mapping.project, action, mr.data, pushed);
          events = event ? [event] : [];
        }
      }
    }
    for (const want of mapping.checksFor) {
      const event = client ? await hydrateChecks(client, mapping.project, want.iid) : null;
      if (event) {
        events.push(event);
      }
    }
    if (mapping.branchPipeline && client) {
      // A branch pipeline names no merge request: the open ones from that branch, on that head, are the ones it checked.
      const open = await client.get<GitlabMergeRequest[]>(`/projects/${id}/merge_requests`, { state: 'opened', source_branch: mapping.branchPipeline.ref });
      for (const mr of open.ok ? open.data : []) {
        if (mr.sha === mapping.branchPipeline.sha) {
          const event = await hydrateChecks(client, mapping.project, mr.iid);
          if (event) {
            events.push(event);
          }
        }
      }
    }

    // A deploy-branch run is the pipeline's, whatever the branch prefix says.
    for (const event of events.filter(e => e.type === 'run.failed' || e.type === 'run.succeeded' || matchesBranchPrefix(String(e.payload.branch ?? ''), source.config.branchPrefix))) {
      await resolved.emit(source.orgId, source.sourceId, event);
      emitted += 1;
    }
  }
  return { status: 200, body: { ok: true, emitted } };
}
