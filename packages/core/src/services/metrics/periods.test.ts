import { describe, expect, it } from 'vitest';
import { lastMonths, lastWeeks } from './periods';

const LA = 'America/Los_Angeles';

describe('the weeks a Metrics page reads', () => {
  it('runs Monday to Sunday in the zone, oldest first, this week cut at now', () => {
    // Saturday 2026-10-17, 08:00 Pacific.
    const now = new Date('2026-10-17T15:00:00Z');
    const weeks = lastWeeks(3, now, LA);

    expect(weeks.map(w => w.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(weeks.map(w => w.label)).toEqual(['Sep 28', 'Oct 5', 'Oct 12']);
    expect(weeks[0]!.since.toISOString()).toBe('2026-09-28T07:00:00.000Z');
    expect(weeks[0]!.until.toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(weeks[2]!.until).toBe(now);
    expect(weeks.map(w => w.partial)).toEqual([false, false, true]);
  });

  it('treats a Monday as the start of its own week', () => {
    const weeks = lastWeeks(1, new Date('2026-10-19T08:00:00Z'), LA);

    expect(weeks[0]!.start).toBe('2026-10-19');
  });

  it('keeps each week whole across the end of daylight time', () => {
    const weeks = lastWeeks(3, new Date('2026-11-10T20:00:00Z'), LA);

    // Nov 1 2026 is the fall-back Sunday: the week of Oct 26 is 169 hours long.
    expect(weeks[0]!.start).toBe('2026-10-26');
    expect(weeks[0]!.since.toISOString()).toBe('2026-10-26T07:00:00.000Z');
    expect(weeks[0]!.until.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('uses the zone\'s date, not UTC\'s, late on a Sunday', () => {
    // Sunday 2026-10-18, 21:00 Pacific, already Monday in UTC.
    const weeks = lastWeeks(1, new Date('2026-10-19T04:00:00Z'), LA);

    expect(weeks[0]!.start).toBe('2026-10-12');
  });
});

describe('the months a Metrics page reads', () => {
  it('runs by calendar month in the zone, oldest first, this month cut at now', () => {
    const now = new Date('2026-10-17T15:00:00Z');
    const months = lastMonths(3, now, LA);

    expect(months.map(m => m.start)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(months.map(m => m.label)).toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026']);
    expect(months[0]!.since.toISOString()).toBe('2026-08-01T07:00:00.000Z');
    expect(months[0]!.until.toISOString()).toBe('2026-09-01T07:00:00.000Z');
    expect(months[2]!.until).toBe(now);
    expect(months.map(m => m.partial)).toEqual([false, false, true]);
  });

  it('crosses the year end', () => {
    expect(lastMonths(3, new Date('2027-01-10T20:00:00Z'), LA).map(m => m.start)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
});
