/**
 * When a person's morning brief and evening wrap are due — pure clock
 * arithmetic, in the person's own zone (docs/guides/morning-brief.md).
 *
 * Times are wall-clock `HH:MM` in an IANA zone, so 07:30 stays 07:30 across a
 * daylight-saving change. A delivery the server slept through by more than
 * {@link STALE_AFTER_MS} is skipped rather than sent late: a morning brief at
 * two in the afternoon is not a morning brief.
 */

import { dayKey, dayPlus, instantInZone, isValidTimeZone } from '@/libs/time/zone';

export const RHYTHM_KINDS = ['brief', 'wrap'] as const;
export type RhythmKind = typeof RHYTHM_KINDS[number];

/** The defaults: about 07:30 and about 17:30. */
export const DEFAULT_RHYTHM_TIMES: Record<RhythmKind, string> = { brief: '07:30', wrap: '17:30' };

/** How late a delivery may still go out. Later than this, it is skipped to the next day. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Whether a string is a wall-clock time, `HH:MM` on a 24-hour clock.
 * @param value - The candidate.
 */
export function isWallClock(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

/**
 * The next instant after `after` at which the zone's clock reads `time`.
 * @param time - `HH:MM`.
 * @param tz - The zone.
 * @param after - Strictly after this.
 */
export function nextOccurrence(time: string, tz: string, after: Date): Date {
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  const today = dayKey(after, zone);
  for (const offset of [0, 1, 2]) {
    const at = instantInZone(`${dayPlus(today, offset)}T${time}:00`, zone);
    if (!Number.isNaN(at.getTime()) && at.getTime() > after.getTime()) {
      return at;
    }
  }
  // Unreachable for a valid time: two days ahead always lands after `after`.
  return new Date(after.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * What the sweep does with a due delivery: send it, or skip it as too late.
 * @param due - When it was due.
 * @param now - The clock.
 */
export function dueAction(due: Date, now: Date): 'deliver' | 'skip' | 'wait' {
  if (due.getTime() > now.getTime()) {
    return 'wait';
  }
  return now.getTime() - due.getTime() > STALE_AFTER_MS ? 'skip' : 'deliver';
}

/**
 * The day a delivery belongs to, in the person's zone: the once-only key.
 * @param due - When it was due.
 * @param tz - The zone.
 */
export function rhythmDay(due: Date, tz: string): string {
  return dayKey(due, isValidTimeZone(tz) ? tz : 'UTC');
}
