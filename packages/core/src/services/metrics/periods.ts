/**
 * The periods a Metrics page reads: weeks Monday to Sunday, or calendar
 * months, in the workspace's zone, oldest first, the current one last and cut
 * at `now`. Pure, so the boundaries are tested without a clock or a database.
 */

import type { Range } from '@/services/team-report';
import { dayBounds, localDay } from '@/libs/hubspot/senderInboxes';

export type Period = Range & {
  /** The day it starts on, YYYY-MM-DD in the zone: a Monday, or the 1st. */
  start: string;
  /** "Oct 13" for a week, "Oct 2026" for a month: the axis label. */
  label: string;
  /** True for the period `now` is in: counted to date. */
  partial: boolean;
};
export type PeriodUnit = 'week' | 'month';

const DAY_MS = 86_400_000;
const LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The last `count` weeks.
 * @param count - How many, the current week included.
 * @param now - The server clock.
 * @param timezone - IANA zone the weeks are judged in.
 */
export function lastWeeks(count: number, now: Date, timezone: string): Period[] {
  const today = localDay(now, timezone);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const weeks: Period[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = addDays(monday, -7 * i);
    const since = dayBounds(start, timezone).start;
    const end = dayBounds(addDays(start, 7), timezone).start;
    weeks.push({
      start,
      label: LABEL.format(new Date(`${start}T00:00:00Z`)),
      since,
      until: i === 0 ? now : end,
      partial: i === 0,
    });
  }
  return weeks;
}

function addMonths(day: string, n: number): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * The last `count` calendar months.
 * @param count - How many, the current month included.
 * @param now - The server clock.
 * @param timezone - IANA zone the months are judged in.
 */
export function lastMonths(count: number, now: Date, timezone: string): Period[] {
  const first = `${localDay(now, timezone).slice(0, 7)}-01`;
  const months: Period[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = addMonths(first, -i);
    months.push({
      start,
      label: MONTH_LABEL.format(new Date(`${start}T00:00:00Z`)),
      since: dayBounds(start, timezone).start,
      until: i === 0 ? now : dayBounds(addMonths(start, 1), timezone).start,
      partial: i === 0,
    });
  }
  return months;
}

/**
 * The last `count` periods of either unit.
 * @param unit
 * @param count
 * @param now
 * @param timezone
 */
export function lastPeriods(unit: PeriodUnit, count: number, now: Date, timezone: string): Period[] {
  return unit === 'month' ? lastMonths(count, now, timezone) : lastWeeks(count, now, timezone);
}
