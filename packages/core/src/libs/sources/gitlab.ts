/**
 * GitLab connector — merge requests, pipelines, approvals and merges on the
 * projects a workspace lists, on gitlab.com or a self-managed instance,
 * turned into the same events the `github` connector emits.
 *
 * A team whose code lives on GitLab gets the software factory the way a
 * GitHub team does: the factory's automations fire on `pr.opened`,
 * `pr.checks_completed`, `pr.review_submitted`, `pr.merged`, `run.failed`,
 * whichever host carried the news, because this connector maps GitLab's
 * constructs onto the one event vocabulary (`libs/gitlab/events.ts`) — a merge
 * request is a pull request, a pipeline's jobs are its checks, an approval is
 * a review, a pipeline on the deploy branch is a run. Dedupe keys start
 * `gitlab:`. Like GitHub's, it is about events, not knowledge: one small
 * searchable document per merge request is the whole mirror.
 *
 * Auth: a personal, project or group access token in `ctx.credentials.token`
 * (the `gitlab` platform descriptor). `read_api` is all the poll needs; the
 * repo family's writes (a comment, an approval, a merge, a pipeline change)
 * need `api`, and Test connection says which the token holds. Incremental:
 * `ctx.since` is the previous run's cutoff and GitLab filters by
 * `updated_after` itself; a first run (or a full sync) looks back
 * `lookbackDays`. A project that cannot be read is reported and the rest
 * carry on, which holds the watermark back, as GitHub's does.
 *
 * Project paths can be nested (`group/subgroup/project`); every request names
 * the project by its whole path, URL-encoded (`libs/gitlab/client.projectId`).
 *
 * The webhook receiver at `app/api/webhooks/gitlab/route.ts` posts the same
 * events sooner; the poll is what makes a missed delivery harmless.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { GithubEvent } from '@/libs/github/events';
import type { GitlabClient } from '@/libs/gitlab/client';
import type { GitlabJob, GitlabMergeRequest, GitlabNote, GitlabPipeline } from '@/libs/gitlab/events';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { testConnectionPersistence } from '@/libs/connect/loginGrant';
import { matchesBranchPrefix } from '@/libs/github/events';
import { createGitlabClient, GITLAB_URL, isProjectPath, projectId } from '@/libs/gitlab/client';
import { mergeRequestChecksEvent, mergeRequestLifecycleEvents, mergeRequestReviewEvents, pipelineRunEvent } from '@/libs/gitlab/events';
import { resolveGitlabAccess } from '@/libs/gitlab/token';
import { InspectInputError } from './inspect';

export const gitlabConfigSchema = z.object({
  /**
   * The projects to watch, as their paths (`group/project`, or nested
   * `group/subgroup/project`). Checked per entry when read, so Test
   * connection names the one entry that is malformed.
   */
  projects: z.array(z.string().trim().min(1)).min(1, 'list at least one project'),
  /** Only merge requests whose source branch starts with this are watched. Empty means every branch. */
  branchPrefix: z.string().trim().optional(),
  /** The branch whose finished pipelines become `run.failed` / `run.succeeded` — the deploy pipeline. */
  deployBranch: z.string().trim().min(1).default('main'),
  /** How far back a first run, or a full sync, looks. */
  lookbackDays: z.number().int().positive().max(90).default(7),
  /** The instance: gitlab.com, or a self-managed host such as `https://gitlab.northwind.example`. */
  baseUrl: z.string().url().default(GITLAB_URL),
});

export type GitlabConfig = z.infer<typeof gitlabConfigSchema>;

/** How many pages of merge requests one project may walk per sync. 100 per page. */
const MAX_MR_PAGES = 5;

/**
 * The searchable document for one merge request. Its metadata carries the
 * keys the GitHub source writes for a pull request (`kind: pull_request`,
 * `repo`, `number`, `state`, `headSha`, …), so search, facets and the
 * factory read both hosts alike.
 * @param project - The project path.
 * @param mr - The merge request.
 */
