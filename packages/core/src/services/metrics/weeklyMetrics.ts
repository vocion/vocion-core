/**
 * A Metrics page's figures, week by week: each figure's source read once per
 * week through the team report's own reader, so a figure carries the same
 * provenance, freshness and "not a zero" states a team measure does.
 */

import type { Week } from './weeks';
import type { PageMetric, PageMetrics } from '@/libs/workspace/pageFields';
import type { Freshness, MeasureScope, MeasureUnavailableKind, ProvenanceKind, RawReading, TeamMeasureSource } from '@/services/team-report';
import { readSourceRaw } from '@/services/team-report';
import { lastWeeks } from './weeks';

export type MetricPoint = { week: Week; value: number | null };

export type WeeklyMetric = {
  metric: PageMetric;
  provenance: ProvenanceKind;
  sourceLabel: string;
  freshness: Freshness | null;
  points: MetricPoint[];
  /** Set when no week could be read: the figure is drawn as this state. */
  unavailable: { kind: MeasureUnavailableKind; reason: string } | null;
};

export type MetricSummary = {
  /** This week, to date. */
  thisWeek: number | null;
  lastWeek: number | null;
  /** Mean of the full weeks before last week, for "against usual". */
  usual: number | null;
  /** Every week shown, summed. */
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
 * Fold one figure's weekly readings. Pure.
 * @param metric
 * @param weeks
 * @param raws - One reading per week, aligned with `weeks`.
 */
export function foldWeekly(metric: PageMetric, weeks: Week[], raws: RawReading[]): WeeklyMetric {
  const first = raws.find(r => r.value !== null) ?? raws[raws.length - 1];
  const failed = raws.every(r => r.value === null) ? raws[raws.length - 1] : undefined;
  return {
    metric,
    provenance: metric.source.kind,
    sourceLabel: first?.sourceLabel ?? 'Vocion',
    // The newest week that counted something: an empty week's freshness
    // falls back to every source, the stalest of which never contributed.
    freshness: ([...raws].reverse().find(r => (r.value ?? 0) > 0) ?? raws[raws.length - 1])?.freshness ?? null,
    points: weeks.map((week, i) => ({ week, value: raws[i]?.value ?? null })),
    unavailable: failed?.unavailableKind
      ? { kind: failed.unavailableKind, reason: failed.unavailableReason ?? 'This figure could not be read.' }
      : null,
  };
}

/**
 * The headline numbers for one figure. Pure. Null wherever the weeks it
 * needs were not read, never a zero standing in for one.
 * @param points - Oldest first, the current week last.
 */
export function summarize(points: MetricPoint[]): MetricSummary {
  const values = points.map(p => p.value);
  const thisWeek = values.at(-1) ?? null;
  const lastWeek = values.length > 1 ? values.at(-2) ?? null : null;
  const before = values.slice(0, -2);
  const usual = before.length > 0 && before.every(v => v !== null)
    ? (before as number[]).reduce((a, b) => a + b, 0) / before.length
    : null;
  const total = values.every(v => v !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;
  return { thisWeek, lastWeek, usual, total };
}

/**
 * Read every figure for every week.
 * @param orgId - The workspace.
 * @param metrics - The page's declared figures.
 * @param scope - Whose agents' actions and runs count.
 * @param timezone - The workspace's zone, which the weeks are judged in.
 * @param now - The server clock.
 */
export async function readWeeklyMetrics(orgId: string, metrics: PageMetrics, scope: MeasureScope, timezone: string, now: Date = new Date()): Promise<{ weeks: Week[]; figures: WeeklyMetric[] }> {
  const weeks = lastWeeks(metrics.weeks, now, timezone);
  const jobs = metrics.items.flatMap(item => weeks.map(week => () => readSourceRaw(orgId, item.source as TeamMeasureSource, scope, week, now)));
  const raws = await inBatches(jobs);
  const figures = metrics.items.map((item, i) => foldWeekly(item, weeks, raws.slice(i * weeks.length, (i + 1) * weeks.length)));
  return { weeks, figures };
}
