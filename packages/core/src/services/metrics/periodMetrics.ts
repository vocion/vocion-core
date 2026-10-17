/**
 * A Metrics page's figures, period by period: each figure's source read once
 * per week or month through the team report's own reader, so a figure carries
 * the same provenance, freshness and "not a zero" states a team measure does.
 * Activity is counted whoever did it, agent or person: the page shows the
 * raw numbers.
 */

import type { Period, PeriodUnit } from './periods';
import type { PageMetric, PageMetrics } from '@/libs/workspace/pageFields';
import type { Freshness, MeasureScope, MeasureUnavailableKind, ProvenanceKind, RawReading, TeamMeasureSource } from '@/services/team-report';
import { readSourceRaw } from '@/services/team-report';
import { lastPeriods } from './periods';

export type MetricPoint = { period: Period; value: number | null };

export type PeriodMetric = {
  metric: PageMetric;
  provenance: ProvenanceKind;
  sourceLabel: string;
  freshness: Freshness | null;
  points: MetricPoint[];
  /** Set when no period could be read: the figure is drawn as this state. */
  unavailable: { kind: MeasureUnavailableKind; reason: string } | null;
};

export type MetricSummary = {
  /** The current period, to date. */
  current: number | null;
  previous: number | null;
  /** Mean of the full periods before the previous one, for "against usual". */
  usual: number | null;
  /** Every period shown, summed. */
  total: number | null;
};

/** Reads in flight at once, so a page of figures does not take every pooled connection. */
const CONCURRENCY = 6;

async function inBatches<T>(jobs: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = Array.from({ length: jobs.length });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
    }
  }));
  return out;
}

/**
 * Fold one figure's readings. Pure.
 * @param metric - The declared figure.
 * @param periods - Oldest first.
 * @param raws - One reading per period, aligned with `periods`.
 */
export function foldPeriods(metric: PageMetric, periods: Period[], raws: RawReading[]): PeriodMetric {
  const first = raws.find(r => r.value !== null) ?? raws[raws.length - 1];
  const failed = raws.every(r => r.value === null) ? raws[raws.length - 1] : undefined;
  return {
    metric,
    provenance: metric.source.kind,
    sourceLabel: first?.sourceLabel ?? 'Vocion',
    // The newest period that counted something: an empty one's freshness
    // falls back to every source, the stalest of which never contributed.
    freshness: ([...raws].reverse().find(r => (r.value ?? 0) > 0) ?? raws[raws.length - 1])?.freshness ?? null,
    points: periods.map((period, i) => ({ period, value: raws[i]?.value ?? null })),
    unavailable: failed?.unavailableKind
      ? { kind: failed.unavailableKind, reason: failed.unavailableReason ?? 'This figure could not be read.' }
      : null,
  };
}

/**
 * The headline numbers for one figure. Pure. Null wherever the periods it
 * needs were not read, never a zero standing in for one.
 * @param points - Oldest first, the current period last.
 */
export function summarize(points: MetricPoint[]): MetricSummary {
  const values = points.map(p => p.value);
  const current = values.at(-1) ?? null;
  const previous = values.length > 1 ? values.at(-2) ?? null : null;
  const before = values.slice(0, -2);
  const usual = before.length > 0 && before.every(v => v !== null)
    ? (before as number[]).reduce((a, b) => a + b, 0) / before.length
    : null;
  const total = values.every(v => v !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;
  return { current, previous, usual, total };
}

/**
 * Read every figure for each of the page's last weeks or months.
 * @param orgId - The workspace.
 * @param metrics - The page's declared figures.
 * @param unit - Weeks or months.
 * @param timezone - The workspace's zone, which the periods are judged in.
 * @param now - The server clock.
 */
export async function readPeriodMetrics(orgId: string, metrics: PageMetrics, unit: PeriodUnit, timezone: string, now: Date = new Date()): Promise<{ periods: Period[]; figures: PeriodMetric[] }> {
  const periods = lastPeriods(unit, unit === 'month' ? metrics.months : metrics.weeks, now, timezone);
  const scope: MeasureScope = { teamSlug: '', agentSlugs: [], anyone: true };
  const jobs = metrics.items.flatMap(item => periods.map(period => () => readSourceRaw(orgId, item.source as TeamMeasureSource, scope, period, now)));
  const raws = await inBatches(jobs);
  const figures = metrics.items.map((item, i) => foldPeriods(item, periods, raws.slice(i * periods.length, (i + 1) * periods.length)));
  return { periods, figures };
}
