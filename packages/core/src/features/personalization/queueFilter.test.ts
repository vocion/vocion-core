import type { BriefRow } from './PersonalizationQueue';
import { describe, expect, it } from 'vitest';
import { briefedWindowOf, describeQueueView, filterQueueRows } from './queueFilter';

const DAY = 24 * 3_600_000;
const NOW = Date.parse('2026-09-23T12:00:00.000Z');

function row(over: Partial<BriefRow> & Pick<BriefRow, 'id' | 'contactName'>): BriefRow {
  return {
    contactRef: `contacts:${over.id}`,
    contactTitle: null,
    companyName: 'Civic Grid',
    entranceSource: null,
    utmCampaign: null,
    engagementSent: 0,
    engagementOpened: 0,
    status: 'ready_for_review',
    confidence: 0.8,
    mqlAt: null,
    arrivedAt: null,
    briefedAt: new Date(NOW - 2 * DAY).toISOString(),
    ...over,
  };
}

describe('briefedWindowOf', () => {
  it('buckets by age: under a day is today, under a week is this week, the rest earlier, none for no time', () => {
    expect(briefedWindowOf(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe('today');
    expect(briefedWindowOf(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe('week');
    expect(briefedWindowOf(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe('earlier');
    expect(briefedWindowOf(null, NOW)).toBeNull();
    expect(briefedWindowOf('not a date', NOW)).toBeNull();
  });
});

describe('filterQueueRows', () => {
  const rows = [
    row({ id: 1, contactName: 'Ada Review Today', briefedAt: new Date(NOW - 3_600_000).toISOString() }),
    row({ id: 2, contactName: 'Bo Review Earlier', briefedAt: new Date(NOW - 20 * DAY).toISOString() }),
    row({ id: 3, contactName: 'Cy Handed Off', status: 'handed_off', briefedAt: new Date(NOW - 20 * DAY).toISOString() }),
    row({ id: 4, contactName: 'Di Queued', status: 'queued' }),
    row({ id: 5, contactName: 'Ed No Brief Time', briefedAt: null }),
  ];

  it('applies the lane, never shows an unbriefed lead, and the default view is Review', () => {
    expect(filterQueueRows(rows, { lane: 'ready_for_review', q: '', chips: [] }, NOW).map(r => r.id)).toEqual([1, 2, 5]);
    expect(filterQueueRows(rows, { lane: 'all', q: '', chips: [] }, NOW).map(r => r.id)).toEqual([1, 2, 3, 5]);
  });

  it('narrows by the briefed windows, and a lead with no brief time matches no window', () => {
    expect(filterQueueRows(rows, { lane: 'ready_for_review', q: '', chips: ['earlier'] }, NOW).map(r => r.id)).toEqual([2]);
    expect(filterQueueRows(rows, { lane: 'all', q: '', chips: ['earlier'] }, NOW).map(r => r.id)).toEqual([2, 3]);
    expect(filterQueueRows(rows, { lane: 'ready_for_review', q: '', chips: ['today', 'earlier'] }, NOW).map(r => r.id)).toEqual([1, 2]);
  });

  it('searches lead and company, case-insensitively', () => {
    expect(filterQueueRows(rows, { lane: 'all', q: 'handed', chips: [] }, NOW).map(r => r.id)).toEqual([3]);
    expect(filterQueueRows(rows, { lane: 'all', q: 'CIVIC', chips: [] }, NOW)).toHaveLength(4);
  });
});

describe('describeQueueView', () => {
  it('reads the view back in words', () => {
    expect(describeQueueView({ lane: 'ready_for_review', q: '', chips: [] })).toBe('Review');
    expect(describeQueueView({ lane: 'ready_for_review', q: 'acme', chips: ['earlier', 'week'] })).toBe('Review · briefed this week or briefed earlier · matching “acme”');
  });
});
