/**
 * A deterministic subset of RFC 5545 recurrence: the rules calendars commonly
 * write (daily, weekly, or monthly on a weekday by its place in the month,
 * the first Tuesday or the last Friday; an interval, a count or an end),
 * expanded on the rule's own clock so a wall-clock time survives a clock
 * change and a UTC-anchored rule keeps its UTC weekday. Anything else returns
 * nothing and stays the model's job. One stated deviation: a DTSTART that
 * does not match BYDAY is not added as an extra first occurrence.
 */

import { dayPlus, daysBetween, instantInZone, isoInZone } from './zone';

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
/** The frequencies read; a MONTHLY rule only with every BYDAY day placed in the month (`1TU`, `-1FR`). */
export const READ_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
// Any other part (BYMONTH, BYHOUR, BYSETPOS, ...) changes the dates, so a rule that has one is not read.
export const READ_PARTS = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'] as const;
const PLACED_DAY = new RegExp(`^([+-]?[1-5])(${WEEKDAYS.join('|')})$`);
const SAFETY_CAP = 1_000;
const DAY_MS = 86_400_000;

/**
 * The weekday a calendar day falls on, 0 for Monday.
 * @param day - `YYYY-MM-DD`.
 */
function weekday(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function parts(rule: string): Map<string, string> {
  return new Map(rule.split(';').filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim().toUpperCase(), p.slice(i + 1).trim().toUpperCase()];
  }));
}

/**
 * The `UNTIL` value as an instant: a UTC date-time, or a date read as the end
 * of that day on the anchor's clock. Undefined for any other form, or for a
 * date or time that does not exist.
 * @param value - `YYYYMMDDTHHMMSSZ` or `YYYYMMDD`.
 * @param anchorZone - the rule's own zone.
 */
