import { describe, expect, it } from 'vitest';
import { clockLine, dayDistance, dayKey, dayPlus, formatDateTime, instantInZone, isoInZone, isValidTimeZone, resolveTimeZone, sameDay, startOfDay, zoneOffsetMinutes } from './zone';

const LA = 'America/Los_Angeles';
// Thu 2026-09-17 17:30 PDT = Fri 2026-09-18 00:30 UTC — the moment the UTC day had already flipped on Chris.
const DINNER_PT = new Date('2026-09-18T00:30:00Z');
// Friday's briefing: 12:01 UTC = 5:01am PDT.
const BRIEF = new Date('2026-09-18T12:01:36Z');

describe('time zones', () => {
  it('accepts IANA names and rejects junk without throwing', () => {
    expect(isValidTimeZone(LA)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(resolveTimeZone(undefined, 'nope', LA, 'UTC')).toBe(LA);
    expect(resolveTimeZone(null, undefined)).toBe('UTC');
  });

  it('knows that 5:30pm Pacific on Thursday is still Thursday, whatever UTC says', () => {
    expect(dayKey(DINNER_PT, 'UTC')).toBe('2026-09-18');
    expect(dayKey(DINNER_PT, LA)).toBe('2026-09-17');

    const thursdayBrief = new Date('2026-09-17T16:00:39Z');

    expect(sameDay(thursdayBrief, DINNER_PT, LA)).toBe(true);
    expect(sameDay(thursdayBrief, DINNER_PT, 'UTC')).toBe(false);
  });

  it('counts calendar days in the zone, not 24-hour blocks', () => {
    expect(dayDistance(new Date('2026-09-17T16:00:39Z'), DINNER_PT, LA)).toBe(0);
    expect(dayDistance(new Date('2026-09-17T16:00:39Z'), BRIEF, LA)).toBe(1);
    expect(dayDistance(BRIEF, new Date('2026-09-17T16:00:39Z'), LA)).toBe(-1);
  });

  it('finds local midnight, including across a DST change', () => {
    expect(zoneOffsetMinutes(BRIEF, LA)).toBe(-420);
    expect(startOfDay('2026-09-18', LA).toISOString()).toBe('2026-09-18T07:00:00.000Z');
    expect(startOfDay('2026-09-18', 'UTC').toISOString()).toBe('2026-09-18T00:00:00.000Z');
    // 2026-11-01 is the fall-back day in the US: still local midnight, at PDT's offset.
    expect(startOfDay('2026-11-01', LA).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(startOfDay('2026-11-02', LA).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('writes an instant on a zone\'s wall clock with its offset, in half-hour zones and on both sides of a clock change', () => {
    expect(isoInZone(new Date('2026-01-01T12:00:00Z'), 'Asia/Kolkata')).toBe('2026-01-01T17:30:00+05:30');
    expect(isoInZone(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01T01:30:00-04:00');
    expect(isoInZone(new Date('2026-11-01T06:30:00.878Z'), 'America/New_York')).toBe('2026-11-01T01:30:00-05:00');
  });

  it('moves a calendar day across a month and a year', () => {
    expect(dayPlus('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayPlus('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formats a time a person can act on, zone named', () => {
    expect(formatDateTime(BRIEF, LA)).toBe('Fri, Sep 18, 2026, 5:01 AM PDT');
    expect(formatDateTime(BRIEF, 'America/New_York')).toBe('Fri, Sep 18, 2026, 8:01 AM EDT');

    const line = clockLine(BRIEF, LA);

    expect(line).toContain('NOW: Fri, Sep 18, 2026, 5:01 AM PDT (America/Los_Angeles)');
    expect(line).toContain('2026-09-18T12:01:36.000Z UTC');
    expect(line).toContain('Today is Fri, Sep 18, 2026');
  });
});

describe('instantInZone', () => {
  it('reads a wall-clock time in a zone as the instant it names', () => {
    expect(instantInZone('2026-10-01T15:00:00', 'America/New_York').toISOString()).toBe('2026-10-01T19:00:00.000Z');
    expect(instantInZone('2026-11-05T15:00:00', 'America/New_York').toISOString()).toBe('2026-11-05T20:00:00.000Z');
    expect(instantInZone('2026-10-01T15:00:00', 'UTC').toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('answers an invalid date for a time no clock shows, rather than throwing', () => {
    expect(Number.isNaN(instantInZone('2026-13-40T19:30:00', 'America/New_York').getTime())).toBe(true);
    expect(Number.isNaN(instantInZone('2026-02-31T19:30:00', 'America/New_York').getTime())).toBe(true);
    expect(Number.isNaN(instantInZone('2026-10-01T24:00:00', 'America/New_York').getTime())).toBe(true);
    expect(Number.isNaN(instantInZone('0050-01-05T15:00:00', 'America/New_York').getTime())).toBe(true);
  });
});
