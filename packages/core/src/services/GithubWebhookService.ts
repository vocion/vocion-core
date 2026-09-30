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
import { installationCovers } from '@/libs/github/appAuth';
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
  /** A token for the repository: the GitHub App's installation first, the source's vaulted token second; undefined when neither. */
  tokenFor: (source: GithubSourceRef, repo: string) => Promise<string | undefined>;
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
    async tokenFor(source, repo) {
      const { installationTokenForRepo } = await import('@/services/github/GithubAppService');
      const minted = await installationTokenForRepo(source.orgId, repo).catch(() => null);
      if (minted?.ok) {
        return minted.token;
      }
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
  return dispatchGithubDelivery(eventName, body, deps ?? (await defaultDeps()));
}

/**
 * A verified delivery, fanned out to every source that lists its repository:
 * mapped with each source's own settings, check suites hydrated, events
 * emitted with the poll's dedupe keys. Shared by the per-repository webhook
 * and the GitHub App's.
 * @param eventName - `X-GitHub-Event`.
 * @param body - The parsed delivery.
 * @param resolved - Where sources, tokens and events come from.
 */
export async function dispatchGithubDelivery(eventName: string, body: unknown, resolved: GithubWebhookDeps): Promise<GithubWebhookOutcome> {
  const repo = (body as { repository?: { full_name?: string } } | null)?.repository?.full_name;
  if (!repo) {
    return { status: 200, body: { ok: true, ignored: 'delivery names no repository' } };
  }

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
      const token = await resolved.tokenFor(source, repo);
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

/* ------------------------------------------------------------------ */
/* The GitHub App's webhook (backlog 053)                              */
/* ------------------------------------------------------------------ */

type InstallationPatch = Partial<{ status: string; permissions: Record<string, string>; repositorySelection: string; addRepos: string[]; removeRepos: string[] }>;

export type GithubAppWebhookDeps = {
  /** The active app's webhook secret, or undefined before an app exists. */
  webhookSecret: () => Promise<string | undefined>;
  /** Every workspace bound to an installation, whatever its status. */
  workspacesFor: (installationId: number) => Promise<Array<{ orgId: string; accountLogin: string; repositorySelection: string; repos: string[]; status: string }>>;
  /** Apply what GitHub said changed about an installation to every workspace bound to it. */
  updateInstallation: (installationId: number, patch: InstallationPatch) => Promise<void>;
  /** The per-repository delivery path, reused. */
  delivery: GithubWebhookDeps;
};

async function defaultAppDeps(): Promise<GithubAppWebhookDeps> {
  const { db } = await import('@/libs/DB');
  const { eq } = await import('drizzle-orm');
  const { githubInstallationSchema } = await import('@/models/Schema');
  const app = await import('@/services/github/GithubAppService');
  const delivery = await defaultDeps();
  return {
    async webhookSecret() {
      const active = await app.activeApp();
      return active ? (await app.appSecrets(active)).webhookSecret : undefined;
    },
    async workspacesFor(installationId) {
      return db.select({ orgId: githubInstallationSchema.orgId, accountLogin: githubInstallationSchema.accountLogin, repositorySelection: githubInstallationSchema.repositorySelection, repos: githubInstallationSchema.repos, status: githubInstallationSchema.status })
        .from(githubInstallationSchema)
        .where(eq(githubInstallationSchema.installationId, installationId));
    },
    async updateInstallation(installationId, patch) {
      const rows = await db.select().from(githubInstallationSchema).where(eq(githubInstallationSchema.installationId, installationId));
      for (const row of rows) {
        let repos = row.repos ?? [];
        if (patch.addRepos) {
          repos = [...new Set([...repos, ...patch.addRepos])];
        }
        if (patch.removeRepos) {
          const gone = new Set(patch.removeRepos.map(r => r.toLowerCase()));
          repos = repos.filter(r => !gone.has(r.toLowerCase()));
        }
        await db.update(githubInstallationSchema).set({
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.permissions ? { permissions: patch.permissions } : {}),
          ...(patch.repositorySelection ? { repositorySelection: patch.repositorySelection } : {}),
          repos,
          updatedAt: new Date(),
        }).where(eq(githubInstallationSchema.id, row.id));
      }
      app.forgetInstallationTokens(installationId);
      // What landed on GitHub answers the requests waiting on it: repositories
      // added or new permissions accepted close them, removal closes nothing.
      if (patch.status !== 'removed' && patch.status !== 'suspended') {
        const { closeConnectionRequests } = await import('@/services/connections/connectionRequests');
        for (const row of rows) {
          await closeConnectionRequests(row.orgId, 'github', row.accountLogin, 'GitHub confirmed the change on the installation.', patch.addRepos?.length ? ['install'] : patch.permissions ? ['upgrade'] : []).catch(() => undefined);
        }
      }
    },
    delivery,
  };
}

