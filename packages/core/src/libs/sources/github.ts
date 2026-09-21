/**
 * GitHub connector — pull requests, checks, reviews, merges and failed deploy
 * runs on the repositories a workspace lists, turned into events automations
 * can act on.
 *
 * The factory worker opens pull requests and nothing in Vocion learned when
 * their checks passed, a review landed or the merge happened; a person polled
 * GitHub by hand. Automations already fire on events (`when: { event }`), so
 * what was missing was a source that emits them. This connector is that
 * source. It is about events, not knowledge: each sync polls the REST API for
 * what changed since the last checkpoint, emits `pr.*` and `run.failed`
 * events through `EventService` for the source's org, and yields one small
 * document per pull request so the PR is searchable — that is the whole
 * mirror.
 *
 * Auth: a fine-grained PAT, classic PAT or GitHub App installation token in
 * `ctx.credentials.token`, resolved per run from the vault against the
 * `github` platform descriptor. Incremental: `ctx.since` is the previous
 * run's cutoff, so the poll asks for pull requests updated since then and
 * stops walking at the first older one; a first run (or a full sync) looks
 * back `lookbackDays`. Idempotent: every event's dedupe key holds the head
 * sha, so a re-poll of unchanged state is absorbed by `emitEvent`.
 *
 * A repository that cannot be read is reported through `onProgress({ kind:
 * 'error' })` and the rest carry on; the orchestrator then leaves the
 * watermark where it was, so the next run re-asks for the window this one
 * could not cover. An event that fails to dispatch is reported the same way,
 * for the same reason.
 *
 * The webhook receiver at `app/api/webhooks/github/route.ts` posts the same
 * events sooner; the poll is what makes a missed delivery harmless.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { GithubClient } from '@/libs/github/client';
import type { GithubEvent, GithubPullRequest, GithubWorkflowRun } from '@/libs/github/events';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { createGithubClient, GITHUB_API_URL, splitRepo, tokenFromCredentials } from '@/libs/github/client';
import {
  checksCompletedEvent,
  matchesBranchPrefix,
  pullRequestLifecycleEvents,
  reviewSubmittedEvents,
  runFailedEvent,
} from '@/libs/github/events';
import { InspectInputError } from './inspect';

export const githubConfigSchema = z.object({
  /**
   * The repositories to watch, `owner/name`. The shape is checked per entry
   * by `splitRepo` when a repository is read, so Test connection can name the
   * one entry that is malformed rather than refusing the whole list.
   */
  repos: z.array(z.string().trim().min(1)).min(1, 'list at least one repository'),
  /** Only pull requests whose head branch starts with this are watched. Empty means every branch. */
  branchPrefix: z.string().trim().optional(),
  /** The branch whose failed GitHub Actions runs become `run.failed` — the deploy pipeline. */
  deployBranch: z.string().trim().min(1).default('main'),
  /** How far back a first run, or a full sync, looks. */
  lookbackDays: z.number().int().positive().max(90).default(7),
  /** API host override, for GitHub Enterprise Server or a test double. */
  baseUrl: z.string().url().default(GITHUB_API_URL),
});

export type GithubConfig = z.infer<typeof githubConfigSchema>;

/** How many pages of pull requests one repository may walk per sync. 100 per page. */
const MAX_PR_PAGES = 5;

/**
 * The searchable document for one pull request: title, state, url. Enough to
 * find "the PR that touched pricing" and land on GitHub; nothing more is
 * mirrored, because the events are the product here.
 * @param repo - `owner/name`.
 * @param pr - The pull request.
 */
export function pullRequestDoc(repo: string, pr: GithubPullRequest): IngestDoc {
  const state = pr.merged_at ? 'merged' : pr.state;
  return {
    externalId: `pr:${repo}#${pr.number}`,
    title: `${repo}#${pr.number}: ${pr.title}`,
    content: [
      `${repo}#${pr.number} — ${pr.title}`,
      `State: ${state}`,
      `Branch: ${pr.head.ref} → ${pr.base.ref}`,
      `Author: ${pr.user?.login ?? ''}`,
      pr.html_url,
    ].join('\n'),
    uri: pr.html_url,
    lastModifiedAt: new Date(pr.updated_at),
    metadata: {
      kind: 'pull_request',
      repo,
      number: pr.number,
      state,
      url: pr.html_url,
      headSha: pr.head.sha,
      branch: pr.head.ref,
      baseBranch: pr.base.ref,
      author: pr.user?.login ?? '',
      mergeSha: pr.merge_commit_sha ?? undefined,
      mergedAt: pr.merged_at ?? undefined,
      closedAt: pr.closed_at ?? undefined,
    },
  };
}

