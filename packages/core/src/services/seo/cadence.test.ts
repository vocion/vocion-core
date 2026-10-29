import type { SeoPageStatus } from './records';
import { describe, expect, it } from 'vitest';
import { cadencePlanRefusal, cadenceStanding } from './cadence';

/**
 * Pages a month, kept pace with week by week (`cadence.ts`). Pure: the
 * project's pages and the clock are handed in. Fictional Northwind pages.
 */

const ZONE = 'America/Chicago';
const page = (status: SeoPageStatus, createdAt: string) => ({ meta: { status } as never, createdAt: new Date(createdAt) });

describe('cadenceStanding', () => {
  it('owes the month its share by the end of the coming week, rounding up', () => {
    // Thursday 1 October 2026, 9am in Chicago: 7 of 31 days, 8 a month → 2.
    const first = cadenceStanding({ cadence: { pagesPerMonth: 8 }, pages: [], now: new Date('2026-10-01T14:00:00Z'), timeZone: ZONE })!;

    expect(first).toMatchObject({ month: '2026-10', due: 2, counted: 0, propose: 2 });

    // Late in the month the whole cadence is due.
    expect(cadenceStanding({ cadence: { pagesPerMonth: 8 }, pages: [], now: new Date('2026-10-29T14:00:00Z'), timeZone: ZONE })!.due).toBe(8);
  });

  it('counts pages planned this month and earlier ones still in flight, never rejected or finished ones from before', () => {
    const pages = [
      page('proposed', '2026-10-05T15:00:00Z'), // this month
      page('published', '2026-10-06T15:00:00Z'), // this month, already live: still counts
      page('drafting', '2026-09-20T15:00:00Z'), // last month, still in flight
      page('approved', '2026-09-10T15:00:00Z'), // last month, finished
      page('rejected', '2026-10-07T15:00:00Z'), // turned down
    ];
    const standing = cadenceStanding({ cadence: { pagesPerMonth: 8, focus: 'water heaters' }, pages, now: new Date('2026-10-08T14:00:00Z'), timeZone: ZONE })!;

    expect(standing).toMatchObject({ counted: 3, due: 4, propose: 1, focus: 'water heaters' });
  });

  it('reads the month in the workspace\'s zone', () => {
    // 1 November 03:00 UTC is still 31 October in Chicago.
    const standing = cadenceStanding({ cadence: { pagesPerMonth: 4 }, pages: [page('proposed', '2026-10-10T15:00:00Z')], now: new Date('2026-11-01T03:00:00Z'), timeZone: ZONE })!;

    expect(standing.month).toBe('2026-10');
    expect(standing.counted).toBe(1);
  });

  it('is on pace when the month already has what is due: nothing to propose', () => {
    const pages = [page('proposed', '2026-10-01T15:00:00Z'), page('briefed', '2026-10-01T15:00:00Z')];
    const standing = cadenceStanding({ cadence: { pagesPerMonth: 8 }, pages, now: new Date('2026-10-01T14:00:00Z'), timeZone: ZONE })!;

    expect(standing.propose).toBe(0);
    expect(standing.line).toContain('on pace');
  });

  it('is nothing at all for a project with no cadence', () => {
    expect(cadenceStanding({ cadence: null, pages: [], now: new Date(), timeZone: ZONE })).toBeNull();
    expect(cadenceStanding({ cadence: { pagesPerMonth: 0 }, pages: [], now: new Date(), timeZone: ZONE })).toBeNull();
  });
});

describe('cadencePlanRefusal', () => {
  const behind = cadenceStanding({ cadence: { pagesPerMonth: 8 }, pages: [], now: new Date('2026-10-01T14:00:00Z'), timeZone: ZONE });
  const onPace = cadenceStanding({ cadence: { pagesPerMonth: 8 }, pages: [page('proposed', '2026-10-01T15:00:00Z'), page('proposed', '2026-10-01T15:00:00Z')], now: new Date('2026-10-01T14:00:00Z'), timeZone: ZONE });

  it('lets a plan of up to what the project is short through', () => {
    expect(cadencePlanRefusal(behind, 2)).toBeNull();
    expect(cadencePlanRefusal(behind, 1)).toBeNull();
  });

  it('refuses a project with no cadence, one on pace, and a plan past what it is short', () => {
    expect(cadencePlanRefusal(null, 1)).toContain('no SEO cadence');
    expect(cadencePlanRefusal(onPace, 1)).toContain('on pace');
    expect(cadencePlanRefusal(behind, 3)).toContain('room for 2 pages');
  });
});