const INSTALLATION_STATUS: Record<string, string> = { deleted: 'removed', suspend: 'suspended', unsuspend: 'active' };

/**
 * One delivery to the GitHub App's webhook. Signed with the app's own webhook
 * secret (from the vault, never an env var). `installation` and
 * `installation_repositories` keep every bound workspace's record of the
 * installation true; everything else is resolved to the workspaces the
 * installation is bound to and runs the per-repository path, so the events and
 * their dedupe keys are the same whichever webhook delivered them.
 * @param input - The raw delivery.
 * @param input.rawBody - The body exactly as received.
 * @param input.headers - The request headers.
 * @param deps - Injected for tests; the route passes none.
 */
export async function handleGithubAppWebhook(input: { rawBody: string; headers: Headers }, deps?: GithubAppWebhookDeps): Promise<GithubWebhookOutcome> {
  const resolved = deps ?? (await defaultAppDeps());
  const verified = verifyGithubSignature(input.rawBody, input.headers.get('x-hub-signature-256'), await resolved.webhookSecret());
  if (!verified.ok) {
    return { status: verified.reason === 'missing_secret' ? 501 : 401, body: { error: `signature check failed: ${verified.reason}` } };
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: 'body is not JSON' } };
  }
  const eventName = input.headers.get('x-github-event') ?? '';
  if (eventName === 'ping') {
    return { status: 200, body: { ok: true, pong: true } };
  }
  const installation = body.installation as { id?: number; permissions?: Record<string, string>; repository_selection?: string } | undefined;
  const installationId = typeof installation?.id === 'number' ? installation.id : null;
  if (installationId === null) {
    return { status: 200, body: { ok: true, ignored: 'delivery names no installation' } };
  }
  const action = typeof body.action === 'string' ? body.action : '';

  if (eventName === 'installation') {
    await resolved.updateInstallation(installationId, {
      ...(INSTALLATION_STATUS[action] ? { status: INSTALLATION_STATUS[action] } : {}),
      ...(installation?.permissions ? { permissions: installation.permissions } : {}),
      ...(installation?.repository_selection ? { repositorySelection: installation.repository_selection } : {}),
    });
    return { status: 200, body: { ok: true, installation: installationId, action } };
  }
  if (eventName === 'installation_repositories') {
    const names = (key: string) => ((body[key] as Array<{ full_name?: string }> | undefined) ?? []).map(r => r.full_name ?? '').filter(Boolean);
    await resolved.updateInstallation(installationId, {
      ...(installation?.repository_selection ? { repositorySelection: installation.repository_selection } : {}),
      addRepos: names('repositories_added'),
      removeRepos: names('repositories_removed'),
    });
    return { status: 200, body: { ok: true, installation: installationId, action } };
  }

  const repo = (body.repository as { full_name?: string } | undefined)?.full_name ?? '';
  const orgs = new Set((await resolved.workspacesFor(installationId)).filter(w => w.status === 'active' && installationCovers(w, repo)).map(w => w.orgId));
  if (orgs.size === 0) {
    return { status: 200, body: { ok: true, ignored: `installation ${installationId} is not connected to a workspace for ${repo || 'this delivery'}` } };
  }
  return dispatchGithubDelivery(eventName, body, {
    ...resolved.delivery,
    sourcesForRepo: async r => (await resolved.delivery.sourcesForRepo(r)).filter(source => orgs.has(source.orgId)),
  });
}
