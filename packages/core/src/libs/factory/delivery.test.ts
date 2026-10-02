import { describe, expect, it } from 'vitest';
import { deliveryRunsOf, deliveryStage, readDelivery, runName, runningRun } from './delivery';

describe('a request\'s delivery (after the merge)', () => {
  const base = { prUrl: 'https://github.com/northwind/share/pull/41', mergedAt: '2026-09-30T22:38:05Z', runs: [] as unknown[] };

  it('reads what was written, and nothing from a half-written one', () => {
    expect(readDelivery({ delivery: base })).toMatchObject({ prUrl: base.prUrl, runs: [], mergedBy: null });
    expect(readDelivery({ delivery: { prUrl: base.prUrl } })).toBeNull();
    expect(readDelivery({})).toBeNull();
  });

  it('says where the runs stand, and which one carries it', () => {
    const run = (over: Record<string, unknown>) => ({ runId: 1, name: 'Deploy', runNumber: 7, url: 'u', status: 'completed', conclusion: 'success', startedAt: '2026-09-30T22:38:11Z', ...over });
    const d = (runs: unknown[]) => readDelivery({ delivery: { ...base, runs } })!;

    expect(deliveryStage(d([]))).toBe('unread');
    expect(deliveryStage(d([run({}), run({ runId: 2, status: 'in_progress', conclusion: null })]))).toBe('deploying');
    expect(deliveryStage(d([run({}), run({ runId: 2, conclusion: 'skipped' })]))).toBe('deployed');
    expect(deliveryStage(d([run({}), run({ runId: 2, conclusion: 'failure' })]))).toBe('failed');
    expect(runningRun(d([run({ runId: 2, status: 'queued', startedAt: '2026-09-30T22:39:00Z' }), run({ runId: 3, status: 'in_progress', startedAt: '2026-09-30T22:38:11Z' })]))?.runId).toBe(3);
    expect(runName(run({}) as never)).toBe('Deploy run #7');
  });

  it('keeps the runs on the merge commit, newest first, at most five', () => {
    const listed = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: 'CI', run_number: i + 1, html_url: `u${i}`, status: 'completed', conclusion: 'success', run_started_at: `2026-09-30T22:3${i}:00Z`, head_sha: 'abc' }));
    const runs = deliveryRunsOf([...listed, { ...listed[0]!, id: 99, head_sha: 'other' }], 'abc');

    expect(runs).toHaveLength(5);
    expect(runs[0]!.runId).toBe(7);
    expect(runs.some(r => r.runId === 99)).toBe(false);
  });
});
