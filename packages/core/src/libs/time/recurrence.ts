/**
 * A deterministic subset of RFC 5545 recurrence: the rules a venue calendar
 * actually writes (daily or weekly, an interval, weekdays, a count or an end),
 * expanded on the rule's own clock so a wall-clock time survives a clock
 * change and a UTC-anchored rule keeps its UTC weekday. Anything else returns
 * nothing and stays the model's job. One stated deviation: a DTSTART that
 * does not match BYDAY is not added as an extra first occurrence.
 */

import { dayPlus, instantInZone, isoInZone } from './zone';

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
// Any other part (BYMONTH, BYHOUR, BYSETPOS, ...) changes the dates, so a rule that has one is not read.
const READ_PARTS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST']);
const SAFETY_CAP = 1_000;
const DAY_MS = 86_400_000;

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
function until(value: string, anchorZone: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
  if (!m) {
    return undefined;
  }
  const at = m[4] === undefined
    ? instantInZone(`${m[1]}-${m[2]}-${m[3]}T23:59:59`, anchorZone)
    : instantInZone(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, 'UTC');
  return Number.isNaN(at.getTime()) ? undefined : at;
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
  const r = parts(input.rule);
  const freq = r.get('FREQ');
  if ((freq !== 'DAILY' && freq !== 'WEEKLY') || [...r.keys()].some(k => !READ_PARTS.has(k)) || ['INTERVAL', 'COUNT'].some(k => r.has(k) && !/^\d+$/.test(r.get(k)!))) {
    return [];
  }
  const interval = Number(r.get('INTERVAL') ?? '1');
  const count = r.has('COUNT') ? Number(r.get('COUNT')) : undefined;
  const end = r.has('UNTIL') ? until(r.get('UNTIL')!, input.anchorZone) : undefined;
  const byDay = (r.get('BYDAY') ?? '').split(',').filter(Boolean);
  const known = WEEKDAYS as readonly string[];
  if (interval < 1 || interval > SAFETY_CAP || (count !== undefined && !(count > 0 && count <= SAFETY_CAP)) || (r.has('UNTIL') && !end) || (freq === 'DAILY' && byDay.length > 0) || byDay.some(d => !known.includes(d)) || !known.includes(r.get('WKST') ?? 'MO')) {
    return [];
  }
  const wkst = known.indexOf(r.get('WKST') ?? 'MO');
  const local = isoInZone(input.start, input.anchorZone);
  const startDay = local.slice(0, 10);
  const clock = local.slice(11, 19);
  const at = (day: string) => instantInZone(`${day}T${clock}`, input.anchorZone);
  // A start outside four-digit years does not read back on its own clock, and nothing after it can be walked.
  if (Number.isNaN(at(startDay).getTime())) {
    return [];
  }
  const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = MO
  const fromStart = (wd: number) => (wd - wkst + 7) % 7;
  const step = freq === 'DAILY' ? interval : 7 * interval;
  const wanted = freq === 'DAILY' ? [] : (byDay.length ? byDay.map(d => known.indexOf(d)) : [weekday(startDay)]).sort((a, b) => fromStart(a) - fromStart(b));
  const origin = freq === 'DAILY' ? startDay : dayPlus(startDay, -fromStart(weekday(startDay)));
  // Without a COUNT nothing before the window matters, so start one period
  // before it; with one, every occurrence since DTSTART counts.
  let first = 0;
  if (count === undefined) {
    const fromDay = isoInZone(input.from, input.anchorZone).slice(0, 10);
    const behind = Math.floor((Date.parse(`${fromDay}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / DAY_MS / step);
    first = Math.max(0, behind - 1);
  }
  const days: string[] = [];
  for (let k = first; days.length < SAFETY_CAP; k += 1) {
    const base = dayPlus(origin, k * step);
    const when = at(base);
    if (Number.isNaN(when.getTime()) || when > input.to || (end && when > end)) {
      break;
    }
    if (freq === 'DAILY') {
      days.push(base);
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
