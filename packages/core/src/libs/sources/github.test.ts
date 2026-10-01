import type { SourceContext } from '@/libs/sources/types';
/**
 * GitHub connector against a mocked `fetch` and a mocked `EventService` —
 * verifies it is registered and paired with a platform, polls since the
 * checkpoint and stops walking at older pull requests, emits the events with
 * stable dedupe keys, honours the branch prefix, yields one small document per
 * pull request, holds the watermark back when a repository or a dispatch
 * fails, and reports Test connection failures with GitHub's own words. No
 * network and no credentials: every request is stubbed.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/EventService', () => ({
  emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })),
}));

vi.mock('@/libs/github/app', () => ({
  installationIdFrom: (c?: Record<string, unknown>) => (typeof c?.installationId === 'string' ? c.installationId : undefined),
  installationToken: vi.fn(async (id: string) => `ghs_minted_${id}`),
}));

const { emitEvent } = await import('@/services/EventService');
const { platformForConnectorSlug } = await import('@/libs/platforms/registry');
const { githubConnector, pollWindowStart, pullRequestDoc, resolveRepos } = await import('@/libs/sources/github');
const { getConnector } = await import('@/libs/sources/registry');

const REPO = 'northwind/orders-api';
const SINCE = new Date('2026-09-19T12:00:00Z');

function res(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function pr(over: Record<string, unknown> = {}) {
  return {
    number: 3,
    title: 'feat(intake): accept requests',
    state: 'open',
    html_url: `https://github.com/${REPO}/pull/3`,
    draft: false,
    user: { login: 'factory-bot' },
    head: { ref: 'factory/task-042', sha: 'abc123' },
    base: { ref: 'main' },
    created_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-09-19T15:00:00Z',
    closed_at: null,
    merged_at: null,
    merge_commit_sha: null,
    ...over,
  };
}

const CHECKS_FAILED = { check_runs: [{ id: 1, name: 'unit', status: 'completed', conclusion: 'success' }, { id: 2, name: 'typecheck', status: 'completed', conclusion: 'failure' }] };
const NO_REVIEWS: unknown[] = [];
const NO_RUNS = { workflow_runs: [] };

/**
 * Route each stubbed request by path, so a test states only what differs.
 * @param routes - Path prefix → response, matched in order.
 */
function stubGithub(routes: Record<string, (url: URL) => Response>) {
  const calls: string[] = [];
  const f = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.pathname.startsWith(prefix) || url.pathname === prefix) {
        return handler(url);
      }
    }
    return res({ message: 'Not Found' }, 404);
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

/**
 * The happy path: one open PR pushed inside the window, failed checks, no reviews, no runs.
 * @param pulls - What the pull request list answers.
 * @param over - Fields to change from the default.
 */
function stubRepo(pulls: unknown[] = [pr()], over: Record<string, (url: URL) => Response> = {}) {
  return stubGithub({
    [`/repos/${REPO}/pulls/3/reviews`]: () => res(NO_REVIEWS),
    [`/repos/${REPO}/pulls`]: () => res(pulls),
    [`/repos/${REPO}/commits/`]: () => res(CHECKS_FAILED),
    [`/repos/${REPO}/actions/runs`]: () => res(NO_RUNS),
    ...over,
  });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    sourceId: 7,
    orgId: 'org_1',
    config: { repos: [REPO], branchPrefix: 'factory/' },
    credentials: { token: 'github_pat_fixture' },
    since: SINCE,
    ...over,
  };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

const emitted = () => vi.mocked(emitEvent).mock.calls.map(([input]) => input);

beforeEach(() => vi.mocked(emitEvent).mockClear());

afterEach(() => vi.unstubAllGlobals());

