/**
 * What CI said, read from GitHub (backlog 049): the log tail is cut by the
 * failing step's own timestamps, an Actions job is found from its check run,
 * and a re-run names the failed workflow runs on the head. Fetch is stubbed;
 * every repository is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agents/tools/githubPullRead', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/agents/tools/githubPullRead')>()),
  tokenForRepo: vi.fn(async () => 'github_pat_fixture'),
}));

const { jobOf, logTailFor, parseRunUrl, readCheckLogs, rerunFailedJobs } = await import('./githubChecks');

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(routes: Record<string, unknown>, calls: string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    const key = Object.keys(routes).find(k => `${url.pathname}${url.search}`.startsWith(k) || url.pathname === k);
    if (!key) {
      return new Response('not found', { status: 404 });
    }
    const body = routes[key];
    return typeof body === 'string' ? new Response(body, { status: 200 }) : new Response(body === null ? null : JSON.stringify(body), { status: body === null ? 201 : 200 });
  }));
  return calls;
}

describe('the log tail', () => {
  const log = [
    '2026-09-30T10:00:00.0000000Z ##[group]Run npm test',
    '2026-09-30T10:00:05.0000000Z \u001B[31mFAIL\u001B[0m apps/web/src/rooms.test.ts > opens an invited room',
    '2026-09-30T10:00:06.0000000Z expected 200, got 403',
    '2026-09-30T10:00:30.0000000Z Post job cleanup.',
    '2026-09-30T10:00:31.0000000Z Cleaning up orphan processes',
  ].join('\n');

  it('ends where the failing step ended, without timestamps or colour codes', () => {
    expect(logTailFor(log, '2026-09-30T10:00:07Z')).toBe('##[group]Run npm test\nFAIL apps/web/src/rooms.test.ts > opens an invited room\nexpected 200, got 403');
  });

  it('keeps the last lines when no step says where it ended', () => {
    expect(logTailFor(log, null, 2)).toBe('Post job cleanup.\nCleaning up orphan processes');
  });
});

describe('runs and jobs', () => {
  it('reads a run and a job out of an Actions URL, and nothing out of anything else', () => {
    expect(parseRunUrl('https://github.com/Acme/northwind-core/actions/runs/123/job/456')).toEqual({ owner: 'Acme', repo: 'northwind-core', runId: 123, jobId: 456 });
    expect(parseRunUrl('https://github.com/Acme/northwind-core/actions/runs/123')).toMatchObject({ runId: 123, jobId: null });
    expect(parseRunUrl('https://github.com/Acme/northwind-core/pull/7')).toBeNull();
  });

  it('finds the job behind an Actions check run, and none behind another app\'s', () => {
    expect(jobOf({ id: 9, name: 'test', status: 'completed', app: { slug: 'github-actions' }, details_url: 'https://github.com/Acme/northwind-core/actions/runs/1/job/77' })).toBe(77);
    expect(jobOf({ id: 9, name: 'coverage', status: 'completed', app: { slug: 'codecov' } })).toBeNull();
  });
});

describe('readCheckLogs', () => {
  it('names each failing check with its annotations, failing step and log tail, and the files changed', async () => {
    const base = '/repos/Acme/northwind-core';
    stub({
      [`${base}/pulls/7/files`]: [{ filename: 'apps/web/src/rooms.ts' }],
      [`${base}/pulls/7`]: { number: 7, head: { ref: 'factory/t7', sha: 'abc123' }, base: { ref: 'main' }, state: 'open' },
      [`${base}/commits/abc123/check-runs`]: { check_runs: [
        { id: 77, name: 'test', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' }, details_url: 'https://github.com/Acme/northwind-core/actions/runs/1/job/77' },
        { id: 78, name: 'lint', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } },
      ] },
      [`${base}/check-runs/77/annotations`]: [{ path: 'apps/web/src/rooms.test.ts', start_line: 42, message: 'expected 200, got 403', annotation_level: 'failure' }, { path: '.github', message: 'Process completed with exit code 1.', annotation_level: 'warning' }],
      [`${base}/actions/jobs/77/logs`]: '2026-09-30T10:00:05.0000000Z FAIL rooms.test.ts',
      [`${base}/actions/jobs/77`]: { steps: [{ name: 'Checkout', conclusion: 'success' }, { name: 'Run the suite', conclusion: 'failure', completed_at: '2026-09-30T10:00:06Z' }] },
    });

    const logs = await readCheckLogs('org_1', 'https://github.com/Acme/northwind-core/pull/7');

    expect(logs).toMatchObject({ repo: 'Acme/northwind-core', number: 7, headSha: 'abc123', baseBranch: 'main', checkCount: 2, changedFiles: ['apps/web/src/rooms.ts'] });
    expect(logs.failing).toEqual([{ name: 'test', conclusion: 'failure', url: 'https://github.com/Acme/northwind-core/actions/runs/1/job/77', step: 'Run the suite', annotations: ['apps/web/src/rooms.test.ts:42 expected 200, got 403'], summary: null, logTail: 'FAIL rooms.test.ts' }]);
  });
});

describe('rerunFailedJobs', () => {
  it('re-runs the failed jobs of every failed workflow run on the head', async () => {
    const base = '/repos/Acme/northwind-core';
    const calls = stub({
      [`${base}/actions/runs?head_sha=abc123`]: { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'failure' }, { id: 6, status: 'completed', conclusion: 'success' }] },
      [`${base}/actions/runs/5/rerun-failed-jobs`]: null,
    });

    const res = await rerunFailedJobs('org_1', 'https://github.com/Acme/northwind-core/pull/7', 'abc123');

    expect(res).toEqual({ repo: 'Acme/northwind-core', headSha: 'abc123', runIds: [5] });
    expect(calls).toContain(`POST ${base}/actions/runs/5/rerun-failed-jobs`);
  });

  it('says why when there is nothing to re-run, or GitHub refuses', async () => {
    const base = '/repos/Acme/northwind-core';
    stub({ [`${base}/actions/runs?head_sha=abc123`]: { workflow_runs: [] } });

    await expect(rerunFailedJobs('org_1', 'https://github.com/Acme/northwind-core/pull/7', 'abc123')).rejects.toThrow(/no failed GitHub Actions run on abc123/);

    stub({ [`${base}/actions/runs?head_sha=abc123`]: { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'failure' }] } });

    await expect(rerunFailedJobs('org_1', 'https://github.com/Acme/northwind-core/pull/7', 'abc123')).rejects.toThrow(/Actions: write/);
  });
});
