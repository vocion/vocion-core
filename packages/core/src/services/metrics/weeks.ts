/**
 * The weeks a Metrics page reads: Monday to Sunday in the workspace's zone,
 * oldest first, the current week last and cut at `now`. Pure, so the
 * boundaries are tested without a clock or a database.
 */

import type { Range } from '@/services/team-report';
import { dayBounds, localDay } from '@/libs/hubspot/senderInboxes';

export type Week = Range & {
  /** The Monday it starts on, YYYY-MM-DD in the zone. */
  start: string;
  /** "Oct 13", the axis label. */
  label: string;
  /** True for the week `now` is in: counted to date. */
  partial: boolean;
};

const DAY_MS = 86_400_000;
const LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The last `count` weeks.
 * @param count - How many, the current week included.
 * @param now - The server clock.
 * @param timezone - IANA zone the weeks are judged in.
 */
export function lastWeeks(count: number, now: Date, timezone: string): Week[] {
  const today = localDay(now, timezone);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const weeks: Week[] = [];
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
