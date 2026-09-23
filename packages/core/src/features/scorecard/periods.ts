/**
 * The periods the scorecard can be read over, and how each becomes a range.
 *
 * Every range is whole local days: `from` is midnight at the start of the
 * first day, `to` is midnight after the last day (exclusive). "Last 7 days"
 * means today and the six days before it, so the numbers include what
 * happened this morning. Days are the viewer's own, because "last month" to a
 * client means their month, not UTC's.
 */

export type ScorecardPreset = 'last7' | 'last14' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'yearToDate';

export const SCORECARD_PRESETS: ReadonlyArray<{ id: ScorecardPreset; label: string }> = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last14', label: 'Last 14 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'yearToDate', label: 'Year to date' },
];

export const DEFAULT_SCORECARD_PRESET: ScorecardPreset = 'last30';

export type DateRange = { from: Date; to: Date };

/**
 * Midnight at the start of `date`'s local day, shifted by `days`.
 * @param date - Any moment in the day.
 * @param days - Whole days to add; negative goes back.
 */
function startOfDay(date: Date, days = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The range a preset covers, as of `now`.
 * @param preset - Which period.
 * @param now - The current moment; injectable for tests.
 */
export function rangeForPreset(preset: ScorecardPreset, now: Date = new Date()): DateRange {
  const endOfToday = startOfDay(now, 1);
  switch (preset) {
    case 'last7':
      return { from: startOfDay(now, -6), to: endOfToday };
    case 'last14':
      return { from: startOfDay(now, -13), to: endOfToday };
    case 'last30':
      return { from: startOfDay(now, -29), to: endOfToday };
    case 'last90':
      return { from: startOfDay(now, -89), to: endOfToday };
    case 'thisMonth':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfToday };
    case 'lastMonth':
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
    case 'yearToDate':
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfToday };
  }
}

/**
 * A `YYYY-MM-DD` value from a date input, as local midnight — or null when it is not a real date.
 * @param value - What the date input holds.
 */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  // Rejects 2026-02-31, which Date would silently roll into March.
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

/**
 * A date as the `YYYY-MM-DD` a date input expects, in local time.
 * @param date - The day to show.
 */
export function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export type CustomRangeResult = { ok: true; range: DateRange } | { ok: false; message: string };

/**
 * A custom range from two date inputs, both days included.
 * @param fromValue - First day, `YYYY-MM-DD`.
 * @param toValue - Last day, `YYYY-MM-DD` — included, so the range ends at the midnight after it.
 * @param maxDays - The longest range the server accepts.
 */
export function customRange(fromValue: string, toValue: string, maxDays: number): CustomRangeResult {
  const from = parseDateInput(fromValue);
  const lastDay = parseDateInput(toValue);
  if (!from || !lastDay) {
    return { ok: false, message: 'Pick both a start and an end date.' };
  }
  if (lastDay.getTime() < from.getTime()) {
    return { ok: false, message: 'The end date must be on or after the start date.' };
  }
  const to = startOfDay(lastDay, 1);
  // Round rather than divide exactly: a daylight-saving day is 23 or 25 hours long.
  if (Math.round((to.getTime() - from.getTime()) / 86_400_000) > maxDays) {
    return { ok: false, message: `Pick a period of at most ${maxDays} days.` };
  }
  return { ok: true, range: { from, to } };
}

/**
 * The range as a person reads it: "Sep 1 – Sep 23, 2026", both days included.
 * @param range - The range, `to` exclusive.
 */
export function describeRange(range: DateRange): string {
  const lastDay = startOfDay(range.to, -1);
  const sameYear = range.from.getFullYear() === lastDay.getFullYear();
  const start = range.from.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const end = lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return start === end.replace(/, \d{4}$/, '') && sameYear ? end : `${start} – ${end}`;
}
