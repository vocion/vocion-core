/**
 * GithubWebhookService — a GitHub webhook delivery becomes the same events the
 * `github` source connector emits when it polls, only sooner.
 *
 * The route (`app/api/webhooks/github/route.ts`) hands over the raw body and
 * headers; this service verifies the signature, finds every `github` source
 * that lists the delivery's repository, maps the delivery with each source's
 * own settings (deploy branch, branch prefix) and emits through
 * `EventService`. The dedupe keys are the connector's, so a delivery and the
 * next poll never fire an automation twice.
 *
 * One GitHub webhook secret per deployment (`GITHUB_WEBHOOK_SECRET`), like
 * the Slack signing secret: GitHub signs every delivery with it and a
 * workspace owns its repositories by listing them on a source, so the org is
 * resolved from the repository rather than from anything in the URL. The
 * deployment's GitHub App uses the same secret for its own webhook, so a
 * delivery from the app and one from a repository hook verify alike; one
 * secret is enough because the secret authenticates GitHub, not a workspace,
 * and the workspace is found from the payload.
 *
 * A delivery from the app also carries `installation.id`. A source whose
 * credential is a different installation is skipped — it connected another
 * organization's copy of the app — while a source holding a pasted token
 * keeps receiving by repository name, as before.
 *
 * A `check_suite` delivery carries neither the pull request's title nor the
 * names of the checks, so those are read from the API with the source's own
 * vaulted token. A source without a credential still gets the lifecycle
 * events; its checks arrive with the next poll.
 *
 * Dependencies are injected so the mapping and the org fan-out can be tested
 * without a database; the route passes the real ones.
 */

import type { GithubCheckRun, GithubEvent, GithubPullRequest } from '@/libs/github/events';
import type { GithubConfig } from '@/libs/sources/github';
import { sql } from 'drizzle-orm';
import { createGithubClient, resolveGithubToken, splitRepo } from '@/libs/github/client';
import { checksCompletedEvent, eventsFromWebhook, matchesBranchPrefix, verifyGithubSignature } from '@/libs/github/events';
import { githubConfigSchema } from '@/libs/sources/github';

/** A `github` source that lists the delivery's repository. */
export type GithubSourceRef = {
  orgId: string;
  sourceId: number;
  apiTokenId: string | null;
  config: GithubConfig;
};

export type GithubWebhookDeps = {
  /**
   * Every enabled `github` source, across orgs, whose `repos` names this
   * repository. With an `installationId`, a source whose credential is a
   * different installation is left out; one holding a pasted token stays.
   */
  sourcesForRepo: (repo: string, installationId?: string) => Promise<GithubSourceRef[]>;
  /** The source's vaulted token, or undefined when it holds none. */
  tokenFor: (source: GithubSourceRef) => Promise<string | undefined>;
  emit: (orgId: string, sourceId: number, event: GithubEvent) => Promise<void>;
};

