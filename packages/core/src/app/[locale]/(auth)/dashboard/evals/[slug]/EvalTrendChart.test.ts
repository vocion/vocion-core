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
import { buildSeries, versionBoundaries } from './EvalTrendChart';

const PROVIDERS = [{ id: 'vocion', label: 'Vocion' }, { id: 'agentcore', label: 'AgentCore' }];

function point(overrides: {
  runId: number;
  provider?: string;
  startedAt: string;
  passRate?: number;
  datasetVersion?: number | null;
}) {
  return {
    runId: overrides.runId,
    provider: overrides.provider ?? 'vocion',
    startedAt: overrides.startedAt,
    passRate: overrides.passRate ?? 0.5,
    datasetVersion: overrides.datasetVersion === undefined ? 1 : overrides.datasetVersion,
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
