import type { GithubSourceRef, GithubWebhookDeps } from './GithubWebhookService';
/**
 * The GitHub webhook receiver, with its dependencies faked: refuses an
 * unsigned or mis-signed delivery, answers 501 with no secret, acknowledges a
 * ping, fans a delivery out to every source that lists the repository (and to
 * no other), applies each source's branch prefix, hydrates a completed check
 * suite through the API with the source's token, and emits the connector's
 * own dedupe keys so the next poll is a no-op.
 */
import type { GithubEvent } from '@/libs/github/events';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubConfigSchema } from '@/libs/sources/github';
import { handleGithubWebhook } from './GithubWebhookService';

const SECRET = 'hook-secret';
const REPO = 'northwind/orders-api';

function source(orgId: string, config: Record<string, unknown> = {}): GithubSourceRef {
  return { orgId, sourceId: orgId === 'org_a' ? 1 : 2, apiTokenId: null, config: githubConfigSchema.parse({ repos: [REPO], ...config }) };
}

function pr(over: Record<string, unknown> = {}) {
  return {
    number: 3,
    title: 'feat(intake): accept requests',
    state: 'open',
    html_url: `https://github.com/${REPO}/pull/3`,
    user: { login: 'factory-bot' },
    head: { ref: 'factory/task-042', sha: 'abc123' },
    base: { ref: 'main' },
    created_at: '2026-09-19T14:00:00Z',
    updated_at: '2026-09-19T14:00:00Z',
    ...over,
  };
}

