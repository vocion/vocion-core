import type { BriefRow } from './PersonalizationQueue';
import { describe, expect, it } from 'vitest';
import { briefedWindowOf, BULK_NONE, describeQueueView, distinctValues, ERROR_CHIP, filterBulkRows, filterQueueRows } from './queueFilter';

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

describe('filterBulkRows', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  const base = { lane: 'ready_for_review', q: '', chips: [] as string[], rung: '', magnet: '', before: '' };
  const rows = [
    row({ id: 1, contactName: 'Ada', utmContent: 'Marketing Industry eBook', recommendedSequence: 'Personalized Nurture · 4 Assertive v2', briefedAt: '2026-09-24T01:00:00.000Z' }),
    row({ id: 2, contactName: 'Bo', utmContent: null, recommendedSequence: 'Personalized Nurture · 1 Ambient v2', briefedAt: '2026-09-23T18:00:00.000Z' }),
    row({ id: 3, contactName: 'Cy', utmContent: 'Marketing Industry eBook', recommendedSequence: null, briefedAt: null }),
  ];

  it('narrows on the recommended sequence, including leads with none', () => {
    expect(filterBulkRows(rows, { ...base, rung: 'Personalized Nurture · 1 Ambient v2' }, now).map(r => r.id)).toEqual([2]);
    expect(filterBulkRows(rows, { ...base, rung: BULK_NONE }, now).map(r => r.id)).toEqual([3]);
  });

  it('narrows on the lead magnet, including leads with none recorded', () => {
    expect(filterBulkRows(rows, { ...base, magnet: 'Marketing Industry eBook' }, now).map(r => r.id)).toEqual([1, 3]);
    expect(filterBulkRows(rows, { ...base, magnet: BULK_NONE }, now).map(r => r.id)).toEqual([2]);
  });

  it('keeps only leads briefed before the moment, and drops unbriefed ones', () => {
    expect(filterBulkRows(rows, { ...base, before: '2026-09-24T00:00:00.000Z' }, now).map(r => r.id)).toEqual([2]);
  });

  it('applies nothing extra when the bulk filters are empty', () => {
    expect(filterBulkRows(rows, base, now).map(r => r.id)).toEqual([1, 2, 3]);
  });
});

describe('distinctValues', () => {
  it('lists each non-empty value once, sorted', () => {
    const rows = [row({ id: 1, contactName: 'A', utmContent: 'b' }), row({ id: 2, contactName: 'B', utmContent: null }), row({ id: 3, contactName: 'C', utmContent: 'a' }), row({ id: 4, contactName: 'D', utmContent: 'b' })];

    expect(distinctValues(rows, r => r.utmContent)).toEqual(['a', 'b']);
  });
});

describe('the error chip', () => {
  const rows = [
    row({ id: 1, contactName: 'Ada', lastError: 'skill turn produced an answer that does not validate' }),
    row({ id: 2, contactName: 'Bo', lastError: null }),
    row({ id: 3, contactName: 'Cy', lastError: 'Cannot find module', briefedAt: new Date(NOW - 30 * DAY).toISOString() }),
  ];

  it('keeps only leads whose last attempt failed', () => {
    expect(filterQueueRows(rows, { lane: 'ready_for_review', q: '', chips: [ERROR_CHIP.key] }, NOW).map(r => r.id)).toEqual([1, 3]);
  });

  it('narrows the briefed windows rather than widening them', () => {
    expect(filterQueueRows(rows, { lane: 'ready_for_review', q: '', chips: ['week', ERROR_CHIP.key] }, NOW).map(r => r.id)).toEqual([1]);
  });

  it('says so in the bulk heading', () => {
    expect(describeQueueView({ lane: 'ready_for_review', q: '', chips: [ERROR_CHIP.key] })).toBe('Review · with an error');
  });
});
