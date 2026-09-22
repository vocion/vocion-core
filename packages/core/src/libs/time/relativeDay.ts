/**
 * Calendar days named the way a person writes them in YAML — `today`,
 * `yesterday`, `last month`, `3 days ago` — resolved against a clock at the
 * moment a check runs.
 *
 * Built for eval checks like "no proposed event starts before today", which
 * have to mean today on the day the run happens, not the day the file was
 * written. Everything is a calendar day (`YYYY-MM-DD`), never an instant,
 * because the rules being written are about days: an event tonight at 7pm is
 * not in the past at 8am.
 *
 * A closed vocabulary rather than a date library's parser, so a typo fails
 * when the workspace is applied instead of quietly resolving to something
 * nobody meant.
 */

import { dayKey, DEFAULT_TIME_ZONE, isValidTimeZone } from './zone';

/** The zone words a manifest may use besides an IANA name like `America/New_York`. */
const UTC_WORD = 'utc';
const LOCAL_WORD = 'local';

const UNIT_PATTERN = '(day|week|month|year)s?';
const AGO = new RegExp(`^(\\d+) ${UNIT_PATTERN} ago$`);
const AHEAD = new RegExp(`^in (\\d+) ${UNIT_PATTERN}$`);
const ABSOLUTE_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Unit = 'day' | 'week' | 'month' | 'year';

/**
 * The furthest a counted phrase may reach, about a century either way.
 *
 * A bound far past that is a typo, and an unbounded one breaks the arithmetic:
 * `99999999 years ago` is a year Date cannot hold, so `toISOString` throws in
 * the middle of scoring instead of the manifest being refused at apply.
 */
const MAX_AMOUNT: Record<Unit, number> = { day: 36_600, week: 5_220, month: 1_200, year: 100 };

/** A relative day, reduced to "move this many units from today". */
type DayOffset = { amount: number; unit: Unit };

const NAMED_OFFSETS: Record<string, DayOffset> = {
  'today': { amount: 0, unit: 'day' },
  'yesterday': { amount: -1, unit: 'day' },
  'tomorrow': { amount: 1, unit: 'day' },
  'last week': { amount: -1, unit: 'week' },
  'next week': { amount: 1, unit: 'week' },
  'last month': { amount: -1, unit: 'month' },
  'next month': { amount: 1, unit: 'month' },
  'last year': { amount: -1, unit: 'year' },
  'next year': { amount: 1, unit: 'year' },
};

/**
 * Turn a relative phrase into an offset from today, or null when it is not
 * one this module knows.
 * @param phrase - Already trimmed and lower-cased.
 */
function parseOffset(phrase: string): DayOffset | null {
  const named = NAMED_OFFSETS[phrase];
  if (named) {
    return named;
  }
  const ago = AGO.exec(phrase);
  if (ago) {
    return boundedOffset(-1, ago[1]!, ago[2] as Unit);
  }
  const ahead = AHEAD.exec(phrase);
  if (ahead) {
    return boundedOffset(1, ahead[1]!, ahead[2] as Unit);
  }
  return null;
}

/**
 * A counted offset, or null when the count reaches past `MAX_AMOUNT`.
 * @param direction - -1 for "ago", 1 for "in".
 * @param digits - The count as written.
 * @param unit - What is being counted.
 */
function boundedOffset(direction: -1 | 1, digits: string, unit: Unit): DayOffset | null {
  const amount = Number.parseInt(digits, 10);
  return amount <= MAX_AMOUNT[unit] ? { amount: direction * amount, unit } : null;
}

/**
 * Whether `YYYY-MM-DD` names a day that exists.
 *
 * `2026-02-30` has the right shape and is not a day: Date rolls it into
 * March, and refuses `2026-13-01` outright, so a round trip that comes back
 * as the same day is what tells a real one apart.
 * @param day - Text already known to have the `YYYY-MM-DD` shape.
 */
function isRealDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day);
}

/**
 * Whether a manifest's day phrase is one this module can resolve.
 * @param phrase - `today`, `2 weeks ago`, `2026-09-01`, and so on.
 */
