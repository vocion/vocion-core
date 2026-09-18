import { describe, expect, it } from 'vitest';
import { clockLine, dayDistance, dayKey, formatDateTime, isValidTimeZone, resolveTimeZone, sameDay, startOfDay, zoneOffsetMinutes } from './zone';

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

  it('formats a time a person can act on, zone named', () => {
    expect(formatDateTime(BRIEF, LA)).toBe('Fri, Sep 18, 2026, 5:01 AM PDT');
    expect(formatDateTime(BRIEF, 'America/New_York')).toBe('Fri, Sep 18, 2026, 8:01 AM EDT');

    const line = clockLine(BRIEF, LA);

    expect(line).toContain('NOW: Fri, Sep 18, 2026, 5:01 AM PDT (America/Los_Angeles)');
    expect(line).toContain('2026-09-18T12:01:36.000Z UTC');
    expect(line).toContain('Today is Fri, Sep 18, 2026');
  });
});
