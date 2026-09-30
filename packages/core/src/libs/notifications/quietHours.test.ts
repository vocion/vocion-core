import { describe, expect, it } from 'vitest';
import { quietUntil, validQuietHours } from './quietHours';

const LA = 'America/Los_Angeles';

describe('quietUntil', () => {
  it('is null outside quiet hours and for none at all', () => {
    // 2026-09-30 12:00 in Los Angeles (PDT, UTC-7).
    expect(quietUntil(new Date('2026-09-30T19:00:00Z'), { start: '22:00', end: '07:00', timeZone: LA })).toBeNull();
    expect(quietUntil(new Date('2026-09-30T19:00:00Z'), null)).toBeNull();
  });

  it('ends tomorrow morning when it is late evening on the person\'s clock', () => {
    // 23:30 PDT on Sep 30 → quiet until 07:00 PDT Oct 1 = 14:00Z.
    expect(quietUntil(new Date('2026-10-01T06:30:00Z'), { start: '22:00', end: '07:00', timeZone: LA })?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('ends this morning when it is after midnight', () => {
    // 03:00 PDT Oct 1 → 07:00 PDT Oct 1.
    expect(quietUntil(new Date('2026-10-01T10:00:00Z'), { start: '22:00', end: '07:00', timeZone: LA })?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('handles a window within one day', () => {
    // 13:00 UTC inside 12:00–14:00 UTC.
    expect(quietUntil(new Date('2026-09-30T13:00:00Z'), { start: '12:00', end: '14:00', timeZone: 'UTC' })?.toISOString()).toBe('2026-09-30T14:00:00.000Z');
    expect(quietUntil(new Date('2026-09-30T14:00:00Z'), { start: '12:00', end: '14:00', timeZone: 'UTC' })).toBeNull();
  });

  it('treats a malformed setting as no quiet hours, never a wall', () => {
    expect(validQuietHours({ start: '25:00', end: '07:00', timeZone: LA })).toBe(false);
    expect(validQuietHours({ start: '07:00', end: '07:00', timeZone: LA })).toBe(false);
    expect(validQuietHours({ start: '22:00', end: '07:00', timeZone: 'Mars/Olympus' })).toBe(false);
    expect(quietUntil(new Date(), { start: 'x', end: 'y', timeZone: LA })).toBeNull();
  });
});
