/**
 * GitHub as the repo family's first provider: the host's REST calls behind
 * each construct, with the repository's own credential. GitHub is mocked at
 * `githubChecks.call`; the repository is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const call = vi.fn();
const cancelWorkflowRuns = vi.fn(async (_org: string, _repo: string, ids: number[]) => ({ cancelled: ids, finished: [] as number[] }));
vi.mock('@/services/factory/githubChecks', async () => {
  const actual = await vi.importActual<typeof import('@/services/factory/githubChecks')>('@/services/factory/githubChecks');
  return { ...actual, call, cancelWorkflowRuns, ghFor: vi.fn(async (_org: string, full: string) => ({ owner: full.split('/')[0], repo: full.split('/')[1], token: 't' })) };
});

const { githubRepoProvider: gh } = await import('./github');
const ref = { repo: 'Acme/northwind-core', number: 7, url: 'https://github.com/Acme/northwind-core/pull/7' };

describe('the GitHub provider', () => {
  // A hook that RETURNS the mock registers it as a cleanup hook (vitest 4), which
  // then calls it with no arguments; the braces keep the mock out of the return.
  beforeEach(() => {
    call.mockReset();
  });

  it('names a pull request and a run from their URLs, and nothing else', () => {
    expect(gh.parsePullRef('https://github.com/Acme/northwind-core/pull/7/files')).toEqual(ref);
    expect(gh.parsePullRef('https://github.com/Acme/northwind-core')).toBeNull();
    expect(gh.parseRunRef('https://github.com/Acme/northwind-core/actions/runs/36001/job/9')).toEqual({ repo: 'Acme/northwind-core', runId: 36001, url: 'https://github.com/Acme/northwind-core/actions/runs/36001' });
    expect(gh.pullUrl('Acme/northwind-core', 7)).toBe(ref.url);
  });

  it('reads a pull request as one summary: files, reviews and checks beside the metadata', async () => {
    call.mockImplementation(async (_gh: unknown, path: string) => {
      if (path === '/pulls/7') {
        return { ok: true, status: 200, data: { number: 7, title: 'Fix the report', state: 'open', html_url: ref.url, user: { login: 'worker' }, head: { ref: 'factory/41', sha: 'abc123def456' }, base: { ref: 'main' }, body: 'Contract #41', additions: 3, deletions: 1, changed_files: 1, labels: [{ name: 'factory' }], created_at: 'c', updated_at: 'u' } };
      }
      if (path.startsWith('/pulls/7/files')) {
        return { ok: true, status: 200, data: [{ filename: 'src/report.ts', status: 'modified', additions: 3, deletions: 1 }] };
      }
      if (path.startsWith('/pulls/7/reviews')) {
        return { ok: true, status: 200, data: [{ id: 1, state: 'APPROVED', user: { login: 'qa' }, submitted_at: 's', commit_id: 'abc', html_url: 'r' }] };
      }
      if (path.startsWith('/commits/abc123def456/check-runs')) {
        return { ok: true, status: 200, data: { check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] } };
      }
      return { ok: false, status: 404, message: 'HTTP 404' };
    });
    const pull = await gh.readPull('org_1', ref);

    expect(pull).toMatchObject({ title: 'Fix the report', author: 'worker', headBranch: 'factory/41', headSha: 'abc123def456', baseBranch: 'main', merged: false, labels: ['factory'], files: [{ path: 'src/report.ts', status: 'modified' }], reviews: [{ reviewer: 'qa', state: 'APPROVED' }], checks: [{ name: 'ci', conclusion: 'success' }] });
  });

  it('posts a comment and deletes it; submits a review with its inline findings and dismisses it', async () => {
    call.mockResolvedValueOnce({ ok: true, status: 201, data: { id: 501, html_url: `${ref.url}#issuecomment-501` } });

    await expect(gh.commentPull('org_1', ref, 'Run report')).resolves.toEqual({ commentId: 501, url: `${ref.url}#issuecomment-501` });
    expect(call).toHaveBeenLastCalledWith(expect.anything(), '/issues/7/comments', { method: 'POST', body: { body: 'Run report' } });

    call.mockResolvedValueOnce({ ok: false, status: 404, message: 'HTTP 404' });

    await expect(gh.deletePullComment('org_1', ref.repo, 501)).resolves.toBeUndefined();

    call.mockResolvedValueOnce({ ok: true, status: 200, data: { id: 9001, html_url: `${ref.url}#pullrequestreview-9001` } });

    await expect(gh.submitReview('org_1', ref, { event: 'request_changes', body: 'Criterion 2 unproven', comments: [{ path: 'src/report.ts', line: 12, body: 'against criterion 2' }] })).resolves.toEqual({ reviewId: 9001, url: `${ref.url}#pullrequestreview-9001` });
    expect(call).toHaveBeenLastCalledWith(expect.anything(), '/pulls/7/reviews', { method: 'POST', body: { event: 'REQUEST_CHANGES', body: 'Criterion 2 unproven', comments: [{ path: 'src/report.ts', line: 12, side: 'RIGHT', body: 'against criterion 2' }] } });

    call.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
    await gh.dismissReview('org_1', ref, 9001, 'Undone');

    expect(call).toHaveBeenLastCalledWith(expect.anything(), '/pulls/7/reviews/9001/dismissals', { method: 'PUT', body: { message: 'Undone', event: 'DISMISS' } });
  });

  it('a refused write carries the host\'s reason and what the credential needs', async () => {
    call.mockResolvedValueOnce({ ok: false, status: 403, message: 'HTTP 403: Resource not accessible by integration' });

    await expect(gh.commentPull('org_1', ref, 'Run report')).rejects.toThrow(/Resource not accessible.*Pull requests: write/);
  });

  it('cancels a run through the factory\'s own cancel, and starts one again whole', async () => {
    const run = { repo: ref.repo, runId: 36001, url: 'https://github.com/Acme/northwind-core/actions/runs/36001' };

    await expect(gh.cancelPipelineRun('org_1', run)).resolves.toEqual({ cancelled: true });
    expect(cancelWorkflowRuns).toHaveBeenCalledWith('org_1', ref.repo, [36001]);

    call.mockResolvedValueOnce({ ok: true, status: 201, data: undefined });
    await gh.rerunPipelineRun('org_1', run);

    expect(call).toHaveBeenLastCalledWith(expect.anything(), '/actions/runs/36001/rerun', { method: 'POST', body: {} });
  });
});
