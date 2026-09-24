/**
 * A dataset's runs read by period: the list, the chart and the summary.
 *
 * The rules are about edges. A run exactly at `from` is in and one exactly at
 * `to` is out, so back-to-back periods never count a run twice. Another org's
 * runs never leak in. The chart reads every run in the period rather than the
 * newest fifty, and says so when it has to stop. The averages cover only the
 * dataset's own grader, because a mean across two graders is a number neither
 * produced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { evalDatasetSchema, evalRunSchema, evalScoreSchema } = await import('@/models/Schema');
const { MAX_TREND_RUNS } = await import('@/libs/evals/runRange');
const { listEvaluatorTrend, listRunsPage, listRunTrend, summariseRunPeriod } = await import('@/services/EvalService');

const ORG = 'org_run_period';
const OTHER_ORG = 'org_run_period_other';
const SEPT_1 = new Date('2026-09-01T00:00:00Z');
const SEPT_8 = new Date('2026-09-08T00:00:00Z');
const SEPT_WEEK = { from: SEPT_1, to: SEPT_8 };

type SeedRun = { startedAt: Date; passRate?: number; provider?: string; status?: string; orgId?: string };

async function createDataset(orgId = ORG): Promise<number> {
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId,
    slug: 'refund-quality',
    name: 'Refund quality',
    agentSlug: 'support-agent',
    items: [{ input: 'one' }],
  }).returning({ id: evalDatasetSchema.id });
  return dataset!.id;
}

async function createRuns(datasetId: number, runs: SeedRun[]): Promise<number[]> {
  const rows = await db.insert(evalRunSchema).values(runs.map(run => ({
    orgId: run.orgId ?? ORG,
    datasetId,
    agentSlug: 'support-agent',
    status: run.status ?? 'succeeded',
    startedAt: run.startedAt,
    provider: run.provider ?? 'vocion',
    metrics: run.passRate === undefined ? {} : { passRate: run.passRate },
  }))).returning({ id: evalRunSchema.id });
  return rows.map(row => row.id);
}

beforeEach(async () => {
  await db.delete(evalScoreSchema);
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

describe('listRunsPage with a period', () => {
  it('includes a run exactly at the start and leaves out one exactly at the end', async () => {
    const datasetId = await createDataset();
    await createRuns(datasetId, [
      { startedAt: new Date('2026-08-31T23:59:59Z') },
      { startedAt: SEPT_1 },
      { startedAt: new Date('2026-09-07T23:59:59Z') },
      { startedAt: SEPT_8 },
    ]);

    const { runs } = await listRunsPage(ORG, datasetId, { range: SEPT_WEEK });

    expect(runs.map(run => run.startedAt.toISOString())).toEqual(['2026-09-07T23:59:59.000Z', '2026-09-01T00:00:00.000Z']);
  });

  it('pages inside the period, so every run in it is reachable', async () => {
    const datasetId = await createDataset();
    await createRuns(datasetId, Array.from({ length: 5 }, (_, i) => ({ startedAt: new Date(SEPT_1.getTime() + i * 3_600_000) })));
    await createRuns(datasetId, [{ startedAt: new Date('2026-10-01T00:00:00Z') }]);

    const second = await listRunsPage(ORG, datasetId, { range: SEPT_WEEK, page: 2, pageSize: 3 });

    expect(second.runs).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });

  it('treats an open-ended range as open, not as empty', async () => {
    const datasetId = await createDataset();
    await createRuns(datasetId, [{ startedAt: new Date('2025-01-01T00:00:00Z') }, { startedAt: SEPT_1 }]);

    const { runs } = await listRunsPage(ORG, datasetId, { range: { to: SEPT_8 } });

    expect(runs).toHaveLength(2);
  });
});

describe('listRunTrend', () => {
  it('reads past the old fifty-run cap when the period holds more', async () => {
    const datasetId = await createDataset();
    await createRuns(datasetId, Array.from({ length: 60 }, (_, i) => ({ startedAt: new Date(SEPT_1.getTime() + i * 60_000), passRate: 0.5 })));

    const trend = await listRunTrend(ORG, datasetId, SEPT_WEEK);

    expect(trend.runs).toHaveLength(60);
    expect(trend.truncated).toBe(false);
  });

  it('keeps the newest runs and says so when the period holds more than the chart draws', async () => {
    const datasetId = await createDataset();
    const count = MAX_TREND_RUNS + 1;
    await createRuns(datasetId, Array.from({ length: count }, (_, i) => ({ startedAt: new Date(SEPT_1.getTime() + i * 60_000), passRate: 0.5 })));

    const trend = await listRunTrend(ORG, datasetId, SEPT_WEEK);

    expect(trend.runs).toHaveLength(MAX_TREND_RUNS);
    expect(trend.truncated).toBe(true);
    // The one dropped is the oldest, so the chart still ends at today.
    expect(trend.runs.at(-1)!.startedAt.getTime()).toBe(SEPT_1.getTime() + 60_000);
  });

  it('plots only finished runs, and none from another org', async () => {
    const datasetId = await createDataset();
    const otherDatasetId = await createDataset(OTHER_ORG);
    await createRuns(datasetId, [
      { startedAt: SEPT_1, passRate: 0.9 },
      { startedAt: SEPT_1, status: 'running' },
      { startedAt: SEPT_1, status: 'failed' },
    ]);
    await createRuns(otherDatasetId, [{ startedAt: SEPT_1, passRate: 0.1, orgId: OTHER_ORG }]);

    const trend = await listRunTrend(ORG, datasetId, SEPT_WEEK);

    expect(trend.runs.map(run => run.metrics.passRate)).toEqual([0.9]);
  });
});

describe('summariseRunPeriod', () => {
  it('counts every run but averages only the dataset\'s own grader', async () => {
    const datasetId = await createDataset();
    await createRuns(datasetId, [
      { startedAt: new Date('2026-09-02T00:00:00Z'), passRate: 0.6 },
      { startedAt: new Date('2026-09-03T00:00:00Z'), passRate: 1 },
      // Another grader's score and a failed run count as runs, never toward the average.
      { startedAt: new Date('2026-09-04T00:00:00Z'), passRate: 0, provider: 'agentcore' },
      { startedAt: new Date('2026-09-05T00:00:00Z'), status: 'failed' },
      // Outside the period altogether.
      { startedAt: new Date('2026-08-01T00:00:00Z'), passRate: 0 },
    ]);

    const summary = await summariseRunPeriod(ORG, datasetId, 'vocion', SEPT_WEEK);

    expect(summary).toEqual({ runCount: 4, scoredCount: 2, averagePassRate: 0.8, latestPassRate: 1 });
  });

  it('reports no pass rate, not 0%, for a period nobody scored', async () => {
    const datasetId = await createDataset();
    await createRuns(datasetId, [{ startedAt: new Date('2026-09-02T00:00:00Z'), status: 'running' }]);

    const summary = await summariseRunPeriod(ORG, datasetId, 'vocion', SEPT_WEEK);

    expect(summary).toEqual({ runCount: 1, scoredCount: 0, averagePassRate: null, latestPassRate: null });
  });

  it('never counts another org\'s runs', async () => {
    const datasetId = await createDataset();
    const otherDatasetId = await createDataset(OTHER_ORG);
    await createRuns(otherDatasetId, [{ startedAt: new Date('2026-09-02T00:00:00Z'), passRate: 0.2, orgId: OTHER_ORG }]);

    // Asking for the other org's dataset id under this org still finds nothing.
    const summary = await summariseRunPeriod(ORG, otherDatasetId, 'vocion', SEPT_WEEK);

    expect(summary.runCount).toBe(0);
    expect((await summariseRunPeriod(ORG, datasetId, 'vocion')).runCount).toBe(0);
  });
});

describe('listEvaluatorTrend with a period', () => {
  it('draws the evaluator lines over the same period as the pass rate', async () => {
    const datasetId = await createDataset();
    const [inside, outside] = await createRuns(datasetId, [
      { startedAt: new Date('2026-09-02T00:00:00Z'), passRate: 1 },
      { startedAt: new Date('2026-08-02T00:00:00Z'), passRate: 1 },
    ]);
    await db.insert(evalScoreSchema).values([
      { runId: inside!, provider: 'vocion', evaluatorSlug: 'helpfulness', value: 0.7 },
      { runId: outside!, provider: 'vocion', evaluatorSlug: 'helpfulness', value: 0.2 },
    ]);

    const rows = await listEvaluatorTrend(ORG, datasetId, SEPT_WEEK);

    expect(rows.map(row => row.runId)).toEqual([inside]);
  });
});