export function mergeRequestDoc(project: string, mr: GitlabMergeRequest): IngestDoc {
  const state = mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed';
  return {
    externalId: `mr:${project}!${mr.iid}`,
    title: `${project}!${mr.iid}: ${mr.title}`,
    content: [
      `${project}!${mr.iid} — ${mr.title}`,
      `State: ${state}`,
      `Branch: ${mr.source_branch} → ${mr.target_branch}`,
      `Author: ${mr.author?.username ?? ''}`,
      mr.web_url,
    ].join('\n'),
    uri: mr.web_url,
    lastModifiedAt: new Date(mr.updated_at),
    metadata: {
      kind: 'pull_request',
      host: 'gitlab',
      repo: project,
      number: mr.iid,
      state,
      url: mr.web_url,
      headSha: mr.sha,
      branch: mr.source_branch,
      baseBranch: mr.target_branch,
      author: mr.author?.username ?? '',
      requestedReviewers: (mr.reviewers ?? []).map(r => r?.username ?? '').filter(Boolean),
      draft: mr.draft === true,
      mergeSha: mr.merge_commit_sha ?? mr.squash_commit_sha ?? undefined,
      mergedAt: mr.merged_at ?? undefined,
      closedAt: mr.closed_at ?? undefined,
    },
  };
}

/**
 * The window one run asks GitLab for.
 * @param since - `ctx.since`.
 * @param lookbackDays - The configured look-back.
 * @param now - The clock, injectable for tests.
 */