describe('githubConnector', () => {
  it('is registered under the `github` slug and paired with the `github` platform', () => {
    expect(getConnector('github')).toBe(githubConnector);
    expect(githubConnector.authKind).toBe('apikey');
    expect(platformForConnectorSlug('github')?.id).toBe('github');
    expect(githubConnector.requiredScopes).toContain('pull_requests:read');
  });

  it('refuses to sync without a token, naming the field', async () => {
    await expect(collect(githubConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/credentials\.token/);
  });

  it('polls pull requests by updated time since the checkpoint, and asks for check runs and reviews per PR', async () => {
    const calls = stubRepo();
    await collect(githubConnector.sync(ctx()));

    expect(calls[0]).toContain(`/repos/${REPO}/pulls?per_page=100&state=all&sort=updated&direction=desc`);
    expect(calls).toContainEqual(expect.stringContaining(`/repos/${REPO}/commits/abc123/check-runs`));
    expect(calls).toContainEqual(expect.stringContaining(`/repos/${REPO}/pulls/3/reviews`));
    // The deploy branch's completed runs since the checkpoint.
    expect(calls.at(-1)).toContain(`/repos/${REPO}/actions/runs?branch=main&status=completed&created=%3E%3D2026-09-19T12%3A00%3A00Z`);
  });

  it('emits pr.synchronized and pr.checks_completed for the pushed PR, for the source\'s org, with the sha in the dedupe key', async () => {
    stubRepo();
    await collect(githubConnector.sync(ctx()));

    expect(emitted().map(e => e.type)).toEqual(['pr.synchronized', 'pr.checks_completed']);
    expect(emitted()[0]).toMatchObject({
      orgId: 'org_1',
      dedupeKey: `github:${REPO}#3:pr.synchronized:abc123`,
      invokedBy: 'source:github:7',
      payload: { repo: REPO, number: 3, headSha: 'abc123', branch: 'factory/task-042', title: 'feat(intake): accept requests', author: 'factory-bot', url: `https://github.com/${REPO}/pull/3` },
    });
    expect(emitted()[1]).toMatchObject({
      dedupeKey: `github:${REPO}#3:pr.checks_completed:abc123:failed-2`,
      payload: { conclusion: 'failure', failedChecks: 'typecheck' },
    });
  });

  it('emits the same dedupe keys on a second poll of unchanged state, so EventService absorbs the repeat', async () => {
    stubRepo();
    await collect(githubConnector.sync(ctx()));
    const first = emitted().map(e => e.dedupeKey);
    vi.mocked(emitEvent).mockClear();
    await collect(githubConnector.sync(ctx()));

    expect(emitted().map(e => e.dedupeKey)).toEqual(first);
  });

  it('yields one small document per pull request — title, state, url — so the PR is searchable', async () => {
    stubRepo();
    const docs = await collect(githubConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      externalId: `pr:${REPO}#3`,
      title: `${REPO}#3: feat(intake): accept requests`,
      uri: `https://github.com/${REPO}/pull/3`,
      metadata: { kind: 'pull_request', repo: REPO, number: 3, state: 'open', headSha: 'abc123', branch: 'factory/task-042' },
    });
    expect(docs[0]!.content).toContain('State: open');
    expect(pullRequestDoc(REPO, pr({ merged_at: '2026-09-19T16:00:00Z', state: 'closed' }) as never).metadata?.state).toBe('merged');
  });

  it('skips pull requests outside the branch prefix, saying so, and neither emits nor yields for them', async () => {
    stubRepo([pr(), pr({ number: 4, head: { ref: 'feature/manual', sha: 'fff' }, html_url: `https://github.com/${REPO}/pull/4` })]);
    const progress: Array<{ kind: string; message?: string }> = [];
    const docs = await collect(githubConnector.sync(ctx({ onProgress: e => progress.push(e) })));

    expect(docs.map(d => d.externalId)).toEqual([`pr:${REPO}#3`]);
    expect(emitted().every(e => e.payload?.number === 3)).toBe(true);
    expect(progress.find(p => p.kind === 'skipped')?.message).toMatch(/feature\/manual is outside the factory\/ prefix/);
  });

  it('watches every branch when no prefix is configured', async () => {
    stubRepo([pr({ head: { ref: 'feature/manual', sha: 'fff' } })]);
    const docs = await collect(githubConnector.sync(ctx({ config: { repos: [REPO] } })));

    expect(docs).toHaveLength(1);
  });

  it('ignores pull requests older than the checkpoint and stops walking once a page ends before it', async () => {
    const stale = pr({ number: 1, updated_at: '2026-09-10T00:00:00Z', html_url: `https://github.com/${REPO}/pull/1` });
    const calls = stubGithub({
      [`/repos/${REPO}/pulls/3/reviews`]: () => res(NO_REVIEWS),
      [`/repos/${REPO}/pulls`]: url => res(url.searchParams.get('page') === '2' ? [] : [pr(), stale], 200, { link: `<https://api.github.com/repos/${REPO}/pulls?page=2>; rel="next"` }),
      [`/repos/${REPO}/commits/`]: () => res(CHECKS_FAILED),
      [`/repos/${REPO}/actions/runs`]: () => res(NO_RUNS),
    });
    const docs = await collect(githubConnector.sync(ctx()));

    expect(docs.map(d => d.externalId)).toEqual([`pr:${REPO}#3`]);
    expect(calls.filter(c => c.includes('page=2'))).toHaveLength(0);
  });

  it('on a first run looks back lookbackDays instead of everything', () => {
    const now = new Date('2026-09-20T00:00:00Z');

    expect(pollWindowStart(null, 7, now).toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(pollWindowStart(SINCE, 7, now)).toBe(SINCE);
  });

  it('emits pr.opened, pr.merged and pr.review_submitted from fixture payloads inside the window', async () => {
    stubRepo(
      [pr({ created_at: '2026-09-19T14:00:00Z', state: 'closed', merged_at: '2026-09-19T16:00:00Z', merge_commit_sha: 'merge999' })],
      { [`/repos/${REPO}/pulls/3/reviews`]: () => res([{ id: 11, state: 'APPROVED', user: { login: 'chris' }, submitted_at: '2026-09-19T15:30:00Z', commit_id: 'abc123', html_url: 'r' }]) },
    );
    await collect(githubConnector.sync(ctx()));

    expect(emitted().map(e => e.type)).toEqual(['pr.opened', 'pr.merged', 'pr.checks_completed', 'pr.review_submitted']);
    expect(emitted()[1]!.payload).toMatchObject({ mergeSha: 'merge999' });
    expect(emitted()[3]).toMatchObject({ dedupeKey: `github:${REPO}#3:pr.review_submitted:abc123:11`, payload: { reviewState: 'approved', reviewer: 'chris' } });
  });

  it('emits run.failed for a failed Actions run on the deploy branch, and run.succeeded for one that passed', async () => {
    stubRepo([], {
      [`/repos/${REPO}/actions/runs`]: () => res({ workflow_runs: [
        { id: 5001, name: 'Deploy', head_branch: 'main', head_sha: 'd', run_number: 88, run_attempt: 1, event: 'push', status: 'completed', conclusion: 'failure', html_url: `https://github.com/${REPO}/actions/runs/5001`, updated_at: '2026-09-19T17:00:00Z' },
        { id: 5002, name: 'Deploy', head_branch: 'main', head_sha: 'e', run_number: 89, run_attempt: 1, event: 'push', status: 'completed', conclusion: 'success', html_url: 'ok', updated_at: '2026-09-19T18:00:00Z' },
      ] }),
    });
    await collect(githubConnector.sync(ctx()));

    expect(emitted().map(e => e.type)).toEqual(['run.failed', 'run.succeeded']);
    expect(emitted()[1]).toMatchObject({ dedupeKey: `github:${REPO}:run.succeeded:5002:1`, payload: { conclusion: 'success' } });
    expect(emitted()[0]).toMatchObject({ dedupeKey: `github:${REPO}:run.failed:5001:1`, payload: { url: `https://github.com/${REPO}/actions/runs/5001`, conclusion: 'failure', name: 'Deploy' } });
  });

  it('reports a repository it cannot read as a connector error and carries on with the next, so the watermark holds', async () => {
    const other = 'northwind/other';
    stubGithub({
      [`/repos/${REPO}/pulls`]: () => res({ message: 'Resource not accessible by personal access token' }, 403, { 'x-accepted-github-permissions': 'pull_requests=read' }),
      [`/repos/${other}/pulls`]: () => res([]),
      [`/repos/${other}/actions/runs`]: () => res(NO_RUNS),
    });
    const progress: Array<{ kind: string; uri?: string; message?: string }> = [];
    await collect(githubConnector.sync(ctx({ config: { repos: [REPO, other] }, onProgress: e => progress.push(e) })));

    const error = progress.find(p => p.kind === 'error');

    expect(error?.uri).toBe(REPO);
    expect(error?.message).toMatch(/pull requests could not be listed — .*403.*Resource not accessible/);
  });

  it('reports an event that could not be dispatched as an error rather than failing the run', async () => {
    stubRepo();
    vi.mocked(emitEvent).mockRejectedValueOnce(new Error('database away'));
    const progress: Array<{ kind: string; message?: string }> = [];
    const docs = await collect(githubConnector.sync(ctx({ onProgress: e => progress.push(e) })));

    expect(docs).toHaveLength(1);
    expect(progress.find(p => p.kind === 'error')?.message).toMatch(/pr\.synchronized could not be dispatched: database away/);
  });
});

describe('resolveRepos — scope from the installation when the config names none', () => {
  const GRANTED = '/installation/repositories';

  it('uses the configured list when there is one, without asking GitHub', async () => {
    const calls = stubGithub({ [GRANTED]: () => res({ repositories: [{ full_name: 'other/repo' }] }) });

    await expect(resolveRepos({ repos: [REPO], baseUrl: 'https://api.github.com' }, { installationId: '42' }, 't')).resolves.toEqual([REPO]);
    expect(calls).toHaveLength(0);
  });

  it('derives every granted repository when the config names none, walking pages', async () => {
    stubGithub({
      [GRANTED]: (url) => {
        const page2 = url.searchParams.get('page') === '2';
        return page2
          ? res({ repositories: [{ full_name: 'northwind/billing' }] })
          : res({ repositories: [{ full_name: REPO }] }, 200, { link: '<https://api.github.com/installation/repositories?page=2>; rel="next"' });
      },
    });

    await expect(resolveRepos({ baseUrl: 'https://api.github.com' }, { installationId: '42' }, 't'))
      .resolves
      .toEqual([REPO, 'northwind/billing']);
  });

  it('refuses a pasted token with no list, because a token carries no repositories', async () => {
    await expect(resolveRepos({ baseUrl: 'https://api.github.com' }, { token: 'github_pat_x' }, 't'))
      .rejects
      .toThrow(/does not carry a repository list/);
  });

  it('refuses an installation that grants nothing rather than syncing nothing', async () => {
    stubGithub({ [GRANTED]: () => res({ repositories: [] }) });

    await expect(resolveRepos({ baseUrl: 'https://api.github.com' }, { installationId: '42' }, 't'))
      .rejects
      .toThrow(/grants no repositories/);
  });

  // The one that matters: a failed read must not read as a grant of nothing.
  // Returning [] here would make the sync walk no repositories and report
  // success, which is how a scope silently empties itself.
  it('throws when the grant cannot be read, never treating the failure as an empty grant', async () => {
    stubGithub({ [GRANTED]: () => res({ message: 'Bad credentials' }, 401) });

    await expect(resolveRepos({ baseUrl: 'https://api.github.com' }, { installationId: '42' }, 't'))
      .rejects
      .toThrow(/could not be listed/);
  });

  it('syncs the granted repositories when the config lists none', async () => {
    stubRepo([pr()], { [GRANTED]: () => res({ repositories: [{ full_name: REPO }] }) });

    const docs = await collect(githubConnector.sync(ctx({
      config: { branchPrefix: 'factory/' },
      credentials: { installationId: '42' },
    })));

    expect(docs.map(d => d.externalId)).toEqual([`pr:${REPO}#3`]);
  });
});

describe('githubConnector.inspect', () => {
  const inspect = (config: Record<string, unknown>, credentials: Record<string, unknown>) =>
    githubConnector.inspect!({ config, credentials, options: {} }) as Promise<{ reachable: boolean; authorized: boolean; checks: Array<{ key: string; ok: boolean; detail: string | null }>; note: string | null; error: string | null }>;

  it('refuses without a token, and without repositories a pasted token cannot supply', async () => {
    await expect(inspect({ repos: [REPO] }, {})).rejects.toThrow(/access token is required/);
    // A pasted token carries no repository list, so an empty one leaves
    // nothing to sync and the refusal says where the list can come from.
    await expect(inspect({ repos: [] }, { token: 't' })).rejects.toThrow(/List the repositories to watch/);
    await expect(inspect({}, { token: 't' })).rejects.toThrow(/does not carry a repository list/);
  });

  it('names a malformed repository entry as its own failed check, without calling GitHub for it', async () => {
    const calls = stubGithub({ '/rate_limit': () => res({ rate: { remaining: 1, limit: 5000 } }) });
    const out = await inspect({ repos: ['not-a-repo'] }, { token: 't' });

    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['auth', true], ['repo:not-a-repo', false]]);
    expect(out.checks[1]!.detail).toMatch(/owner\/name/);
    expect(calls).toEqual(['/rate_limit']);
  });

  it('reports a rejected token as one failed check with GitHub\'s message and stops there', async () => {
    stubGithub({ '/rate_limit': () => res({ message: 'Bad credentials' }, 401) });
    const out = await inspect({ repos: [REPO] }, { token: 'bad' });

    expect(out.authorized).toBe(false);
    expect(out.reachable).toBe(true);
    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['auth', false]]);
    expect(out.checks[0]!.detail).toMatch(/401.*Bad credentials/);
  });

  it('checks each repository is reachable and each permission reads, naming the one GitHub asked for on a 403', async () => {
    const other = 'northwind/private';
    stubGithub({
      '/rate_limit': () => res({ rate: { remaining: 4990, limit: 5000 } }),
      [`/repos/${REPO}/pulls`]: () => res([]),
      [`/repos/${REPO}/commits/`]: () => res({ check_runs: [] }),
      [`/repos/${REPO}/actions/runs`]: () => res({ message: 'Resource not accessible by personal access token' }, 403, { 'x-accepted-github-permissions': 'actions=read' }),
      [`/repos/${REPO}`]: () => res({ default_branch: 'main', private: false }),
      [`/repos/${other}`]: () => res({ message: 'Not Found' }, 404),
    });
    const out = await inspect({ repos: [REPO, other] }, { token: 'github_pat_x' });
    const byKey = Object.fromEntries(out.checks.map(c => [c.key, c]));

    expect(out.authorized).toBe(true);
    expect(byKey.auth?.ok).toBe(true);
    expect(byKey[`repo:${REPO}`]?.ok).toBe(true);
    expect(byKey[`pulls:${REPO}`]?.ok).toBe(true);
    expect(byKey[`checks:${REPO}`]?.ok).toBe(true);
    expect(byKey[`actions:${REPO}`]?.ok).toBe(false);
    expect(byKey[`actions:${REPO}`]?.detail).toMatch(/GitHub says the call needs: actions=read/);
    // A private repository the token was not granted answers 404, and the check says so.
    expect(byKey[`repo:${other}`]?.ok).toBe(false);
    expect(byKey[`repo:${other}`]?.detail).toMatch(/404.*not granted/);
    expect(out.checks.some(c => c.key === `pulls:${other}`)).toBe(false);
    expect(out.note).toMatch(/Fine-grained or installation token/);
  });

  it('reports a classic token\'s scopes from the header', async () => {
    stubGithub({
      '/rate_limit': () => res({ rate: { remaining: 1, limit: 5000 } }, 200, { 'x-oauth-scopes': 'repo, read:org' }),
      [`/repos/${REPO}`]: () => res({ default_branch: 'main' }),
      [`/repos/${REPO}/`]: () => res([]),
    });
    const out = await inspect({ repos: [REPO] }, { token: 'ghp_x' });

    expect(out.note).toMatch(/Classic token; GitHub lists its scopes as: repo, read:org/);
  });

  it('names a listed repository the installation did not grant, and stays quiet when the grant is every repository or the list failed', async () => {
    stubGithub({
      '/rate_limit': () => res({ rate: { remaining: 1, limit: 5000 } }),
      [`/repos/${REPO}`]: () => res({ default_branch: 'main', private: true }),
      '/repos/northwind/other': () => res({ message: 'Not Found' }, 404),
    });
    const config = { repos: [REPO, 'northwind/other'] };
    const granted = { installationId: '777', repositorySelection: 'selected', repositories: [REPO] };

    const out = await inspect(config, granted);

    expect(out.checks.filter(c => c.key.startsWith('granted:')).map(c => [c.key, c.ok])).toEqual([['granted:northwind/other', false]]);
    expect(out.checks.find(c => c.key === 'granted:northwind/other')!.detail).toMatch(/installation does not include/);

    const all = await inspect(config, { ...granted, repositorySelection: 'all', repositories: [] });
    const failedListing = await inspect(config, { ...granted, repositories: [] });

    expect(all.checks.some(c => c.key.startsWith('granted:'))).toBe(false);
    expect(failedListing.checks.some(c => c.key.startsWith('granted:'))).toBe(false);
  });
});

describe('githubConnector with a GitHub App installation', () => {
  it('syncs with a token minted for the installation, sent as Bearer', async () => {
    const { installationToken } = await import('@/libs/github/app');
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>).authorization ?? '');
      const path = new URL(String(input)).pathname;
      return res(path.endsWith('/pulls') ? [] : path.includes('/actions/runs') ? NO_RUNS : NO_REVIEWS);
    }));

    await collect(githubConnector.sync(ctx({ credentials: { installationId: '777', account: 'northwind' } })));

    expect(installationToken).toHaveBeenCalledWith('777', { baseUrl: 'https://api.github.com' });
    expect(new Set(seen)).toEqual(new Set(['Bearer ghs_minted_777']));
  });
});
