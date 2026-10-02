/**
 * `repo.rerun_failed_checks` (backlog 049): reversible by nature — Undo
 * cancels the re-run while it runs — so the trust ladder can run it done for
 * you; one re-run per head.
 */
import { describe, expect, it, vi } from 'vitest';

const rerunFailedJobs = vi.fn(async () => ({ repo: 'Acme/northwind-core', headSha: 'abc123', runIds: [5, 6] }));
const cancelWorkflowRuns = vi.fn(async () => ({ cancelled: [5], finished: [6] }));
vi.mock('@/services/factory/githubChecks', () => ({ rerunFailedJobs, cancelWorkflowRuns }));

const { githubRerunFailedJobsAction: action } = await import('./github-rerun');

const input = { url: 'https://github.com/Acme/northwind-core/pull/7', headSha: 'abc123def456' };

describe('repo.rerun_failed_checks', () => {
  it('re-runs through the workspace token and returns the runs it started', async () => {
    const out = await action.execute({ orgId: 'org_1' }, input);

    expect(rerunFailedJobs).toHaveBeenCalledWith('org_1', input.url, input.headSha);
    expect(out).toMatchObject({ rerun: true, repo: 'Acme/northwind-core', runIds: [5, 6] });
  });

  it('is undone by cancelling what is still running', async () => {
    const out = await action.undo!({ orgId: 'org_1' }, input, { repo: 'Acme/northwind-core', runIds: [5, 6] });

    expect(cancelWorkflowRuns).toHaveBeenCalledWith('org_1', 'Acme/northwind-core', [5, 6]);
    expect(out).toMatchObject({ cancelled: [5], finished: [6] });
  });

  it('is one re-run per head', () => {
    expect(action.dedupKeyFor!(input)).toBe(action.dedupKeyFor!({ ...input, taskId: 3 }));
    expect(action.dedupKeyFor!(input)).not.toBe(action.dedupKeyFor!({ ...input, headSha: 'fff000fff000' }));
  });
});
