/**
 * The nightly eval refresh job.
 *
 * Two rules worth pinning. It covers every dataset in the workspace when the
 * automation names none — a nightly cadence that silently refreshed nothing
 * would leave a flat trend line that looks like stability. And one dataset
 * failing to start does not cancel the others: the point of the schedule is
 * the history it builds, and losing every dataset because one is misconfigured
 * puts a hole in all of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/evals/refresh', () => ({ startEvalRefresh: vi.fn() }));

const { db } = await import('@/libs/DB');
const { evalDatasetSchema } = await import('@/models/Schema');
const { startEvalRefresh } = await import('@/services/evals/refresh');
const { runRefreshEvalsJob } = await import('./refreshEvals');

const mockStart = vi.mocked(startEvalRefresh);
const ORG = 'org_refresh_evals_job';
const OTHER_ORG = 'org_refresh_evals_other';

async function insertDataset(orgId: string, slug: string) {
  await db.insert(evalDatasetSchema).values({
    orgId,
    slug,
    name: slug,
    agentSlug: 'support-agent',
    items: [{ input: 'x' }],
  });
}

beforeEach(async () => {
  mockStart.mockReset();
  mockStart.mockImplementation(async ({ datasetSlug }) => ({
    runId: 1,
    runGroupId: `group-${datasetSlug}`,
    providerIds: ['vocion'],
  }));
  await db.delete(evalDatasetSchema);
  await insertDataset(ORG, 'refund-quality');
  await insertDataset(ORG, 'tone-check');
  await insertDataset(OTHER_ORG, 'someone-elses-dataset');
});

describe('runRefreshEvalsJob', () => {
  it('refreshes every dataset in the workspace when the automation names none', async () => {
    const result = await runRefreshEvalsJob(ORG, {});

    expect(result.started).toBe(2);
    expect(result.datasets.map(d => d.datasetSlug).sort()).toEqual(['refund-quality', 'tone-check']);
  });

  it('does nothing, quietly, for a workspace with no datasets', async () => {
    await db.delete(evalDatasetSchema);

    const result = await runRefreshEvalsJob(ORG, {});

    expect(result).toEqual({ started: 0, failed: 0, datasets: [] });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('never reaches into another workspace', async () => {
    await runRefreshEvalsJob(ORG, {});

    const slugs = mockStart.mock.calls.map(call => call[0].datasetSlug);

    expect(slugs).not.toContain('someone-elses-dataset');
  });

  it('refreshes only the datasets the automation named', async () => {
    const result = await runRefreshEvalsJob(ORG, { dataset: 'tone-check' });

    expect(result.datasets.map(d => d.datasetSlug)).toEqual(['tone-check']);
  });

  it('keeps going when one dataset cannot be started', async () => {
    mockStart.mockImplementation(async ({ datasetSlug }) => {
      if (datasetSlug === 'refund-quality') {
        throw new Error('temporal unreachable');
      }
      return { runId: 2, runGroupId: 'group-tone', providerIds: ['vocion'] };
    });

    const result = await runRefreshEvalsJob(ORG, {});

    expect(result.started).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.datasets.find(d => d.datasetSlug === 'refund-quality')?.error).toContain('temporal unreachable');
  });

  it('passes the automation\'s provider and concurrency choices through', async () => {
    await runRefreshEvalsJob(ORG, { dataset: ['tone-check'], providers: ['agentcore'], concurrency: 4 });

    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
      datasetSlug: 'tone-check',
      providerIds: ['agentcore'],
      concurrency: 4,
    }));
  });
});
