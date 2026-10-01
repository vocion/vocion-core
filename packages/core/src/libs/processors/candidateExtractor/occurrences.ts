/**
 * One record per occurrence of a series, written by core rather than the
 * model, under `occurrenceFields`.
 *
 * A record whose dates follow a rule the document states comes back once,
 * with the rule in `repeats`; a split calendar entry brings its own RRULE,
 * RDATE and EXDATE. The other occurrences inside the horizon are written from
 * that one record, so each date is the rule's rather than the model's, and a
 * series costs one record of output instead of one per date. This is the
 * first pass of `validateRecords`, so every written record then meets the
 * same gates as the model's own.
 *
 *   stated on a page:  the model's own record for a date wins; a guard that
 *                      refuses the rule leaves the record single
 *   calendar entry:    the feed wins; a record on a day its rule does not
 *                      produce is dropped, and an entry whose rule is not
 *                      read is left to the model as it is
 */

import type { CandidateExtractorConfig } from './config';
import type { ExtractedRecord } from './model';
import type { IcsDuration, icsRecurrence } from '@/libs/sources/web';
import { normaliseForKey } from '@/libs/actions/objects-propose-candidate';
import { expandRecurrence, readRule } from '@/libs/time/recurrence';
import { dayKey, dayPlus, daysBetween, endOfDay, instantInZone, isoInZone, resolveTimeZone, startOfDay } from '@/libs/time/zone';
import { RULE_EVIDENCE_CAP, STATED_RULE_PARTS } from './config';

/** How far past an instant a series' next date is looked for: ten years. */
export const LOOKAHEAD_DAYS = 3_653;

