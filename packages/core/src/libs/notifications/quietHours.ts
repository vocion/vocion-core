import type { QuietHours } from './types';
import { dayKey, dayPlus, instantInZone, isValidTimeZone } from '@/libs/time/zone';

/**
 * Quiet hours, as pure clock arithmetic on the person's own zone.
 * `quietUntil(now, hours)` answers the one question the delivery pass asks:
 * may a push, a mail or a Slack message go now, or when may it?
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && HHMM.test(v);
}

function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm)!;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Minutes since local midnight in `tz`.
 * @param now
 * @param tz
 */
function localMinutes(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * Whether quiet hours are well-formed. A malformed setting means no quiet hours, never a wall.
 * @param q
 */
export function validQuietHours(q: QuietHours | null | undefined): q is QuietHours {
  return !!q && isClockTime(q.start) && isClockTime(q.end) && q.start !== q.end && isValidTimeZone(q.timeZone);
}

/**
 * When the quiet hours `now` sits in end, or null when `now` is not in them.
 * @param now - The clock.
 * @param q - The person's quiet hours.
 */
export function quietUntil(now: Date, q: QuietHours | null | undefined): Date | null {
  if (!validQuietHours(q)) {
    return null;
  }
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  const m = localMinutes(now, q.timeZone);
  const inside = start < end ? m >= start && m < end : m >= start || m < end;
  if (!inside) {
    return null;
  }
  const today = dayKey(now, q.timeZone);
  // Before the end on this local day, it ends today; past the start of an
  // overnight window, it ends tomorrow.
  const day = m < end ? today : dayPlus(today, 1);
  const at = instantInZone(`${day}T${q.end}:00`, q.timeZone);
  return Number.isNaN(at.getTime()) ? null : at;
}
