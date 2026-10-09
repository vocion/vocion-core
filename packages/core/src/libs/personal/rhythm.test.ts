import { describe, expect, it } from 'vitest';
import { dueAction, isWallClock, nextOccurrence, rhythmDay, STALE_AFTER_MS } from './rhythm';

describe('when a brief or wrap is due', () => {
  it('is the next time the person\'s clock reads that time — today if still ahead, else tomorrow', () => {
    const morning = new Date('2026-10-09T13:00:00Z'); // 06:00 in Los Angeles

    expect(nextOccurrence('07:30', 'America/Los_Angeles', morning).toISOString()).toBe('2026-10-09T14:30:00.000Z');
    expect(nextOccurrence('07:30', 'America/Los_Angeles', new Date('2026-10-09T15:00:00Z')).toISOString()).toBe('2026-10-10T14:30:00.000Z');
  });

  it('keeps 07:30 at 07:30 across a daylight-saving change', () => {
    // US clocks fall back on Sunday 2026-11-01.
    const before = nextOccurrence('07:30', 'America/New_York', new Date('2026-10-31T10:00:00Z'));
    const after = nextOccurrence('07:30', 'America/New_York', before);

    expect(before.toISOString()).toBe('2026-10-31T11:30:00.000Z');
    expect(after.toISOString()).toBe('2026-11-01T12:30:00.000Z');
  });

  it('falls back to UTC for a zone the server does not know', () => {
    expect(nextOccurrence('17:30', 'Not/AZone', new Date('2026-10-09T00:00:00Z')).toISOString()).toBe('2026-10-09T17:30:00.000Z');
  });

  it('delivers on time or a little late, and skips one the server slept through', () => {
    const due = new Date('2026-10-09T14:30:00Z');

    expect(dueAction(due, new Date('2026-10-09T14:00:00Z'))).toBe('wait');
    expect(dueAction(due, new Date('2026-10-09T14:35:00Z'))).toBe('deliver');
    expect(dueAction(due, new Date(due.getTime() + STALE_AFTER_MS + 1))).toBe('skip');
  });

  it('keys a delivery by the person\'s own day, not UTC\'s', () => {
    expect(rhythmDay(new Date('2026-10-10T00:30:00Z'), 'America/Los_Angeles')).toBe('2026-10-09');
  });

  it('accepts HH:MM on a 24-hour clock only', () => {
    expect(isWallClock('07:30')).toBe(true);
    expect(isWallClock('23:59')).toBe(true);
    expect(isWallClock('24:00')).toBe(false);
    expect(isWallClock('7:30')).toBe(false);
  });
});