/** Occurrences one rule writes at most, about the timed dates a calendar entry's list of dates used to carry. */
const PER_RULE_CAP = 150;
const DATED = /^(\d{4}-\d{2}-\d{2})(?:([T ])(\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** A split calendar component, as the prompt, the revisit time and the expander read it. */
export type CalendarEntry = {
  lines: string[];
  /** The zone the calendar declares, else the configured one. */
  zone: string;
  /** Its rule and anchor, when `icsRecurrence` reads them. */
  rec?: NonNullable<ReturnType<typeof icsRecurrence>>;
  /** The instances the feed writes as components of their own. */
  replaced: Set<number>;
  /** The horizon on the calendar's clock, from today's start to its last day's end. */
  from: Date;
  to: Date;
};

/** A calendar entry whose rule the expander reads. */
export type FeedSeries = Omit<CalendarEntry, 'lines'> & { rec: NonNullable<CalendarEntry['rec']> };

type Recurrence = Pick<FeedSeries['rec'], 'start' | 'anchorZone' | 'rule' | 'exdates' | 'rdates'>;

/** A record for the gates, with what this pass wrote into it. */
type Occurrence = {
  record: ExtractedRecord;
  /** The index of the model's record it came from. */
  origin: number;
  /** Fields written here, which the document cannot be held to printing. */
  computed?: Set<string>;
  /** Notes for the reviewer, ahead of anything the gates add. */
  issues?: string[];
};

/**
 * The first occurrence from an instant on, looked for over ten years of days.
 * @param rec - the rule and its anchor.
 * @param from - the instant to look from.
 * @param zone - the zone whose days the search counts.
 * @param exclude - occurrences that do not count.
 */
export function nextOccurrence(rec: Recurrence, from: Date, zone: string, exclude: (at: Date) => boolean = () => false): Date | undefined {
  return expandRecurrence({ ...rec, from, to: endOfDay(dayPlus(dayKey(from, zone), LOOKAHEAD_DAYS - 1), zone) }).find(at => !exclude(at));
}

/**
 * An occurrence as a calendar entry's dates are written for the model: the
 * day of an all-day entry, else the instant with its offset.
 * @param at - the occurrence.
 * @param rec - the entry's series.
 * @param rec.allDay - whether the entry is all-day.
 * @param zone - the zone it is written in.
 */
export function entryDateText(at: Date, rec: { allDay: boolean }, zone: string): string {
  return rec.allDay ? isoInZone(at, zone).slice(0, 10) : isoInZone(at, zone);
}

/**
 * The zone a calendar entry's occurrences are written in: the record's own
 * floating times are local to the configured zone, whatever the calendar
 * declares, while an all-day entry's days are the entry's own.
 * @param rec - the entry's series.
 * @param config - the processor config.
 */
export function wallZoneOf(rec: FeedSeries['rec'], config: CandidateExtractorConfig): string {
  return rec.allDay ? rec.anchorZone : resolveTimeZone(config.timezone);
}

/**
 * A dated value on the zone's wall clock, `YYYY-MM-DDTHH:MM:SS`, an offset
 * form read as the instant it names; undefined for a value with no real date.
 * @param value - a field value.
 * @param zone - the zone the record's dates are local to.
 */
function readWall(value: unknown, zone: string): { wall: string; timed: boolean } | undefined {
  const m = typeof value === 'string' ? DATED.exec(value.trim()) : null;
  if (!m) {
    return undefined;
  }
  if (m[3] && m[4]) {
    const at = new Date(String(value).trim());
    return Number.isNaN(at.getTime()) ? undefined : { wall: isoInZone(at, zone).slice(0, 19), timed: true };
  }
  const wall = `${m[1]}T${(m[3] ?? '00:00').padEnd(8, ':00')}`;
  return Number.isNaN(instantInZone(wall, 'UTC').getTime()) ? undefined : { wall, timed: m[3] !== undefined };
}

/**
 * A wall clock written the way the template wrote its own value: a date stays
 * a date, a local time keeps its separator and precision, and an offset form
 * becomes local, never an offset that would be wrong across a clock change.
 * @param template - the template's value.
 * @param wall - `YYYY-MM-DDTHH:MM:SS`.
 */
function inShape(template: unknown, wall: string): string {
  const m = DATED.exec(String(template).trim());
  if (!m?.[3]) {
    return wall.slice(0, 10);
  }
  return m[4] ? wall : `${wall.slice(0, 10)}${m[2]}${wall.slice(11, 11 + m[3].length)}`;
}

function shifted(wall: string, days: number): string {
  return `${dayPlus(wall.slice(0, 10), days)}${wall.slice(10)}`;
}

/**
 * When an occurrence ends: whole days on the series' clock, then exact time.
 * @param at - the occurrence's start.
 * @param lasts - the entry's duration.
 * @param zone - the series' clock.
 */
function endedAt(at: Date, lasts: IcsDuration, zone: string): Date {
  const wall = isoInZone(at, zone).slice(0, 19);
  const moved = lasts.days ? instantInZone(shifted(wall, lasts.days), zone) : at;
  return new Date((Number.isNaN(moved.getTime()) ? at.getTime() + lasts.days * 86_400_000 : moved.getTime()) + lasts.ms);
}

/**
 * The records to validate: the model's own, and one per occurrence written
 * from a stated rule or a calendar entry's own series.
 * @param opts - what the pass reads.
 * @param opts.records - what the model returned.
 * @param opts.config - the source's processor config.
 * @param opts.today - today as a calendar day in the config's timezone.
 * @param opts.feedSeries - the split calendar entry's own series, when its rule is one the expander reads.
 * @param opts.calendarEntry - whether the document is a split calendar entry, whose dates are never read off a stated rule.
 * @param opts.knownIds - run ids the prompt carried, for a template that duplicates one of them.
 * @param opts.onPage - whether the document carries a quote.
 */
export function expandOccurrences(opts: {
  records: ExtractedRecord[];
  config: CandidateExtractorConfig;
  today: string;
  feedSeries?: FeedSeries;
  calendarEntry?: boolean;
  knownIds: Set<number>;
  onPage: (quote: string) => boolean;
}): { items: Occurrence[]; counts: Record<string, number>; notes: string[]; nextUnwritten?: string } {
  const { config, records, feedSeries } = opts;
  const fields = config.occurrenceFields;
  if (!fields || (opts.calendarEntry && !feedSeries)) {
    return { items: records.map((record, origin) => ({ record, origin })), counts: {}, notes: [] };
  }
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const bump = (key: string, by = 1): void => {
    counts[key] = (counts[key] ?? 0) + by;
  };
  const zone = feedSeries ? wallZoneOf(feedSeries.rec, config) : resolveTimeZone(config.timezone);
  const from = startOfDay(opts.today, zone);
  const to = endOfDay(dayPlus(opts.today, config.recurrenceHorizonDays), zone);
  const dayIn = (value: unknown) => readWall(value, zone)?.wall.slice(0, 10) ?? null;

  // The identity without its dates, defaults filled in as the gates will fill them.
  const others = config.dedupOn.filter(field => field !== fields.day && field !== fields.start && field !== fields.end);
  const keyOf = (record: ExtractedRecord, day: string | null): string => [...others.map((field) => {
    const key = normaliseForKey(record.fields[field]);
    return key === 'none' ? normaliseForKey(config.defaults?.[field]) : key;
  }), day ?? ''].join('|');
  const held = new Set<string>();
  const written: Array<Occurrence & { day: string }> = [];
  let unwritten: string | undefined;
  const missed = (day: string): void => {
    unwritten = unwritten === undefined || day < unwritten ? day : unwritten;
  };
  const write = (template: ExtractedRecord, origin: number, day: string, values: Record<string, string>, quote: string): boolean => {
    const key = keyOf(template, day);
    if (held.has(key)) {
      bump('expansion.held');
      return false;
    }
    held.add(key);
    const { seriesOf: _seriesOf, duplicateOf: _duplicateOf, seriesNote: _seriesNote, repeats: _repeats, ...rest } = template;
    written.push({
      day,
      origin,
      record: { ...rest, fields: { ...template.fields, ...values } },
      computed: new Set(Object.keys(values)),
      issues: [`date computed from ${feedSeries ? 'the rule of the calendar entry' : 'the stated rule'}: ${quote.slice(0, RULE_EVIDENCE_CAP)}`],
    });
    return true;
  };
  const capped = (days: string[], writeOne: (day: string, index: number) => boolean): void => {
    let n = 0;
    for (const [index, day] of days.entries()) {
      if (n >= PER_RULE_CAP) {
        bump('expansion.capped');
        missed(day);
      } else if (writeOne(day, index)) {
        n += 1;
      }
    }
  };

  const kept: Occurrence[] = [];
  if (feedSeries) {
    // The feed is the authority on its own dates: every record the model
    // returned is replaced by the computed ones, and one on a day the rule
    // does not produce was invented.
    const { rec, replaced } = feedSeries;
    const own = (at: Date) => !replaced.has(at.getTime());
    for (const record of records) {
      const day = dayIn(record.fields[fields.day]);
      bump(day && expandRecurrence({ ...rec, from: startOfDay(day, zone), to: endOfDay(day, zone) }).some(own) ? 'expansion.replaced' : 'skipped.not_in_rule');
    }
    const template = records[0];
    if (template) {
      const dates = expandRecurrence({ ...rec, from, to }).filter(own);
      const walls = dates.map(at => isoInZone(at, zone).slice(0, 19));
      const base = readWall(template.fields[fields.start ?? fields.day], zone) ?? readWall(template.fields[fields.day], zone);
      capped(walls.map(wall => wall.slice(0, 10)), (day, index) => {
        const wall = walls[index]!;
        const values: Record<string, string> = { [fields.day]: inShape(template.fields[fields.day], wall) };
        if (fields.start && readWall(template.fields[fields.start], zone)) {
          values[fields.start] = inShape(template.fields[fields.start], wall);
        }
        const end = fields.end ? readWall(template.fields[fields.end], zone) : undefined;
        if (fields.end && end) {
          const endWall = end.timed && rec.duration && !rec.allDay
            ? isoInZone(endedAt(dates[index]!, rec.duration, rec.anchorZone), zone).slice(0, 19)
            : base && shifted(end.wall, daysBetween(base.wall.slice(0, 10), day));
          if (endWall) {
            values[fields.end] = inShape(template.fields[fields.end], endWall);
          }
        }
        return write(template, 0, day, values, `RRULE:${rec.rule}`);
      });
    }
  } else {
    records.forEach((record, origin) => kept.push({ record, origin }));
    for (const { record } of kept) {
      held.add(keyOf(record, dayIn(record.fields[fields.day])));
    }
    for (const item of kept) {
      const { repeats, duplicateOf } = item.record;
      if (!repeats) {
        continue;
      }
      const refuse = (key: string, why: string): void => {
        bump(key);
        item.issues = [`repeats: ${why}, so only this date was proposed`];
      };
      if (duplicateOf !== undefined && opts.knownIds.has(duplicateOf)) {
        refuse('expansion.template_duplicate', `the record duplicates #${duplicateOf}, already waiting for review`);
        continue;
      }
      const evidence = repeats.evidence?.trim() ?? '';
      if (!opts.onPage(evidence)) {
        refuse('expansion.evidence_not_in_document', 'the words stating the rule are not in the document');
        continue;
      }
      if (!readRule(repeats.rule)) {
        refuse('expansion.rule_unread', `"${repeats.rule}" is not a rule core reads`);
        continue;
      }
      if (repeats.rule.split(';').filter(part => part.trim()).some(part => !(STATED_RULE_PARTS as readonly string[]).includes(part.split('=')[0]!.trim().toUpperCase()))) {
        refuse('expansion.rule_counts', `"${repeats.rule}" counts its dates from the series' first date, which this record need not be`);
        continue;
      }
      const anchorDay = dayIn(item.record.fields[fields.day]);
      const skip = new Set((repeats.except ?? []).map(dayIn));
      if (!anchorDay || skip.has(anchorDay)) {
        refuse('expansion.anchor_not_in_rule', anchorDay ? 'its date is one the document says the rule skips' : 'its date could not be read');
        continue;
      }
      const clock = [fields.start, fields.day].map(field => field ? readWall(item.record.fields[field], zone) : undefined).find(read => read?.timed);
      const rule: Recurrence = { start: instantInZone(`${anchorDay}T${clock ? clock.wall.slice(11) : '12:00:00'}`, zone), anchorZone: zone, rule: repeats.rule, exdates: [], rdates: [] };
      if (Number.isNaN(rule.start.getTime()) || expandRecurrence({ ...rule, from: rule.start, to: rule.start }).length === 0) {
        refuse('expansion.anchor_not_in_rule', `its date is not one "${repeats.rule}" produces`);
        continue;
      }
      capped(expandRecurrence({ ...rule, from, to }).map(at => dayKey(at, zone)).filter(day => day !== anchorDay && !skip.has(day)), (day) => {
        const values: Record<string, string> = {};
        for (const field of [fields.day, fields.start, fields.end]) {
          const own = field ? readWall(item.record.fields[field], zone) : undefined;
          if (field && own) {
            values[field] = inShape(item.record.fields[field], shifted(own.wall, daysBetween(anchorDay, day)));
          }
        }
        return write(item.record, item.origin, day, values, evidence);
      });
      const after = nextOccurrence(rule, new Date(to.getTime() + 1), zone, at => skip.has(dayKey(at, zone)));
      if (after) {
        missed(dayKey(after, zone));
      }
    }
  }

  written.sort((a, b) => a.day.localeCompare(b.day));
  const room = Math.max(0, config.maxRecordsPerDocument - kept.length);
  if (written.length > room) {
    bump('expansion.trimmed', written.length - room);
    missed(written[room]!.day);
    notes.push(`${written.length - room} occurrence(s) past the document's limit of ${config.maxRecordsPerDocument} records were left out`);
    written.length = room;
  }
  if (counts['expansion.capped']) {
    notes.push(`${counts['expansion.capped']} occurrence(s) past the ${PER_RULE_CAP} one rule may write were left out`);
  }
  if (written.length > 0) {
    counts.expanded = written.length;
  }
  return { items: [...kept, ...written.map(({ day: _day, ...item }) => item)], counts, notes, ...(unwritten ? { nextUnwritten: unwritten } : {}) };
}