export type GithubWebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Among the sources that could want a repository, the ones a delivery is
 * actually for. A source whose credential is a DIFFERENT installation is
 * dropped: it connected another organization's copy of the app and this
 * delivery is not its business, whatever repository it lists.
 *
 * Which sources are kept depends on where their scope comes from:
 *
 * - **Listed** (`repos` names the repository). Today's rule: kept unless it
 *   holds a different installation. One holding none is a pasted token, whose
 *   scope is the list alone, so it is kept.
 * - **Derived** (`repos` omitted, scope IS the installation's grant). Kept
 *   ONLY on a matching installation. There is no list to vouch for it, so
 *   without that match nothing ties the source to the repository, and keeping
 *   it would hand one workspace another's deliveries. A delivery carrying no
 *   installation id cannot make that match and so cannot reach it.
 * @param refs - Candidate sources for the repository.
 * @param installationId - The delivery's `installation.id`, when it carried one.
 * @param installationOf - The installation id a source's credential holds, if any.
 */
export async function preferInstalled(
  refs: GithubSourceRef[],
  installationId: string | undefined,
  installationOf: (ref: GithubSourceRef) => Promise<string | undefined>,
): Promise<GithubSourceRef[]> {
  const derived = (ref: GithubSourceRef): boolean => !ref.config.repos || ref.config.repos.length === 0;
  if (!installationId) {
    return refs.filter(ref => !derived(ref));
  }
  const kept: GithubSourceRef[] = [];
  for (const ref of refs) {
    const held = await installationOf(ref);
    if (held === installationId || (held === undefined && !derived(ref))) {
      kept.push(ref);
    }
  }
  return kept;
}

/**
 * The real dependencies: `knowledge_source` rows by connector, the vault, and
 * `EventService`. Imported lazily so this module can be loaded by a test that
 * never touches the database.
 */
async function defaultDeps(): Promise<GithubWebhookDeps> {
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const { emitEvent } = await import('@/services/EventService');
  const { installationIdFrom } = await import('@/libs/github/app');
  return {
    async sourcesForRepo(repo, installationId) {
      const rows = await db
        .select({ id: knowledgeSourceSchema.id, orgId: knowledgeSourceSchema.orgId, configJson: knowledgeSourceSchema.configJson, apiTokenId: knowledgeSourceSchema.apiTokenId, enabled: knowledgeSourceSchema.enabled })
        .from(knowledgeSourceSchema)
        .where(sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'github'`);
      const wanted = repo.toLowerCase();
      const refs: GithubSourceRef[] = [];
      for (const row of rows) {
        if (row.enabled === 'false') {
          continue;
        }
        const parsed = githubConfigSchema.safeParse(row.configJson);
        if (!parsed.success) {
          continue;
        }
        // A source that lists repositories must list THIS one. A source that
        // lists none takes its scope from the installation, so it is only a
        // candidate here; preferInstalled is what decides it, on the
        // delivery's installation id.
        const listed = parsed.data.repos ?? [];
        if (listed.length === 0 || listed.some(r => r.toLowerCase() === wanted)) {
          refs.push({ orgId: row.orgId, sourceId: row.id, apiTokenId: row.apiTokenId, config: parsed.data });
        }
      }
      return preferInstalled(refs, installationId, async ref =>
        installationIdFrom(await getCredentialsForConnector({ orgId: ref.orgId, connectorSlug: 'github', apiTokenId: ref.apiTokenId }).catch(() => undefined)));
    },
    async tokenFor(source) {
      const credentials = await getCredentialsForConnector({ orgId: source.orgId, connectorSlug: 'github', apiTokenId: source.apiTokenId }).catch(() => undefined);
      return resolveGithubToken(credentials, { baseUrl: source.config.baseUrl }).catch(() => undefined);
    },
    async emit(orgId, sourceId, event) {
      // Background: a mission check holds an agent loop for minutes, and
      // GitHub gives a delivery ten seconds before it counts as failed.
      await emitEvent({ orgId, type: event.type, payload: event.payload, dedupeKey: event.dedupeKey, invokedBy: `webhook:github:${sourceId}`, dispatchMode: 'background' });
    },
  };
}

/**
 * `pr.checks_completed` for a check suite the delivery only named, read
 * through the API with the source's token.
 * @param token - The source's vaulted token.
 * @param baseUrl - The source's API host.
 * @param repo - `owner/name`.
 * @param number - The pull request number.
 */
async function hydrateCheckSuite(token: string, baseUrl: string, repo: string, number: number): Promise<GithubEvent | null> {
  const parts = splitRepo(repo);
  if (!parts) {
    return null;
  }
  const client = createGithubClient({ token, baseUrl, maxRetries: 1 });
  const base = `/repos/${parts.owner}/${parts.name}`;
  const pr = await client.get<GithubPullRequest>(`${base}/pulls/${number}`);
  if (!pr.ok) {
    return null;
  }
  const runs = await client.get<{ check_runs?: GithubCheckRun[] }>(`${base}/commits/${pr.data.head.sha}/check-runs`, { per_page: '100' });
  if (!runs.ok) {
    return null;
  }
  return checksCompletedEvent(repo, pr.data, runs.data.check_runs ?? []);
}

/**
 * Handle one delivery end to end. Never throws for a bad delivery: the
 * outcome carries the status the route should answer with.
 * @param input - The raw delivery.
 * @param input.rawBody - The body exactly as received.
 * @param input.headers - The request headers.
 * @param input.secret - `GITHUB_WEBHOOK_SECRET`.
 * @param deps - Injected for tests; the route passes none.
 */
export async function handleGithubWebhook(
  input: { rawBody: string; headers: Headers; secret: string | undefined },
  deps?: GithubWebhookDeps,
): Promise<GithubWebhookOutcome> {
  const verified = verifyGithubSignature(input.rawBody, input.headers.get('x-hub-signature-256'), input.secret);
  if (!verified.ok) {
    return { status: verified.reason === 'missing_secret' ? 501 : 401, body: { error: `signature check failed: ${verified.reason}` } };
  }
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: 'body is not JSON' } };
  }
  const eventName = input.headers.get('x-github-event') ?? '';
  if (eventName === 'ping') {
    return { status: 200, body: { ok: true, pong: true } };
  }
  const repo = (body as { repository?: { full_name?: string } } | null)?.repository?.full_name;
  if (!repo) {
    return { status: 200, body: { ok: true, ignored: 'delivery names no repository' } };
  }

  const installation = (body as { installation?: { id?: number | string } } | null)?.installation?.id;
  const installationId = installation === undefined || installation === null ? undefined : String(installation);
  const resolved = deps ?? (await defaultDeps());
  const sources = await resolved.sourcesForRepo(repo, installationId);
  if (sources.length === 0) {
    return { status: 200, body: { ok: true, ignored: `no github source lists ${repo}` } };
  }

  let emitted = 0;
  for (const source of sources) {
    const mapping = eventsFromWebhook(eventName, body, source.config.deployBranch);
    if (!mapping) {
      continue;
    }
    // A deploy-branch run is the pipeline's, whatever the branch prefix says.
    const events = mapping.events.filter(event => event.type === 'run.failed' || event.type === 'run.succeeded' || matchesBranchPrefix(String(event.payload.branch ?? ''), source.config.branchPrefix));
    const suites = mapping.checkSuiteFor.filter(suite => matchesBranchPrefix(suite.branch, source.config.branchPrefix));
    if (suites.length > 0) {
      const token = await resolved.tokenFor(source);
      if (token) {
        for (const suite of suites) {
          const event = await hydrateCheckSuite(token, source.config.baseUrl, repo, suite.number);
          if (event) {
            events.push(event);
          }
        }
      }
    }
    for (const event of events) {
      await resolved.emit(source.orgId, source.sourceId, event);
      emitted += 1;
    }
  }
  return { status: 200, body: { ok: true, emitted } };
}
