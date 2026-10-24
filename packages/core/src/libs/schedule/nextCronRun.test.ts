import { describe, expect, it } from 'vitest';
import { nextCronRun } from './nextCronRun';

const at = (s: string) => new Date(s);

describe('nextCronRun', () => {
  it('finds the next monthly run', () => {
    expect(nextCronRun('0 17 7 * *', at('2026-10-20T19:00:00Z'))?.toISOString()).toBe('2026-11-07T17:00:00.000Z');
    expect(nextCronRun('0 16 5 * *', at('2026-10-05T15:59:00Z'))?.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  it('reads steps, ranges and weekdays', () => {
    expect(nextCronRun('*/15 * * * *', at('2026-10-20T19:07:30Z'))?.toISOString()).toBe('2026-10-20T19:15:00.000Z');
    // Weekdays at 14:00: Tue Oct 20 after 14:00 → Wed Oct 21.
    expect(nextCronRun('0 14 * * 1-5', at('2026-10-20T15:00:00Z'))?.toISOString()).toBe('2026-10-21T14:00:00.000Z');
    // Sunday as 7.
    expect(nextCronRun('0 9 * * 7', at('2026-10-20T00:00:00Z'))?.toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });

  it('returns null for what it cannot read', () => {
    expect(nextCronRun('@monthly', at('2026-10-20T00:00:00Z'))).toBeNull();
    expect(nextCronRun('61 * * * *', at('2026-10-20T00:00:00Z'))).toBeNull();
  });
});

describe('nextCronRun in a zone', () => {
  it('fires at 6:30am Pacific, whichever side of daylight saving', () => {
    expect(nextCronRun('30 6 * * 1-5', new Date('2026-10-29T20:00:00Z'), 'America/Los_Angeles')?.toISOString()).toBe('2026-10-30T13:30:00.000Z');
    expect(nextCronRun('30 6 * * 1-5', new Date('2026-10-30T20:00:00Z'), 'America/Los_Angeles')?.toISOString()).toBe('2026-11-02T14:30:00.000Z');
  });
});