function windowStart(since: Date | null | undefined, lookbackDays: number, now: Date = new Date()): Date {
  return since ?? new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

/**
 * The jobs of a merge request's head pipeline, when it runs on the head the
 * merge request has now; null when there is no such pipeline yet. The
 * pipeline may run in the source project (a fork), which is why its own
 * `project_id` is used.
 * @param client - A client on the instance.
 * @param project - The target project's path.
 * @param mr - The merge request, read whole.
 */
export async function headPipelineJobs(client: GitlabClient, project: string, mr: GitlabMergeRequest): Promise<{ ok: true; jobs: GitlabJob[] | null } | { ok: false; message: string }> {
  const pipeline = mr.head_pipeline;
  if (!pipeline || pipeline.sha !== mr.sha) {
    return { ok: true, jobs: null };
  }
  const where = pipeline.project_id ? String(pipeline.project_id) : projectId(project);
  const jobs = await client.list<GitlabJob>(`/projects/${where}/pipelines/${pipeline.id}/jobs`, {}, { maxPages: 3 });
  return jobs.ok ? { ok: true, jobs: jobs.data } : { ok: false, message: jobs.message };
}

type ProjectPoll = { events: GithubEvent[]; docs: IngestDoc[] };

/**
 * Poll one project: the merge requests updated inside the window, their head
 * pipeline's jobs and their approvals, and the finished pipelines on the
 * deploy branch. Throws on the first request GitLab refuses.
 * @param client - A client bound to the source's token and instance.
 * @param project - The project path.
 * @param cfg - The parsed config.
 * @param since - Start of the window.
 * @param onSkipped - Told about a merge request the branch filter dropped.
 */
export async function pollProject(
  client: GitlabClient,
  project: string,
  cfg: GitlabConfig,
  since: Date,
  onSkipped?: (uri: string, message: string) => void,
): Promise<ProjectPoll> {
  if (!isProjectPath(project)) {
    throw new Error(`${project} is not a project: write its path, group/project (or group/subgroup/project)`);
  }
  const id = projectId(project);
  const out: ProjectPoll = { events: [], docs: [] };

  const mrs = await client.list<GitlabMergeRequest>(`/projects/${id}/merge_requests`, {
    state: 'all',
    order_by: 'updated_at',
    sort: 'desc',
    updated_after: since.toISOString(),
  }, { maxPages: MAX_MR_PAGES, stop: page => page.length > 0 && new Date(page[page.length - 1]!.updated_at) < since });
  if (!mrs.ok) {
    throw new Error(`${project}: merge requests could not be listed — ${mrs.message}`);
  }

  for (const listed of mrs.data) {
    if (new Date(listed.updated_at) < since) {
      continue;
    }
    if (!matchesBranchPrefix(listed.source_branch, cfg.branchPrefix)) {
      onSkipped?.(listed.web_url, `branch ${listed.source_branch} is outside the ${cfg.branchPrefix} prefix`);
      continue;
    }
    // The list omits the head pipeline; one read of the merge request has it.
    const one = await client.get<GitlabMergeRequest>(`/projects/${id}/merge_requests/${listed.iid}`);
    const mr = one.ok ? one.data : listed;
    out.docs.push(mergeRequestDoc(project, mr));
    out.events.push(...mergeRequestLifecycleEvents(project, mr, since));

    if (mr.state === 'opened') {
      const jobs = await headPipelineJobs(client, project, mr);
      if (!jobs.ok) {
        throw new Error(`${project}!${mr.iid}: pipeline jobs could not be read — ${jobs.message}`);
      }
      const checks = jobs.jobs ? mergeRequestChecksEvent(project, mr, jobs.jobs) : null;
      if (checks) {
        out.events.push(checks);
      }
    }

    const notes = await client.list<GitlabNote>(`/projects/${id}/merge_requests/${mr.iid}/notes`, { sort: 'desc', order_by: 'created_at' }, {
      maxPages: 2,
      stop: page => page.length > 0 && new Date(page[page.length - 1]!.created_at) < since,
    });
    if (!notes.ok) {
      throw new Error(`${project}!${mr.iid}: notes could not be read — ${notes.message}`);
    }
    out.events.push(...mergeRequestReviewEvents(project, mr, notes.data, since));
  }

  // The deploy pipeline: finished pipelines on the deploy branch inside the window.
  const pipelines = await client.get<GitlabPipeline[]>(`/projects/${id}/pipelines`, {
    ref: cfg.deployBranch,
    updated_after: since.toISOString(),
    per_page: '100',
  });
  if (!pipelines.ok) {
    throw new Error(`${project}: pipelines on ${cfg.deployBranch} could not be listed — ${pipelines.message}`);
  }
  for (const pipeline of pipelines.data ?? []) {
    const event = pipelineRunEvent(project, pipeline);
    if (event) {
      out.events.push(event);
    }
  }
  return out;
}

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: is the token accepted, which scopes does it hold, and can
 * it read each project's merge requests and pipelines. Nothing is stored.
 * @param input - Token, projects and instance.
 * @param input.token - The access token.
 * @param input.projects - Project paths.
 * @param input.baseUrl - The instance.
 */
export async function inspectGitlabToken(input: { token: string; projects: string[]; baseUrl?: string }): Promise<ConnectorInspection> {
  const client = createGitlabClient({ token: input.token, baseUrl: input.baseUrl, maxRetries: 0 });
  const checks: ConnectorCheck[] = [];

  // Every access token can read itself; a 404 here is an older instance.
  const self = await client.get<{ name?: string; scopes?: string[]; expires_at?: string | null }>('/personal_access_tokens/self');
  let scopes: string[] | null = null;
  if (self.ok) {
    scopes = self.data.scopes ?? [];
  } else {
    // Fall back to who the token is, which any read token answers.
    const user = await client.get<{ username?: string }>('/user');
    if (!user.ok) {
      const unreachable = user.status === 0;
      checks.push(check('auth', 'Token accepted', false, user.message));
      return { reachable: !unreachable, authorized: !unreachable && user.status !== 401, checks, note: null, error: user.message };
    }
  }
  if (self.ok) {
    const canWrite = scopes!.includes('api');
    const canRead = canWrite || scopes!.includes('read_api');
    checks.push(check('auth', 'Token accepted', true, `${client.baseUrl} accepted the token "${self.data.name ?? ''}"; scopes: ${scopes!.join(', ') || '(none)'}${self.data.expires_at ? `; expires ${self.data.expires_at}` : ''}.`));
    checks.push(check('scope:read', 'Can read (read_api)', canRead, canRead ? 'The poll can read merge requests, pipelines and notes.' : 'Add the read_api scope: the poll reads merge requests, pipelines and notes.'));
    checks.push(check('scope:write', 'Can write (api)', canWrite, canWrite ? 'Agents can comment, approve, merge and open merge requests, through their actions.' : 'Read-only: agents can read, but a comment, an approval, a merge or a pipeline change needs the api scope.'));
  } else {
    checks.push(check('auth', 'Token accepted', true, `${client.baseUrl} accepted the token; this instance does not list a token's scopes, so each read below is the check.`));
  }

  for (const project of input.projects) {
    if (!isProjectPath(project)) {
      checks.push(check(`project:${project}`, `${project} reachable`, false, 'Not a project: write its path, group/project (or group/subgroup/project).'));
      continue;
    }
    const id = projectId(project);
    const meta = await client.get<{ default_branch?: string | null; visibility?: string; path_with_namespace?: string }>(`/projects/${id}`);
    checks.push(check(`project:${project}`, `${project} reachable`, meta.ok, meta.ok ? `Default branch ${meta.data.default_branch ?? '?'}, ${meta.data.visibility ?? 'unknown'} visibility.` : meta.message));
    if (!meta.ok) {
      continue;
    }
    const mrs = await client.get<unknown[]>(`/projects/${id}/merge_requests`, { state: 'all', per_page: '1' });
    checks.push(check(`mrs:${project}`, `${project} merge requests`, mrs.ok, mrs.ok ? 'Readable.' : mrs.message));
    const pipelines = await client.get<unknown[]>(`/projects/${id}/pipelines`, { per_page: '1' });
    checks.push(check(`pipelines:${project}`, `${project} pipelines`, pipelines.ok, pipelines.ok ? 'Readable.' : `${pipelines.message} Pipelines need CI/CD on the project and a member role of Reporter or above.`));
  }

  return {
    reachable: true,
    authorized: true,
    checks,
    note: 'Nothing was saved by this test: no source row, no credential, no vault write.',
    error: null,
  };
}

/**
 * Dispatch one event through `EventService` for the source's org, imported
 * lazily for the reason the GitHub source gives.
 * @param orgId - The source's org.
 * @param sourceId - The source, named in `invokedBy`.
 * @param event - What to emit.
 */
async function dispatch(orgId: string, sourceId: number, event: GithubEvent): Promise<void> {
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({ orgId, type: event.type, payload: event.payload, dedupeKey: event.dedupeKey, invokedBy: `source:gitlab:${sourceId}` });
}

export const gitlabConnector: SourceConnector<typeof gitlabConfigSchema> = {
  slug: 'gitlab',
  name: 'GitLab',
  description: 'Merge requests, pipelines and deploys from the GitLab projects you choose, on gitlab.com or your own instance. Pipelines, approvals, merges and failed deploys arrive as events automations act on, with one searchable document per merge request.',
  icon: 'GitPullRequest',
  category: 'engineering',
  brand: 'gitlab',
  authKind: 'apikey',
  configSchema: gitlabConfigSchema,
  requiredScopes: ['read_api', 'api (for agents\' writes)'],
  inspectNote: 'Reads the token\'s own scopes, then one merge request and one pipeline per project to prove the token reaches each. Nothing is saved.',

  async inspect({ config, credentials, savedSource }) {
    const configured = typeof config.baseUrl === 'string' && config.baseUrl.trim() !== '' ? config.baseUrl.trim() : null;
    const access = await resolveGitlabAccess(credentials, testConnectionPersistence('gitlab', savedSource), configured);
    if (!access) {
      throw new InspectInputError('A GitLab login is required: Connect with GitLab, or paste a personal, project or group access token with read_api (api for agents\' writes).');
    }
    const parsed = gitlabConfigSchema.pick({ projects: true, baseUrl: true }).safeParse({
      projects: Array.isArray(config.projects) ? config.projects : [],
      baseUrl: access.baseUrl,
    });
    if (!parsed.success) {
      throw new InspectInputError(parsed.error.issues[0]?.message ?? 'Projects are written as their paths, group/project, one or more.');
    }
    return inspectGitlabToken({ token: access.token, projects: parsed.data.projects, baseUrl: parsed.data.baseUrl });
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = gitlabConfigSchema.parse(ctx.config);
    const access = await resolveGitlabAccess(ctx.credentials, { kind: 'persist', orgId: ctx.orgId, sourceId: ctx.sourceId, warn: message => ctx.onProgress?.({ kind: 'error', message }) }, cfg.baseUrl);
    if (!access) {
      throw new Error('GitLab connector needs a GitLab login (Connect with GitLab) or an access token in credentials.token');
    }
    const client = createGitlabClient({ token: access.token, baseUrl: access.baseUrl });
    const since = windowStart(ctx.since, cfg.lookbackDays);

    for (const project of cfg.projects) {
      let poll: ProjectPoll;
      try {
        poll = await pollProject(client, project, cfg, since, (uri, message) => ctx.onProgress?.({ kind: 'skipped', uri, message }));
      } catch (err) {
        ctx.onProgress?.({ kind: 'error', uri: project, message: err instanceof Error ? err.message : String(err) });
        continue;
      }
      for (const event of poll.events) {
        try {
          await dispatch(ctx.orgId, ctx.sourceId, event);
        } catch (err) {
          ctx.onProgress?.({ kind: 'error', uri: event.dedupeKey, message: `event ${event.type} could not be dispatched: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      for (const doc of poll.docs) {
        ctx.onProgress?.({ kind: 'fetched', uri: doc.uri });
        yield doc;
      }
    }
  },
};