export function isRelativeDay(phrase: string): boolean {
  const normalized = phrase.trim().toLowerCase();
  if (ABSOLUTE_DAY.test(normalized)) {
    return isRealDay(normalized);
  }
  return parseOffset(normalized) !== null;
}

/**
 * Whether a manifest's zone is usable: `utc`, `local`, or an IANA name.
 * @param zone - What the manifest wrote.
 */
export function isDayZone(zone: string): boolean {
  const normalized = zone.trim().toLowerCase();
  return normalized === UTC_WORD || normalized === LOCAL_WORD || isValidTimeZone(zone);
}

/**
 * The IANA zone a manifest's zone word stands for.
 *
 * `local` is the zone of the machine running the check. The app servers run
 * in UTC, so on them `local` and `utc` agree; a workspace that cares which
 * day it is at the venue should name the zone outright.
 * @param zone - `utc`, `local`, or an IANA name; omitted means UTC.
 */
export function resolveDayZone(zone: string | undefined): string {
  if (!zone) {
    return DEFAULT_TIME_ZONE;
  }
  const normalized = zone.trim().toLowerCase();
  if (normalized === UTC_WORD) {
    return DEFAULT_TIME_ZONE;
  }
  if (normalized === LOCAL_WORD) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return zone;
}

/**
 * Move a calendar day by an offset.
 *
 * Months and years clamp to the last day that exists, so one month before
 * March 31st is the last day of February rather than an early March day,
 * which is what a person means by "last month".
 * @param day - `YYYY-MM-DD`.
 * @param offset - How far to move.
 */
function shiftDay(day: string, offset: DayOffset): string {
  const [year, month, date] = day.split('-').map(part => Number.parseInt(part, 10)) as [number, number, number];
  if (offset.unit === 'day' || offset.unit === 'week') {
    const days = offset.unit === 'week' ? offset.amount * 7 : offset.amount;
    return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
  }
  const monthsToMove = offset.unit === 'year' ? offset.amount * 12 : offset.amount;
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + monthsToMove, 1));
  const lastDayOfTarget = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(date, lastDayOfTarget));
  return firstOfTarget.toISOString().slice(0, 10);
}

/**
 * The calendar day a phrase names, as `YYYY-MM-DD`, in a zone, at `now`.
 * @param phrase - `today`, `last month`, `3 days ago`, `in 2 weeks`, or a `YYYY-MM-DD` day.
 * @param timeZone - An IANA zone, already resolved.
 * @param now - The clock the check runs against.
 * @throws {Error} When the phrase is not one `isRelativeDay` accepts; the manifest
 * schema refuses those at apply time, so reaching this is a bug.
 */
export function resolveRelativeDay(phrase: string, timeZone: string, now: Date): string {
  const normalized = phrase.trim().toLowerCase();
  if (ABSOLUTE_DAY.test(normalized)) {
    if (!isRealDay(normalized)) {
      throw new Error(`Not a day on any calendar: "${phrase}"`);
    }
    return normalized;
  }
  const offset = parseOffset(normalized);
  if (!offset) {
    throw new Error(`Not a day this check understands: "${phrase}"`);
  }
  return shiftDay(dayKey(now, timeZone), offset);
}

/**
 * The calendar day a tool argument holds, or null when it holds no date.
 *
 * A bare day (`2026-09-12`) or a wall-clock time with no offset
 * (`2026-09-12T19:30`) already names its day, so it is read as written —
 * converting it would shift an evening event onto the next day in any zone
 * east of it. Only a value carrying an offset or `Z` is an instant, and that
 * one is placed on its day in the check's zone.
 * @param value - Whatever the agent passed.
 * @param timeZone - An IANA zone, already resolved.
 */
export function calendarDayOf(value: unknown, timeZone: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  const wallClock = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(text);
  if (wallClock) {
    const day = wallClock[1]!;
    return isRealDay(day) ? day : null;
  }
  const instant = new Date(text);
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text) && !Number.isNaN(instant.getTime())) {
    return dayKey(instant, timeZone);
  }
  return null;
}
