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
 * resolved from the repository rather than from anything in the URL.
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
import { createGithubClient, splitRepo, tokenFromCredentials } from '@/libs/github/client';
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
  /** Every enabled `github` source, across orgs, whose `repos` names this repository. */
  sourcesForRepo: (repo: string) => Promise<GithubSourceRef[]>;
  /** The source's vaulted token, or undefined when it holds none. */
  tokenFor: (source: GithubSourceRef) => Promise<string | undefined>;
  emit: (orgId: string, sourceId: number, event: GithubEvent) => Promise<void>;
};

export type GithubWebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

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
  return {
    async sourcesForRepo(repo) {
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
        if (parsed.success && parsed.data.repos.some(r => r.toLowerCase() === wanted)) {
          refs.push({ orgId: row.orgId, sourceId: row.id, apiTokenId: row.apiTokenId, config: parsed.data });
        }
      }
      return refs;
    },
    async tokenFor(source) {
      const credentials = await getCredentialsForConnector({ orgId: source.orgId, connectorSlug: 'github', apiTokenId: source.apiTokenId }).catch(() => undefined);
      return tokenFromCredentials(credentials);
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

  const resolved = deps ?? (await defaultDeps());
  const sources = await resolved.sourcesForRepo(repo);
  if (sources.length === 0) {
    return { status: 200, body: { ok: true, ignored: `no github source lists ${repo}` } };
  }

  let emitted = 0;
  for (const source of sources) {
    const mapping = eventsFromWebhook(eventName, body, source.config.deployBranch);
    if (!mapping) {
      continue;
    }
    const events = mapping.events.filter(event => event.type === 'run.failed' || matchesBranchPrefix(String(event.payload.branch ?? ''), source.config.branchPrefix));
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
