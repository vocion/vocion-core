import { describe, expect, it } from 'vitest';
import { cronIntervalMs, humanizeAge, previousFire, previousFires } from './schedule';

const HOUR = 3_600_000;

describe('previousFire', () => {
  it('finds the hourly fire on the hour', () => {
    expect(previousFire('0 * * * *', new Date('2026-09-08T19:42:10Z'))?.toISOString())
      .toBe('2026-09-08T19:00:00.000Z');
  });

  it('treats a fire in the current minute as already past', () => {
    expect(previousFire('0 * * * *', new Date('2026-09-08T19:00:00Z'))?.toISOString())
      .toBe('2026-09-08T19:00:00.000Z');
  });

  it('crosses midnight for a daily schedule', () => {
    expect(previousFire('0 6 * * *', new Date('2026-09-08T05:00:00Z'))?.toISOString())
      .toBe('2026-09-07T06:00:00.000Z');
  });

  it('honours a step field', () => {
    expect(previousFire('*/15 * * * *', new Date('2026-09-08T19:44:00Z'))?.toISOString())
      .toBe('2026-09-08T19:30:00.000Z');
  });

  it('honours a list of hours restricted to weekdays', () => {
    // Saturday 2026-09-05 — the last weekday fire is Friday at 21:00.
    expect(previousFire('0 13,17,21 * * 1-5', new Date('2026-09-05T12:00:00Z'))?.toISOString())
      .toBe('2026-09-04T21:00:00.000Z');
  });

  it('returns null for an expression it cannot parse', () => {
    expect(previousFire('@hourly', new Date('2026-09-08T19:00:00Z'))).toBeNull();
    expect(previousFire('0 0 * *', new Date('2026-09-08T19:00:00Z'))).toBeNull();
    expect(previousFire('0 0 L * *', new Date('2026-09-08T19:00:00Z'))).toBeNull();
  });

  it('matches Sunday whether it is written 0 or 7', () => {
    const sunday = new Date('2026-09-06T12:30:00Z');

    expect(previousFire('0 12 * * 0', sunday)?.toISOString()).toBe('2026-09-06T12:00:00.000Z');
    expect(previousFire('0 12 * * 7', sunday)?.toISOString()).toBe('2026-09-06T12:00:00.000Z');
  });

  it('ORs day-of-month against day-of-week when both are restricted', () => {
    // 2026-09-08 is a Tuesday and the 8th. `0 0 8 * 1` should match the 8th
    // even though it is not a Monday.
    expect(previousFire('0 0 8 * 1', new Date('2026-09-08T00:30:00Z'))?.toISOString())
      .toBe('2026-09-08T00:00:00.000Z');
  });
});

describe('previousFires', () => {
  it('returns the run of fires newest first', () => {
    const fires = previousFires('0 * * * *', new Date('2026-09-08T19:42:00Z'), 3);

    expect(fires.map(f => f.toISOString())).toEqual([
      '2026-09-08T19:00:00.000Z',
      '2026-09-08T18:00:00.000Z',
      '2026-09-08T17:00:00.000Z',
    ]);
  });
});

describe('cronIntervalMs', () => {
  it('reads the cadence off the schedule itself', () => {
    const now = new Date('2026-09-08T19:42:00Z');

    expect(cronIntervalMs('0 * * * *', now)).toBe(HOUR);
    expect(cronIntervalMs('*/15 * * * *', now)).toBe(15 * 60_000);
    expect(cronIntervalMs('0 6 * * *', now)).toBe(24 * HOUR);
  });

  it('is null when the expression is unparseable', () => {
    expect(cronIntervalMs('nonsense', new Date('2026-09-08T19:42:00Z'))).toBeNull();
  });
});

describe('humanizeAge', () => {
  it('scales the unit to the gap', () => {
    expect(humanizeAge(60_000)).toBe('1 minute');
    expect(humanizeAge(45 * 60_000)).toBe('45 minutes');
    expect(humanizeAge(19.3 * HOUR)).toBe('19.3 hours');
    expect(humanizeAge(3 * 24 * HOUR)).toBe('3.0 days');
  });
});