/**
 * The window one run asks GitHub for: the stored watermark, or `lookbackDays`
 * back from now when there is none.
 * @param since - `ctx.since`.
 * @param lookbackDays - The configured look-back.
 * @param now - The clock, injectable for tests.
 */
export function pollWindowStart(since: Date | null | undefined, lookbackDays: number, now: Date = new Date()): Date {
  return since ?? new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

/**
 * Dispatch one event through `EventService` for the source's org. Imported
 * lazily for the reason `SourceSyncService.announceSyncCompleted` gives: the
 * service pulls in the workflow and automation runners, and this module sits
 * in the import chain of CLI scripts.
 * @param orgId - The source's org.
 * @param sourceId - The source, named in `invokedBy`.
 * @param event - What to emit.
 */
async function dispatch(orgId: string, sourceId: number, event: GithubEvent): Promise<void> {
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({
    orgId,
    type: event.type,
    payload: event.payload,
    dedupeKey: event.dedupeKey,
    invokedBy: `source:github:${sourceId}`,
  });
}

type RepoPoll = {
  events: GithubEvent[];
  docs: IngestDoc[];
};

/**
 * Poll one repository: the pull requests updated inside the window, their
 * checks and reviews, and the failed runs on the deploy branch. Throws on the
 * first request GitHub refuses; the caller decides what one repository's
 * failure costs the rest.
 * @param client - A client bound to the source's token.
 * @param repo - `owner/name`.
 * @param cfg - The parsed config.
 * @param since - Start of the window.
 * @param onSkipped - Told about a pull request the branch filter dropped.
 */
export async function pollRepository(
  client: GithubClient,
  repo: string,
  cfg: GithubConfig,
  since: Date,
  onSkipped?: (uri: string, message: string) => void,
): Promise<RepoPoll> {
  const parts = splitRepo(repo);
  if (!parts) {
    throw new Error(`${repo} is not a repository: write it owner/name`);
  }
  const base = `/repos/${parts.owner}/${parts.name}`;
  const out: RepoPoll = { events: [], docs: [] };

  // Newest first, stopping at the first page whose last entry is older than
  // the window — `updated` is the sort, so everything after it is older too.
  const pulls = await client.list<GithubPullRequest>(`${base}/pulls`, { state: 'all', sort: 'updated', direction: 'desc' }, {
    maxPages: MAX_PR_PAGES,
    stop: page => page.length > 0 && new Date(page[page.length - 1]!.updated_at) < since,
  });
  if (!pulls.ok) {
    throw new Error(`${repo}: pull requests could not be listed — ${pulls.message}`);
  }

  for (const pr of pulls.data) {
    if (new Date(pr.updated_at) < since) {
      continue;
    }
    if (!matchesBranchPrefix(pr.head.ref, cfg.branchPrefix)) {
      onSkipped?.(pr.html_url, `branch ${pr.head.ref} is outside the ${cfg.branchPrefix} prefix`);
      continue;
    }
    out.docs.push(pullRequestDoc(repo, pr));
    out.events.push(...pullRequestLifecycleEvents(repo, pr, since));

    // Two more requests per pull request. Check runs on the head sha, and the
    // reviews left inside the window. Both keyed on the sha so a re-poll of
    // an unchanged PR dedupes on emit rather than here.
    const checks = await client.get<{ check_runs?: Array<{ id: number; name: string; status: string; conclusion?: string | null }> }>(
      `${base}/commits/${pr.head.sha}/check-runs`,
      { per_page: '100' },
    );
    if (!checks.ok) {
      throw new Error(`${repo}#${pr.number}: check runs could not be read — ${checks.message}`);
    }
    const checksEvent = checksCompletedEvent(repo, pr, checks.data.check_runs ?? []);
    if (checksEvent) {
      out.events.push(checksEvent);
    }

    const reviews = await client.list<{ id: number; state: string; user?: { login?: string } | null; submitted_at?: string | null; commit_id: string; html_url: string }>(
      `${base}/pulls/${pr.number}/reviews`,
      {},
      { maxPages: 2 },
    );
    if (!reviews.ok) {
      throw new Error(`${repo}#${pr.number}: reviews could not be read — ${reviews.message}`);
    }
    out.events.push(...reviewSubmittedEvents(repo, pr, reviews.data, since));
  }

  // The deploy pipeline: completed runs on the deploy branch inside the
  // window, of which the ones that did not succeed become events. `created`
  // takes GitHub's search date syntax.
  // One page of 100: a deploy branch does not complete a hundred runs between
  // polls, and the endpoint wraps its array in an object so `list` cannot walk it.
  const runs = await client.get<{ workflow_runs?: GithubWorkflowRun[] }>(`${base}/actions/runs`, {
    branch: cfg.deployBranch,
    status: 'completed',
    created: `>=${since.toISOString().slice(0, 19)}Z`,
    per_page: '100',
  });
  if (!runs.ok) {
    throw new Error(`${repo}: workflow runs on ${cfg.deployBranch} could not be listed — ${runs.message}`);
  }
  for (const run of runs.data.workflow_runs ?? []) {
    if (new Date(run.updated_at) < since) {
      continue;
    }
    const event = runFailedEvent(repo, run);
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
 * The permission a fine-grained token was missing, from GitHub's own header,
 * or the failure message when the header said nothing.
 * @param res - A failed result.
 * @param res.message - The failure's message.
 * @param res.acceptedPermissions - The header, when present.
 * @param permission - The permission the probe was for.
 */
function permissionDetail(res: { message: string; acceptedPermissions: string | null }, permission: string): string {
  return res.acceptedPermissions
    ? `${res.message} GitHub says the call needs: ${res.acceptedPermissions}.`
    : `${res.message} Grant ${permission} to the token for this repository.`;
}

/**
 * Test connection: is the token accepted, is each repository reachable, and
 * does the token carry what the poll needs on each — pull requests, check
 * runs and Actions runs. Fine-grained tokens do not list their permissions
 * anywhere, so the probe IS the scope check: one read per permission per
 * repository, and a 403 names the permission GitHub asked for. Classic tokens
 * echo their scopes in a header, reported as a note. Nothing is stored.
 * @param input - Token, repositories and host.
 * @param input.token - The access token.
 * @param input.repos - `owner/name` list.
 * @param input.baseUrl - API host override.
 */
export async function inspectGithubToken(input: { token: string; repos: string[]; baseUrl?: string }): Promise<ConnectorInspection> {
  const client = createGithubClient({ token: input.token, baseUrl: input.baseUrl, maxRetries: 0 });
  const checks: ConnectorCheck[] = [];

  // `/rate_limit` is answered for any valid token, counts against no quota,
  // and is the one endpoint an installation token can hit without a repo.
  const auth = await client.get<{ rate?: { remaining?: number; limit?: number } }>('/rate_limit');
  const unreachable = !auth.ok && auth.status === 0;
  const rejected = !auth.ok && auth.status === 401;
  checks.push(check(
    'auth',
    'Token accepted',
    auth.ok,
    auth.ok
      ? `GitHub accepted the token. ${auth.data.rate?.remaining ?? '?'} of ${auth.data.rate?.limit ?? '?'} requests left this hour.`
      : auth.message,
  ));
  if (!auth.ok) {
    return { reachable: !unreachable, authorized: !rejected && !unreachable, checks, note: null, error: auth.message };
  }
  const scopesNote = auth.oauthScopes !== null
    ? `Classic token; GitHub lists its scopes as: ${auth.oauthScopes || '(none)'}. It needs \`repo\` (or \`public_repo\` for public repositories).`
    : 'Fine-grained or installation token; GitHub does not list its permissions, so each read below is the permission check.';

  for (const repo of input.repos) {
    const parts = splitRepo(repo);
    if (!parts) {
      checks.push(check(`repo:${repo}`, `${repo} reachable`, false, 'Not a repository: write it owner/name.'));
      continue;
    }
    const base = `/repos/${parts.owner}/${parts.name}`;
    const meta = await client.get<{ default_branch?: string; private?: boolean }>(base);
    checks.push(check(
      `repo:${repo}`,
      `${repo} reachable (metadata:read)`,
      meta.ok,
      meta.ok ? `Default branch ${meta.data.default_branch ?? '?'}, ${meta.data.private ? 'private' : 'public'}.` : permissionDetail(meta, 'metadata:read'),
    ));
    if (!meta.ok) {
      continue;
    }
    const pulls = await client.get<unknown[]>(`${base}/pulls`, { state: 'all', per_page: '1' });
    checks.push(check(`pulls:${repo}`, `${repo} pull requests (pull_requests:read)`, pulls.ok, pulls.ok ? 'Readable.' : permissionDetail(pulls, 'pull_requests:read')));
    const branch = meta.data.default_branch ?? 'main';
    const runs = await client.get<{ check_runs?: unknown[] }>(`${base}/commits/${branch}/check-runs`, { per_page: '1' });
    checks.push(check(`checks:${repo}`, `${repo} check runs (checks:read, contents:read)`, runs.ok, runs.ok ? 'Readable.' : permissionDetail(runs, 'checks:read and contents:read')));
    const actions = await client.get<{ total_count?: number }>(`${base}/actions/runs`, { per_page: '1' });
    checks.push(check(`actions:${repo}`, `${repo} Actions runs (actions:read)`, actions.ok, actions.ok ? 'Readable.' : permissionDetail(actions, 'actions:read')));
  }

  return {
    reachable: true,
    authorized: true,
    checks,
    note: `${scopesNote} Nothing was saved by this test: no source row, no credential, no vault write.`,
    error: null,
  };
}

export const githubConnector: SourceConnector<typeof githubConfigSchema> = {
  slug: 'github',
  name: 'GitHub',
  description: 'Pull requests, checks, reviews, merges and failed deploy runs on the repositories you list, as events automations act on. One searchable document per pull request.',
  icon: 'GitPullRequest',
  authKind: 'apikey',
  configSchema: githubConfigSchema,
  requiredScopes: ['pull_requests:read', 'checks:read', 'contents:read', 'metadata:read', 'actions:read'],
  inspectNote: 'Reads one pull request, one commit\'s check runs and one Actions run per repository to prove the token holds each permission. Nothing is saved.',

  async inspect({ config, credentials }) {
    const token = tokenFromCredentials(credentials);
    if (!token) {
      throw new InspectInputError('A GitHub access token is required — a fine-grained personal access token from github.com/settings/personal-access-tokens, or a GitHub App installation token.');
    }
    const parsed = githubConfigSchema.pick({ repos: true, baseUrl: true }).safeParse({
      repos: Array.isArray(config.repos) ? config.repos : [],
      ...(typeof config.baseUrl === 'string' && config.baseUrl.trim() !== '' ? { baseUrl: config.baseUrl.trim() } : {}),
    });
    if (!parsed.success) {
      throw new InspectInputError(parsed.error.issues[0]?.message ?? 'Repositories are written owner/name, one or more.');
    }
    return inspectGithubToken({ token, repos: parsed.data.repos, baseUrl: parsed.data.baseUrl });
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = githubConfigSchema.parse(ctx.config);
    const token = tokenFromCredentials(ctx.credentials);
    if (!token) {
      throw new Error('GitHub connector requires an access token in credentials.token');
    }
    const client = createGithubClient({ token, baseUrl: cfg.baseUrl });
    const since = pollWindowStart(ctx.since, cfg.lookbackDays);

    for (const repo of cfg.repos) {
      let poll: RepoPoll;
      try {
        poll = await pollRepository(client, repo, cfg, since, (uri, message) => ctx.onProgress?.({ kind: 'skipped', uri, message }));
      } catch (err) {
        // One repository we cannot read must not cost the others their
        // events. Reported, which also holds the watermark back so the next
        // run re-covers this window.
        ctx.onProgress?.({ kind: 'error', uri: repo, message: err instanceof Error ? err.message : String(err) });
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