export function until(value: string, anchorZone: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
  if (!m) {
    return undefined;
  }
  const at = m[4] === undefined
    ? instantInZone(`${m[1]}-${m[2]}-${m[3]}T23:59:59`, anchorZone)
    : instantInZone(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, 'UTC');
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** A rule `expandRecurrence` reads, as it reads it. */
type ReadRule = { freq: typeof READ_FREQUENCIES[number]; interval: number; count?: number; until?: string; byDay: string[]; wkst: number };

/**
 * A rule in the subset this file expands, or undefined for any other.
 * @param rule - the `RRULE` value.
 */
export function readRule(rule: string): ReadRule | undefined {
  const r = parts(rule);
  const freq = READ_FREQUENCIES.find(f => f === r.get('FREQ'));
  if (!freq || [...r.keys()].some(k => !(READ_PARTS as readonly string[]).includes(k)) || ['INTERVAL', 'COUNT'].some(k => r.has(k) && !/^\d+$/.test(r.get(k)!))) {
    return undefined;
  }
  const interval = Number(r.get('INTERVAL') ?? '1');
  const count = r.has('COUNT') ? Number(r.get('COUNT')) : undefined;
  const byDay = (r.get('BYDAY') ?? '').split(',').filter(Boolean);
  const known = WEEKDAYS as readonly string[];
  const daysRead = freq === 'MONTHLY' ? byDay.length > 0 && byDay.every(d => PLACED_DAY.test(d)) : byDay.every(d => known.includes(d));
  // Whether an UNTIL reads does not depend on the zone, so UTC stands in for the anchor's.
  if (interval < 1 || interval > SAFETY_CAP || (count !== undefined && !(count > 0 && count <= SAFETY_CAP)) || (r.has('UNTIL') && !until(r.get('UNTIL')!, 'UTC')) || (freq === 'DAILY' && byDay.length > 0) || !daysRead || !known.includes(r.get('WKST') ?? 'MO')) {
    return undefined;
  }
  return { freq, interval, count, until: r.get('UNTIL'), byDay, wkst: known.indexOf(r.get('WKST') ?? 'MO') };
}

/**
 * The day a placed weekday falls on in a month, `-1FR` the last Friday, or
 * undefined when the month has no such day (`5TU` in a month of four).
 * @param month - the month's first day, `YYYY-MM-01`.
 * @param placed - a BYDAY value with its place, `1TU` or `-1FR`.
 */
function placedDay(month: string, placed: string): string | undefined {
  const [, at = '', name = ''] = PLACED_DAY.exec(placed) ?? [];
  const place = Number(at);
  const target = (WEEKDAYS as readonly string[]).indexOf(name);
  const length = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const on = (date: number) => `${month.slice(0, 8)}${String(date).padStart(2, '0')}`;
  const date = place > 0
    ? 1 + (target - weekday(on(1)) + 7) % 7 + (place - 1) * 7
    : length - (weekday(on(length)) - target + 7) % 7 + (place + 1) * 7;
  return date >= 1 && date <= length ? on(date) : undefined;
}

/**
 * Whether a rule, read loosely, names nothing on or after a day: an `UNTIL` by
 * its first eight digits, or a `COUNT` run out at its longest, 31 days a
 * period (a year for YEARLY) from the start. For a rule `expandRecurrence`
 * does not read, so anything it cannot tell reads as still running.
 * @param rule - the `RRULE` value.
 * @param day - `YYYY-MM-DD`.
 * @param start - the `DTSTART` value as written, read by its first eight digits too.
 */
export function ruleEndedBefore(rule: string, day: string, start = ''): boolean {
  const r = parts(rule);
  const eightDigits = (value: string) => /^(\d{4})(\d{2})(\d{2})/.exec(value)?.slice(1).join('-');
  const end = eightDigits(r.get('UNTIL') ?? '');
  if (end) {
    return end < day;
  }
  const from = eightDigits(start);
  const count = Number(r.get('COUNT'));
  const interval = Number(r.get('INTERVAL') ?? '1');
  if (!from || !(count > 0) || !(interval > 0)) {
    return false;
  }
  const span = count * interval * (r.get('FREQ') === 'YEARLY' ? 366 : 31);
  return Date.parse(`${from}T00:00:00Z`) + span * DAY_MS < Date.parse(`${day}T00:00:00Z`);
}

/**
 * The instants a repeating entry falls on inside a window.
 * @param input - the rule and its anchor.
 * @param input.start - the first occurrence (`DTSTART`).
 * @param input.anchorZone - the zone the rule's clock runs in: the `TZID`, or `UTC` for a `Z` time.
 * @param input.rule - the `RRULE` value.
 * @param input.exdates - instants the rule skips.
 * @param input.rdates - instants added beside the rule.
 * @param input.from - the window start, inclusive.
 * @param input.to - the window end, inclusive.
 */
export function expandRecurrence(input: { start: Date; anchorZone: string; rule: string; exdates: Date[]; rdates: Date[]; from: Date; to: Date }): Date[] {
  const read = readRule(input.rule);
  if (!read) {
    return [];
  }
  const { freq, interval, count, byDay, wkst } = read;
  const end = read.until === undefined ? undefined : until(read.until, input.anchorZone);
  if (read.until !== undefined && !end) {
    return [];
  }
  const known = WEEKDAYS as readonly string[];
  const local = isoInZone(input.start, input.anchorZone);
  const startDay = local.slice(0, 10);
  const clock = local.slice(11, 19);
  const at = (day: string) => instantInZone(`${day}T${clock}`, input.anchorZone);
  // A start outside four-digit years does not read back on its own clock, and nothing after it can be walked.
  if (Number.isNaN(at(startDay).getTime())) {
    return [];
  }
  const fromStart = (wd: number) => (wd - wkst + 7) % 7;
  const step = freq === 'DAILY' ? interval : 7 * interval;
  const wanted = freq === 'WEEKLY' ? (byDay.length ? byDay.map(d => known.indexOf(d)) : [weekday(startDay)]).sort((a, b) => fromStart(a) - fromStart(b)) : [];
  const origin = freq === 'DAILY' ? startDay : freq === 'MONTHLY' ? `${startDay.slice(0, 8)}01` : dayPlus(startDay, -fromStart(weekday(startDay)));
  const months = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
  const monthOf = (index: number) => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}-01`;
  // Without a COUNT nothing before the window matters, so start one period
  // before it; with one, every occurrence since DTSTART counts.
  let first = 0;
  if (count === undefined) {
    const fromDay = isoInZone(input.from, input.anchorZone).slice(0, 10);
    const behind = freq === 'MONTHLY'
      ? Math.floor((months(fromDay) - months(origin)) / interval)
      : Math.floor(daysBetween(origin, fromDay) / step);
    first = Math.max(0, behind - 1);
  }
  const days: string[] = [];
  for (let k = first; days.length < SAFETY_CAP; k += 1) {
    const base = freq === 'MONTHLY' ? monthOf(months(origin) + k * interval) : dayPlus(origin, k * step);
    const when = at(base);
    if (Number.isNaN(when.getTime()) || when > input.to || (end && when > end)) {
      break;
    }
    if (freq === 'DAILY') {
      days.push(base);
      continue;
    }
    if (freq === 'MONTHLY') {
      days.push(...byDay.map(d => placedDay(base, d)).filter((day): day is string => day !== undefined && day >= startDay));
      continue;
    }
    for (const wd of wanted) {
      const day = dayPlus(base, fromStart(wd));
      if (day >= startDay) {
        days.push(day);
      }
    }
  }
  days.sort();
  let instants = days.map(at).filter(d => !end || d <= end);
  if (count !== undefined) {
    instants = instants.slice(0, count);
  }
  const skip = new Set(input.exdates.map(d => d.getTime()));
  const out = new Set<number>();
  for (const d of [...instants, ...input.rdates]) {
    if (d >= input.from && d <= input.to && !skip.has(d.getTime())) {
      out.add(d.getTime());
    }
  }
  return [...out].sort((a, b) => a - b).map(t => new Date(t));
}