function deliver(event: string, body: unknown, opts: { secret?: string | undefined; sign?: string | null } = {}) {
  const raw = JSON.stringify(body);
  const signature = opts.sign === null
    ? null
    : opts.sign ?? `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const headers = new Headers({ 'x-github-event': event, 'x-github-delivery': 'd-1' });
  if (signature) {
    headers.set('x-hub-signature-256', signature);
  }
  return { rawBody: raw, headers, secret: 'secret' in opts ? opts.secret : SECRET };
}

function fakeDeps(sources: GithubSourceRef[], token?: string) {
  const emitted: Array<{ orgId: string; sourceId: number; event: GithubEvent }> = [];
  const deps: GithubWebhookDeps = {
    sourcesForRepo: vi.fn(async (repo: string) => sources.filter(s => s.config.repos.includes(repo))),
    tokenFor: vi.fn(async () => token),
    emit: vi.fn(async (orgId, sourceId, event) => {
      emitted.push({ orgId, sourceId, event });
    }),
  };
  return { deps, emitted };
}

afterEach(() => vi.unstubAllGlobals());

describe('handleGithubWebhook', () => {
  it('answers 501 with no secret configured and 401 for a missing or wrong signature, before reading the body', async () => {
    const { deps } = fakeDeps([source('org_a')]);
    const body = { action: 'opened', pull_request: pr(), repository: { full_name: REPO } };

    expect((await handleGithubWebhook(deliver('pull_request', body, { secret: undefined }), deps)).status).toBe(501);
    expect((await handleGithubWebhook(deliver('pull_request', body, { sign: null }), deps)).status).toBe(401);
    expect((await handleGithubWebhook(deliver('pull_request', body, { sign: 'sha256=0000' }), deps)).status).toBe(401);
    expect(deps.sourcesForRepo).not.toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it('answers 400 for a signed body that is not JSON', async () => {
    const raw = 'not json';
    const headers = new Headers({ 'x-github-event': 'pull_request', 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` });

    expect((await handleGithubWebhook({ rawBody: raw, headers, secret: SECRET }, fakeDeps([]).deps)).status).toBe(400);
  });

  it('acknowledges GitHub\'s ping without looking anything up', async () => {
    const { deps } = fakeDeps([source('org_a')]);
    const out = await handleGithubWebhook(deliver('ping', { zen: 'Design for failure.', hook_id: 1 }), deps);

    expect(out).toEqual({ status: 200, body: { ok: true, pong: true } });
    expect(deps.sourcesForRepo).not.toHaveBeenCalled();
  });

  it('acknowledges a repository no source lists, emitting nothing', async () => {
    const { deps, emitted } = fakeDeps([source('org_a')]);
    const out = await handleGithubWebhook(deliver('pull_request', { action: 'opened', pull_request: pr(), repository: { full_name: 'someone/else' } }), deps);

    expect(out.status).toBe(200);
    expect(out.body.ignored).toMatch(/no github source lists someone\/else/);
    expect(emitted).toEqual([]);
  });

  it('emits pr.opened to every org whose source lists the repository, with the connector\'s dedupe key', async () => {
    const { deps, emitted } = fakeDeps([source('org_a'), source('org_b'), { ...source('org_c'), config: githubConfigSchema.parse({ repos: ['northwind/other'] }) }]);
    const out = await handleGithubWebhook(deliver('pull_request', { action: 'opened', pull_request: pr(), repository: { full_name: REPO } }), deps);

    expect(out.body).toEqual({ ok: true, emitted: 2 });
    expect(emitted.map(e => e.orgId)).toEqual(['org_a', 'org_b']);
    expect(emitted[0]!.event).toMatchObject({
      type: 'pr.opened',
      dedupeKey: `github:${REPO}#3:pr.opened:abc123`,
      payload: { repo: REPO, number: 3, headSha: 'abc123', branch: 'factory/task-042', title: 'feat(intake): accept requests', author: 'factory-bot' },
    });
  });

  it('applies each source\'s own branch prefix', async () => {
    const { deps, emitted } = fakeDeps([source('org_a', { branchPrefix: 'factory/' }), source('org_b', { branchPrefix: 'release/' })]);
    await handleGithubWebhook(deliver('pull_request', { action: 'synchronize', pull_request: pr(), repository: { full_name: REPO } }), deps);

    expect(emitted.map(e => [e.orgId, e.event.type])).toEqual([['org_a', 'pr.synchronized']]);
  });

  it('emits run.failed for a failed run on the source\'s deploy branch, whatever the prefix', async () => {
    const { deps, emitted } = fakeDeps([source('org_a', { branchPrefix: 'factory/', deployBranch: 'production' })]);
    const run = { id: 9, name: 'Deploy', head_branch: 'production', head_sha: 'x', run_number: 1, run_attempt: 1, event: 'push', status: 'completed', conclusion: 'failure', html_url: 'u', updated_at: '2026-09-19T17:00:00Z' };
    await handleGithubWebhook(deliver('workflow_run', { action: 'completed', workflow_run: run, repository: { full_name: REPO } }), deps);

    expect(emitted.map(e => e.event.type)).toEqual(['run.failed']);
    expect(emitted[0]!.event.dedupeKey).toBe(`github:${REPO}:run.failed:9:1`);
  });

  it('hydrates a completed check suite through the API with the source\'s token and emits pr.checks_completed', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.pathname);

      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer github_pat_vaulted');

      const body = url.pathname.endsWith('/check-runs')
        ? { check_runs: [{ id: 1, name: 'unit', status: 'completed', conclusion: 'failure' }] }
        : pr();
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => '' } as unknown as Response;
    }));
    const { deps, emitted } = fakeDeps([source('org_a')], 'github_pat_vaulted');
    const suite = { head_sha: 'abc123', conclusion: 'failure', pull_requests: [{ number: 3, head: { ref: 'factory/task-042', sha: 'abc123' } }] };
    await handleGithubWebhook(deliver('check_suite', { action: 'completed', check_suite: suite, repository: { full_name: REPO } }), deps);

    expect(calls).toEqual([`/repos/${REPO}/pulls/3`, `/repos/${REPO}/commits/abc123/check-runs`]);
    expect(emitted.map(e => e.event.type)).toEqual(['pr.checks_completed']);
    expect(emitted[0]!.event).toMatchObject({ dedupeKey: `github:${REPO}#3:pr.checks_completed:abc123`, payload: { conclusion: 'failure', failedChecks: 'unit' } });
  });

  it('leaves a check suite for the next poll when the source holds no token', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { deps, emitted } = fakeDeps([source('org_a')]);
    const suite = { head_sha: 'abc123', conclusion: 'failure', pull_requests: [{ number: 3, head: { ref: 'factory/task-042', sha: 'abc123' } }] };
    const out = await handleGithubWebhook(deliver('check_suite', { action: 'completed', check_suite: suite, repository: { full_name: REPO } }), deps);

    expect(out.body).toEqual({ ok: true, emitted: 0 });
    expect(emitted).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
