/**
 * `repo.cancel_pipeline_run`: a run that should not be running, stopped
 * through the provider; Undo starts it again, and a run that had already
 * finished is left as it ended.
 */
import { describe, expect, it, vi } from 'vitest';

const cancelPipelineRun = vi.fn(async () => ({ cancelled: true }));
const rerunPipelineRun = vi.fn(async () => undefined);
const provider = { kind: 'github', label: 'GitHub', parseRunRef: (url: string) => (url.includes('/actions/runs/') ? { repo: 'Acme/northwind-core', runId: 36001, url } : null), cancelPipelineRun, rerunPipelineRun };
vi.mock('@/services/repo/provider', () => ({ repoProviderFor: vi.fn(async () => provider) }));
const noteOnRecord = vi.fn(async () => undefined);
vi.mock('@/services/factory/environments', () => ({ noteOnRecord }));

const { repoCancelPipelineRunAction: action } = await import('./repo-cancel-pipeline-run');
const url = 'https://github.com/Acme/northwind-core/actions/runs/36001';
const input = { url, reason: 'A duplicate of run #36002 on the same commit.' };

describe('repo.cancel_pipeline_run', () => {
  it('cancels the run the URL names, writes the line on the environment, and Undo starts it again', async () => {
    const out = await action.execute({ orgId: 'org_1', runId: 3 }, { ...input, recordId: 12 });

    expect(cancelPipelineRun).toHaveBeenCalledWith('org_1', { repo: 'Acme/northwind-core', runId: 36001, url });
    expect(out).toMatchObject({ cancelled: true, runId: 36001, objectId: 12, line: expect.stringContaining('Stopped pipeline run #36001') });
    expect(noteOnRecord).toHaveBeenCalledWith('org_1', 12, expect.any(String), { runId: 3, url });

    await expect(action.undo!({ orgId: 'org_1' }, input, out)).resolves.toMatchObject({ restarted: true, runId: 36001 });
    expect(rerunPipelineRun).toHaveBeenCalledWith('org_1', { repo: 'Acme/northwind-core', runId: 36001, url });
  });

  it('a run that had finished is left as it ended, and its Undo starts nothing', async () => {
    cancelPipelineRun.mockResolvedValueOnce({ cancelled: false });
    const before = rerunPipelineRun.mock.calls.length;
    const out = await action.execute({ orgId: 'org_1' }, input);

    expect(out).toMatchObject({ cancelled: false, line: expect.stringContaining('had already finished') });
    await expect(action.undo!({ orgId: 'org_1' }, input, out)).resolves.toMatchObject({ restarted: false });
    expect(rerunPipelineRun.mock.calls.length).toBe(before);
  });

  it('takes a repository and run id instead of a URL, refuses neither, and is one stop per run', async () => {
    await expect(action.precheck!({ orgId: 'org_1' }, { repo: 'Acme/northwind-core', runId: 36001, reason: input.reason })).resolves.toBeUndefined();
    await expect(action.precheck!({ orgId: 'org_1' }, { reason: input.reason })).resolves.toMatch(/Name the run/);
    await expect(action.precheck!({ orgId: 'org_1' }, { url: 'https://github.com/Acme/northwind-core/pull/7', reason: input.reason })).resolves.toMatch(/not a pipeline run URL/);
    expect(action.dedupKeyFor!(input)).toBe(action.dedupKeyFor!({ ...input, reason: 'another reason' }));
  });
});
