/**
 * The period a dataset page is showing, read from and written to its URL.
 *
 * The presets are the scorecard's, so "Last 30 days" means the same thing on
 * both pages, plus "All time" first: a dataset that ran twice two months ago
 * should still show those runs when someone opens it, not an empty chart.
 *
 * The URL carries the preset's id and the range it resolved to, as ISO
 * instants: `?period=last7&from=…&to=…`. The range is resolved in the browser,
 * because "last 7 days" means the viewer's days and the server cannot know
 * their timezone. A link opened the next day still names `last7`, so the
 * picker re-resolves it and replaces the URL (see {@link isStalePreset}); a
 * custom range is fixed and never moves.
 *
 * Kept free of React so the rules can be tested without rendering the page.
 */
import type { DateRange, ScorecardPreset } from '@/features/scorecard/periods';
import type { RunRange } from '@/libs/evals/runRange';
import { rangeForPreset, SCORECARD_PRESETS } from '@/features/scorecard/periods';
import { parseRunRange } from '@/libs/evals/runRange';

export type EvalPeriodId = 'all' | 'custom' | ScorecardPreset;

export const EVAL_PERIOD_PRESETS: ReadonlyArray<{ id: 'all' | ScorecardPreset; label: string }> = [
  { id: 'all', label: 'All time' },
  ...SCORECARD_PRESETS,
];

export type EvalPeriodSelection = {
  period: EvalPeriodId;
  /** The runs to show. Empty means all time. */
  range: RunRange;
  /** Why the URL's range was ignored, to say on the page; null when it was fine. */
  problem: string | null;
};

const PRESET_IDS = new Set<string>(SCORECARD_PRESETS.map(preset => preset.id));

/**
 * Whether a URL value names one of the scorecard presets.
 * @param value - The `period` query value.
 */
function isPreset(value: string | undefined): value is ScorecardPreset {
  return value !== undefined && PRESET_IDS.has(value);
}

/**
 * Read the period from the page's query string.
 *
 * A range that does not parse is dropped and the page shows all time with a
 * note saying why — never a filtered-looking page over the wrong runs. A
 * preset with no range yet (a hand-typed `?period=last7`) is resolved here in
 * the server's timezone so the first paint is close, and the picker corrects
 * it to the viewer's days straight after.
 * @param params - The raw query values.
 * @param params.period - Preset id, `custom` or `all`.
 * @param params.from - Start, ISO, inclusive.
 * @param params.to - End, ISO, exclusive.
 * @param now - The current moment; injectable for tests.
 */
export function readEvalPeriod(params: { period?: string; from?: string; to?: string }, now: Date = new Date()): EvalPeriodSelection {
  if (params.period === 'all' || (params.period === undefined && !params.from && !params.to)) {
    return { period: 'all', range: {}, problem: null };
  }
  const parsed = parseRunRange({ from: params.from, to: params.to });
  if (!parsed.ok) {
    return { period: 'all', range: {}, problem: `The period in this link could not be read, so every run is shown. ${parsed.message}` };
  }
  if (isPreset(params.period)) {
    const hasRange = parsed.range.from !== undefined || parsed.range.to !== undefined;
    return { period: params.period, range: hasRange ? parsed.range : rangeForPreset(params.period, now), problem: null };
  }
  return { period: 'custom', range: parsed.range, problem: null };
}

/**
 * The dataset page's URL for a new period. Drops `page`, because page 3 of
 * one period is not page 3 of another, and keeps any other query value.
 * @param pathname - The page's app path.
 * @param current - The query string now.
 * @param period - The period to switch to.
 * @param range - Its range; ignored for `all`.
 */
export function periodHref(pathname: string, current: URLSearchParams, period: EvalPeriodId, range: DateRange | null): string {
  const next = new URLSearchParams(current);
  next.delete('page');
  next.delete('period');
  next.delete('from');
  next.delete('to');
  if (period !== 'all' && range) {
    next.set('period', period);
    next.set('from', range.from.toISOString());
    next.set('to', range.to.toISOString());
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The query string that keeps the current period on another link, like the
 * run list's pager. Empty for all time.
 * @param selection - The period on screen.
 */
export function periodQuery(selection: EvalPeriodSelection): URLSearchParams {
  const query = new URLSearchParams();
  if (selection.period === 'all') {
    return query;
  }
  query.set('period', selection.period);
  if (selection.range.from) {
    query.set('from', selection.range.from.toISOString());
  }
  if (selection.range.to) {
    query.set('to', selection.range.to.toISOString());
  }
  return query;
}

/**
 * Whether a preset in the URL has drifted from what it means today in the
 * viewer's timezone — a "Last 7 days" link opened a day later, or one the
 * server resolved in UTC. The picker replaces the URL when it has.
 * @param period - The period in the URL.
 * @param from - The URL's `from`, ISO.
 * @param to - The URL's `to`, ISO.
 * @param now - The current moment; injectable for tests.
 */
export function isStalePreset(period: EvalPeriodId, from: string | null, to: string | null, now: Date = new Date()): boolean {
  if (!isPreset(period)) {
    return false;
  }
  const expected = rangeForPreset(period, now);
  return from !== expected.from.toISOString() || to !== expected.to.toISOString();
}

/**
 * The range a picker should start its custom form from: what is on screen, or
 * the last 30 days when that is all time and has no ends to show.
 * @param from - The URL's `from`, ISO, or null.
 * @param to - The URL's `to`, ISO, or null.
 * @param now - The current moment; injectable for tests.
 */
export function initialCustomRange(from: string | null, to: string | null, now: Date = new Date()): DateRange {
  if (from && to) {
    return { from: new Date(from), to: new Date(to) };
  }
  return rangeForPreset('last30', now);
}

/**
 * A run-list URL that drops a page number of 1 and keeps the period.
 * @param slug - Which dataset.
 * @param page - The page to link to.
 * @param periodQueryString - The period's query string; empty for all time.
 */
export function runsPageHref(slug: string, page: number, periodQueryString = ''): string {
  const query = new URLSearchParams(periodQueryString);
  if (page > 1) {
    query.set('page', String(page));
  }
  const search = query.toString();
  return search ? `/dashboard/evals/${slug}?${search}` : `/dashboard/evals/${slug}`;
}
