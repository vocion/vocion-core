/**
 * The two rules the eval trend line depends on to tell the truth.
 *
 * A boundary is drawn where the dataset changed, because a pass rate before an
 * edit to the cases and one after it are measurements of two different tests —
 * and drawing one where nothing changed would train people to ignore them.
 *
 * Each grader is its own line, in the order the page gave, so a colour does not
 * move from one provider to another when a grader has no runs yet.
 */
import { describe, expect, it } from 'vitest';
import { buildSeries, versionBoundaries } from './evalTrend';

const PROVIDERS = [{ id: 'vocion', label: 'Vocion' }, { id: 'agentcore', label: 'AgentCore' }];

function point(overrides: {
  runId: number;
  provider?: string;
  startedAt: string;
  passRate?: number;
  datasetVersion?: number | null;
  evaluatorSlug?: string | null;
}) {
  return {
    runId: overrides.runId,
    provider: overrides.provider ?? 'vocion',
    startedAt: overrides.startedAt,
    passRate: overrides.passRate ?? 0.5,
    datasetVersion: overrides.datasetVersion === undefined ? 1 : overrides.datasetVersion,
    evaluatorSlug: overrides.evaluatorSlug ?? null,
  };
}

describe('versionBoundaries', () => {
  it('marks the first run on a new version of the dataset', () => {
    const boundaries = versionBoundaries([
      point({ runId: 1, startedAt: '2026-09-01T00:00:00.000Z', datasetVersion: 1 }),
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 2 }),
      point({ runId: 3, startedAt: '2026-09-03T00:00:00.000Z', datasetVersion: 2 }),
    ]);

    expect(boundaries).toEqual([{ at: Date.parse('2026-09-02T00:00:00.000Z'), version: 2 }]);
  });

  it('draws nothing while the dataset stays the same', () => {
    const boundaries = versionBoundaries([
      point({ runId: 1, startedAt: '2026-09-01T00:00:00.000Z', datasetVersion: 3 }),
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 3 }),
    ]);

    expect(boundaries).toEqual([]);
  });

  it('reads the versions in time order, not the order it was handed', () => {
    const boundaries = versionBoundaries([
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 2 }),
      point({ runId: 1, startedAt: '2026-09-01T00:00:00.000Z', datasetVersion: 1 }),
    ]);

    expect(boundaries).toEqual([{ at: Date.parse('2026-09-02T00:00:00.000Z'), version: 2 }]);
  });

  it('ignores runs from before versions were recorded', () => {
    const boundaries = versionBoundaries([
      point({ runId: 1, startedAt: '2026-09-01T00:00:00.000Z', datasetVersion: null }),
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 1 }),
    ]);

    expect(boundaries).toEqual([]);
  });
});

describe('buildSeries', () => {
  it('gives each grader its own line, sorted in time', () => {
    const series = buildSeries([
      point({ runId: 2, provider: 'vocion', startedAt: '2026-09-02T00:00:00.000Z' }),
      point({ runId: 1, provider: 'vocion', startedAt: '2026-09-01T00:00:00.000Z' }),
      point({ runId: 3, provider: 'agentcore', startedAt: '2026-09-02T00:00:00.000Z' }),
    ], PROVIDERS);

    expect(series.map(line => line.provider)).toEqual(['vocion', 'agentcore']);
    expect(series[0]?.points.map(p => p.runId)).toEqual([1, 2]);
  });

  it('skips a grader with no runs instead of drawing an empty line', () => {
    const series = buildSeries([
      point({ runId: 1, provider: 'agentcore', startedAt: '2026-09-01T00:00:00.000Z' }),
    ], PROVIDERS);

    expect(series).toHaveLength(1);
    expect(series[0]?.provider).toBe('agentcore');
  });

  it('keeps a grader on the same colour when another one has no runs', () => {
    const both = buildSeries([
      point({ runId: 1, provider: 'vocion', startedAt: '2026-09-01T00:00:00.000Z' }),
      point({ runId: 2, provider: 'agentcore', startedAt: '2026-09-01T00:00:00.000Z' }),
    ], PROVIDERS);
    const onlyVocion = buildSeries([
      point({ runId: 1, provider: 'vocion', startedAt: '2026-09-01T00:00:00.000Z' }),
    ], PROVIDERS);

    expect(onlyVocion[0]?.color).toBe(both[0]?.color);
  });
});

describe('buildSeries, per evaluator', () => {
  it('gives every evaluator its own line under the grader that ran it', () => {
    const series = buildSeries([
      point({ runId: 1, provider: 'agentcore', startedAt: '2026-09-01T00:00:00.000Z', passRate: 0.5 }),
      point({ runId: 1, provider: 'agentcore', startedAt: '2026-09-01T00:00:00.000Z', passRate: 0.9, evaluatorSlug: 'trajectory' }),
      point({ runId: 1, provider: 'agentcore', startedAt: '2026-09-01T00:00:00.000Z', passRate: 0.2, evaluatorSlug: 'helpfulness' }),
    ], PROVIDERS);

    // An agent whose answers rot while its tool use improves holds one flat
    // pass rate the whole way; only the evaluator lines show which moved.
    expect(series.map(line => line.key)).toEqual(['agentcore', 'agentcore:helpfulness', 'agentcore:trajectory']);
    expect(series.map(line => line.label)).toEqual(['AgentCore', 'AgentCore · helpfulness', 'AgentCore · trajectory']);
    expect(series.filter(line => line.dashed)).toHaveLength(2);
  });

  it('keeps a grader with only evaluator scores on the chart', () => {
    const series = buildSeries([
      point({ runId: 7, provider: 'agentcore', startedAt: '2026-09-01T00:00:00.000Z', evaluatorSlug: 'trajectory' }),
    ], PROVIDERS);

    // A run whose own pass rate never landed still measured something, and
    // dropping the line would read as the grader never having run.
    expect(series).toHaveLength(1);
    expect(series[0]?.evaluatorSlug).toBe('trajectory');
  });

  it('draws one boundary for a run, however many lines pass through it', () => {
    const boundaries = versionBoundaries([
      point({ runId: 1, startedAt: '2026-09-01T00:00:00.000Z', datasetVersion: 1 }),
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 2 }),
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 2, evaluatorSlug: 'trajectory' }),
      point({ runId: 2, startedAt: '2026-09-02T00:00:00.000Z', datasetVersion: 2, evaluatorSlug: 'helpfulness' }),
    ]);

    expect(boundaries).toEqual([{ at: Date.parse('2026-09-02T00:00:00.000Z'), version: 2 }]);
  });
});
