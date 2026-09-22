/**
 * Relative days for eval checks. Every rule here is one a date check could
 * get wrong and pass or fail a real run for it: a day that flips at the wrong
 * hour, a month that overflows, an evening event moved onto the next day, a
 * typo that quietly resolves to something nobody meant.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarDayOf, isDayZone, isRelativeDay, resolveDayZone, resolveRelativeDay } from './relativeDay';

// 9:30pm in Vermont on Sept 22, which is already Sept 23 in UTC.
const VERMONT_EVENING = new Date('2026-09-23T01:30:00Z');
const MIDDAY = new Date('2026-09-22T12:00:00Z');

describe('resolveRelativeDay — which day "today" is', () => {
  it('names today in the zone asked for, not the server\'s', () => {
    // The server runs in UTC. Resolving "today" there at 9:30pm Eastern
    // would call tonight's 10pm show yesterday's news.
    expect(resolveRelativeDay('today', 'UTC', VERMONT_EVENING)).toBe('2026-09-23');
    expect(resolveRelativeDay('today', 'America/New_York', VERMONT_EVENING)).toBe('2026-09-22');
  });

  it('flips at local midnight, not a minute early or late', () => {
    // 23:59 and 00:00 Eastern (EDT, UTC-4) on either side of the flip.
    expect(resolveRelativeDay('today', 'America/New_York', new Date('2026-09-23T03:59:00Z'))).toBe('2026-09-22');
    expect(resolveRelativeDay('today', 'America/New_York', new Date('2026-09-23T04:00:00Z'))).toBe('2026-09-23');
  });

  it('handles zones far ahead of and behind UTC', () => {
    // At the same instant, Kiritimati (UTC+14) and Pago Pago (UTC-11) are
    // two calendar days apart. A zone applied backwards would swap them.
    const instant = new Date('2026-09-22T11:00:00Z');

    expect(resolveRelativeDay('today', 'Pacific/Kiritimati', instant)).toBe('2026-09-23');
    expect(resolveRelativeDay('today', 'Pacific/Pago_Pago', instant)).toBe('2026-09-22');
    expect(resolveRelativeDay('today', 'Pacific/Pago_Pago', new Date('2026-09-22T10:00:00Z'))).toBe('2026-09-21');
  });

  it('gives yesterday and tomorrow across the spring-forward night', () => {
    // US clocks jump 2am to 3am on 2026-03-08. That day is 23 hours long,
    // so adding 24 hours of milliseconds would land on the wrong day.
    const morningAfter = new Date('2026-03-09T13:00:00Z');

    expect(resolveRelativeDay('yesterday', 'America/New_York', morningAfter)).toBe('2026-03-08');
    expect(resolveRelativeDay('2 days ago', 'America/New_York', morningAfter)).toBe('2026-03-07');
  });

  it('gives yesterday and tomorrow across the fall-back night', () => {
    // 2026-11-01 is 25 hours long in the US.
    const eveningBefore = new Date('2026-11-01T02:00:00Z');

    expect(resolveRelativeDay('today', 'America/New_York', eveningBefore)).toBe('2026-10-31');
    expect(resolveRelativeDay('tomorrow', 'America/New_York', eveningBefore)).toBe('2026-11-01');
    expect(resolveRelativeDay('in 2 days', 'America/New_York', eveningBefore)).toBe('2026-11-02');
  });
});

describe('resolveRelativeDay — moving by units', () => {
  it('moves by each named phrase', () => {
    expect(resolveRelativeDay('today', 'UTC', MIDDAY)).toBe('2026-09-22');
    expect(resolveRelativeDay('yesterday', 'UTC', MIDDAY)).toBe('2026-09-21');
    expect(resolveRelativeDay('tomorrow', 'UTC', MIDDAY)).toBe('2026-09-23');
    expect(resolveRelativeDay('last week', 'UTC', MIDDAY)).toBe('2026-09-15');
    expect(resolveRelativeDay('next week', 'UTC', MIDDAY)).toBe('2026-09-29');
    expect(resolveRelativeDay('last month', 'UTC', MIDDAY)).toBe('2026-08-22');
    expect(resolveRelativeDay('next month', 'UTC', MIDDAY)).toBe('2026-10-22');
    expect(resolveRelativeDay('last year', 'UTC', MIDDAY)).toBe('2025-09-22');
    expect(resolveRelativeDay('next year', 'UTC', MIDDAY)).toBe('2027-09-22');
  });

  it('moves by counted phrases in both directions', () => {
    expect(resolveRelativeDay('3 days ago', 'UTC', MIDDAY)).toBe('2026-09-19');
    expect(resolveRelativeDay('in 10 days', 'UTC', MIDDAY)).toBe('2026-10-02');
    expect(resolveRelativeDay('2 weeks ago', 'UTC', MIDDAY)).toBe('2026-09-08');
    expect(resolveRelativeDay('in 2 weeks', 'UTC', MIDDAY)).toBe('2026-10-06');
    expect(resolveRelativeDay('6 months ago', 'UTC', MIDDAY)).toBe('2026-03-22');
    expect(resolveRelativeDay('in 18 months', 'UTC', MIDDAY)).toBe('2028-03-22');
    expect(resolveRelativeDay('5 years ago', 'UTC', MIDDAY)).toBe('2021-09-22');
  });

  it('accepts singular and plural units alike', () => {
    expect(resolveRelativeDay('1 day ago', 'UTC', MIDDAY)).toBe('2026-09-21');
    expect(resolveRelativeDay('1 days ago', 'UTC', MIDDAY)).toBe('2026-09-21');
    expect(resolveRelativeDay('in 1 week', 'UTC', MIDDAY)).toBe('2026-09-29');
  });

  it('treats zero as today', () => {
    expect(resolveRelativeDay('0 days ago', 'UTC', MIDDAY)).toBe('2026-09-22');
    expect(resolveRelativeDay('in 0 months', 'UTC', MIDDAY)).toBe('2026-09-22');
  });

  it('ignores case and surrounding spaces', () => {
    expect(resolveRelativeDay('  Today ', 'UTC', MIDDAY)).toBe('2026-09-22');
    expect(resolveRelativeDay('LAST WEEK', 'UTC', MIDDAY)).toBe('2026-09-15');
  });

  it('crosses a year boundary by days and weeks', () => {
    const newYearsEve = new Date('2026-12-31T12:00:00Z');

    expect(resolveRelativeDay('tomorrow', 'UTC', newYearsEve)).toBe('2027-01-01');
    expect(resolveRelativeDay('next week', 'UTC', newYearsEve)).toBe('2027-01-07');
    expect(resolveRelativeDay('last week', 'UTC', new Date('2027-01-03T12:00:00Z'))).toBe('2026-12-27');
  });

  it('crosses a year boundary by months', () => {
    expect(resolveRelativeDay('next month', 'UTC', new Date('2026-12-15T12:00:00Z'))).toBe('2027-01-15');
    expect(resolveRelativeDay('last month', 'UTC', new Date('2027-01-15T12:00:00Z'))).toBe('2026-12-15');
    expect(resolveRelativeDay('13 months ago', 'UTC', new Date('2027-01-15T12:00:00Z'))).toBe('2025-12-15');
  });
});

describe('resolveRelativeDay — month and year ends', () => {
  it('clamps a month move to the last real day instead of spilling into the next month', () => {
    // March 31st minus a month is not March 3rd.
    expect(resolveRelativeDay('last month', 'UTC', new Date('2026-03-31T12:00:00Z'))).toBe('2026-02-28');
    expect(resolveRelativeDay('next month', 'UTC', new Date('2026-01-31T12:00:00Z'))).toBe('2026-02-28');
    expect(resolveRelativeDay('next month', 'UTC', new Date('2026-05-31T12:00:00Z'))).toBe('2026-06-30');
  });

  it('keeps February 29th in a leap year', () => {
    expect(resolveRelativeDay('next month', 'UTC', new Date('2028-01-31T12:00:00Z'))).toBe('2028-02-29');
    expect(resolveRelativeDay('yesterday', 'UTC', new Date('2028-03-01T12:00:00Z'))).toBe('2028-02-29');
  });

  it('clamps February 29th to the 28th a year away', () => {
    const leapDay = new Date('2028-02-29T12:00:00Z');

    expect(resolveRelativeDay('last year', 'UTC', leapDay)).toBe('2027-02-28');
    expect(resolveRelativeDay('next year', 'UTC', leapDay)).toBe('2029-02-28');
    expect(resolveRelativeDay('in 4 years', 'UTC', leapDay)).toBe('2032-02-29');
  });

  it('does not let a clamped month carry its short day into the next move', () => {
    // Each phrase resolves from today, not from the last answer: "in 2
    // months" from Jan 31 is Mar 31, not Feb 28 plus one month.
    expect(resolveRelativeDay('in 2 months', 'UTC', new Date('2026-01-31T12:00:00Z'))).toBe('2026-03-31');
  });

  it('resolves months and years from the zone\'s day, not UTC\'s', () => {
    // Evening of Jan 31 in Vermont is Feb 1 in UTC. "next month" from the
    // Vermont day is the end of February, from the UTC day it is March 1.
    const vermontJan31 = new Date('2026-02-01T02:00:00Z');

    expect(resolveRelativeDay('next month', 'America/New_York', vermontJan31)).toBe('2026-02-28');
    expect(resolveRelativeDay('next month', 'UTC', vermontJan31)).toBe('2026-03-01');
  });
});

describe('resolveRelativeDay — absolute days and refusals', () => {
  it('passes an absolute day through untouched, whatever the clock or zone', () => {
    expect(resolveRelativeDay('2026-09-01', 'America/New_York', VERMONT_EVENING)).toBe('2026-09-01');
    expect(resolveRelativeDay('2026-09-01', 'Pacific/Kiritimati', MIDDAY)).toBe('2026-09-01');
  });

  it('refuses a phrase it does not know rather than guessing', () => {
    expect(() => resolveRelativeDay('next friday', 'UTC', VERMONT_EVENING)).toThrow('next friday');
    expect(() => resolveRelativeDay('a week ago', 'UTC', VERMONT_EVENING)).toThrow();
    expect(() => resolveRelativeDay('-3 days ago', 'UTC', VERMONT_EVENING)).toThrow();
    expect(() => resolveRelativeDay('3 fortnights ago', 'UTC', VERMONT_EVENING)).toThrow();
    expect(() => resolveRelativeDay('', 'UTC', VERMONT_EVENING)).toThrow();
  });
});

describe('isRelativeDay', () => {
  it('accepts every phrase resolveRelativeDay can resolve', () => {
    // The schema uses this, so anything it accepts must resolve at run time;
    // a mismatch would throw halfway through scoring.
    const phrases = ['today', 'Yesterday', 'tomorrow', 'last week', 'next week', 'last month', 'next month', 'last year', 'next year', '1 day ago', '12 weeks ago', 'in 3 months', 'in 1 year', '2026-09-01'];
    for (const phrase of phrases) {
      expect(isRelativeDay(phrase)).toBe(true);
      expect(() => resolveRelativeDay(phrase, 'UTC', MIDDAY)).not.toThrow();
    }
  });

  it('rejects near misses a person might type', () => {
    for (const phrase of ['the day before', 'next friday', 'a week ago', 'in a month', '3 days from now', '2026/09/01', '09-01-2026', 'now', '']) {
      expect(isRelativeDay(phrase)).toBe(false);
    }
  });
});

describe('isDayZone and resolveDayZone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts utc, local and real IANA names, in any case for the words', () => {
    expect(isDayZone('utc')).toBe(true);
    expect(isDayZone('UTC')).toBe(true);
    expect(isDayZone('Local')).toBe(true);
    expect(isDayZone('America/New_York')).toBe(true);
    expect(isDayZone('Pacific/Kiritimati')).toBe(true);
  });

  it('rejects zones that are not zones', () => {
    // An invalid zone would throw from Intl in the middle of a run.
    expect(isDayZone('Vermont')).toBe(false);
    expect(isDayZone('EST5EDT-ish')).toBe(false);
    expect(isDayZone('')).toBe(false);
  });

  it('reads utc and a missing zone as UTC', () => {
    expect(resolveDayZone(undefined)).toBe('UTC');
    expect(resolveDayZone('')).toBe('UTC');
    expect(resolveDayZone('utc')).toBe('UTC');
    expect(resolveDayZone('UTC')).toBe('UTC');
  });

  it('passes an IANA name through unchanged', () => {
    expect(resolveDayZone('America/New_York')).toBe('America/New_York');
  });

  it('reads local as the zone of the machine running the check', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Europe/Berlin' } as Intl.ResolvedDateTimeFormatOptions);

    expect(resolveDayZone('local')).toBe('Europe/Berlin');
    expect(resolveDayZone('LOCAL')).toBe('Europe/Berlin');
  });
});

describe('calendarDayOf', () => {
  it('reads a bare day as written, in any zone', () => {
    expect(calendarDayOf('2026-09-22', 'UTC')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-22', 'Asia/Tokyo')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-22', 'Pacific/Pago_Pago')).toBe('2026-09-22');
  });

  it('reads a wall-clock time with no offset as the day it names', () => {
    // `start` is venue-local with no offset. Converting 11:30pm to UTC first
    // would move it to the next day and pass a rule it broke.
    expect(calendarDayOf('2026-09-22T23:30', 'UTC')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-22T23:30:15', 'Asia/Tokyo')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-22T00:00:00.000', 'Pacific/Kiritimati')).toBe('2026-09-22');
  });

  it('places an instant on its day in the zone asked for', () => {
    expect(calendarDayOf('2026-09-23T01:30:00Z', 'America/New_York')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-23T01:30:00Z', 'UTC')).toBe('2026-09-23');
    expect(calendarDayOf('2026-09-23T01:30:00.250Z', 'UTC')).toBe('2026-09-23');
  });

  it('reads every offset spelling an ISO timestamp can carry', () => {
    // 9:30pm Eastern on the 22nd, written three ways. It is 1:30am on the
    // 23rd in UTC, so the zone has to be applied to the instant, not the text.
    expect(calendarDayOf('2026-09-22T21:30:00-04:00', 'UTC')).toBe('2026-09-23');
    expect(calendarDayOf('2026-09-22T21:30:00-04:00', 'America/New_York')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-22T21:30:00-0400', 'America/New_York')).toBe('2026-09-22');
    expect(calendarDayOf('2026-09-22T21:30-04:00', 'America/New_York')).toBe('2026-09-22');
  });

  it('trims spaces around the value', () => {
    expect(calendarDayOf('  2026-09-22  ', 'UTC')).toBe('2026-09-22');
  });

  it('refuses days that do not exist', () => {
    // Date rolls Feb 30 into March; passing it through would compare a day
    // that was never on any calendar.
    expect(calendarDayOf('2026-02-30', 'UTC')).toBeNull();
    expect(calendarDayOf('2026-02-29', 'UTC')).toBeNull();
    expect(calendarDayOf('2026-04-31T10:00', 'UTC')).toBeNull();
    expect(calendarDayOf('2026-13-01', 'UTC')).toBeNull();
    expect(calendarDayOf('2026-00-10', 'UTC')).toBeNull();
  });

  it('accepts February 29th in a leap year', () => {
    expect(calendarDayOf('2028-02-29', 'UTC')).toBe('2028-02-29');
  });

  it('refuses text that only looks like a date', () => {
    expect(calendarDayOf('next Friday', 'UTC')).toBeNull();
    expect(calendarDayOf('Sept 22, 2026', 'UTC')).toBeNull();
    expect(calendarDayOf('09/22/2026', 'UTC')).toBeNull();
    expect(calendarDayOf('2026-9-22', 'UTC')).toBeNull();
    expect(calendarDayOf('2026-09-22 19:30', 'UTC')).toBeNull();
    expect(calendarDayOf('', 'UTC')).toBeNull();
  });

  it('refuses values that are not text', () => {
    expect(calendarDayOf(20260922, 'UTC')).toBeNull();
    expect(calendarDayOf(null, 'UTC')).toBeNull();
    expect(calendarDayOf(undefined, 'UTC')).toBeNull();
    expect(calendarDayOf({ date: '2026-09-22' }, 'UTC')).toBeNull();
    expect(calendarDayOf(['2026-09-22'], 'UTC')).toBeNull();
    expect(calendarDayOf(new Date('2026-09-22T00:00:00Z'), 'UTC')).toBeNull();
  });
});
