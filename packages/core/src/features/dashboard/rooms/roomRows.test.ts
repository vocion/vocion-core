import type { RoomRow } from './roomRows';
import { describe, expect, it } from 'vitest';
import { lastChangedAt, nextSort, sortRooms } from './roomRows';

const NOW = Date.parse('2026-10-23T18:00:00Z');

const row = (r: Partial<RoomRow> & Pick<RoomRow, 'id' | 'title'>): RoomRow => ({ segments: [], sources: 0, mustRead: 0, updatedAt: '2026-10-01T00:00:00.000Z', stage: 'Active', ...r });

describe('lastChangedAt', () => {
  it('is the newest thing filed or kept in the room, never the status line a sweep rewrote', () => {
    const room = {
      createdAt: new Date('2026-08-01T00:00:00Z'),
      meta: {
        status: 'No new mail as of 7am PT Oct 23',
        statusAt: '2026-10-23T14:00:00Z',
        sources: [
          { title: 'Kickoff call', kind: 'transcript' as const, rating: 3 as const, retrievedAt: '2026-10-02T10:00:00Z' },
          { title: 'Scope email', kind: 'email' as const, rating: 2 as const, retrievedAt: '2026-10-14T09:30:00Z' },
        ],
        highlights: [{ kind: 'quote' as const, text: 'We lose bids on price.', addedAt: '2026-10-11T12:00:00Z' }],
      },
    };

    expect(lastChangedAt(room, NOW)).toBe('2026-10-14T09:30:00.000Z');
  });

  it('counts a deliverable once it is drafted and a milestone once it is done, but nothing planned or still ahead', () => {
    const room = {
      createdAt: new Date('2026-08-01T00:00:00Z'),
      meta: {
        deliverables: [
          { title: 'Proposal deck', status: 'sent' as const, date: '2026-10-20' },
          { title: 'Revised proposal', status: 'planned' as const, date: '2026-10-22' },
        ],
        milestones: [
          { title: 'Pilot live', status: 'done' as const, date: '2026-10-18' },
          { title: 'Review', status: 'done' as const, date: '2026-11-30' },
        ],
      },
    };

    expect(lastChangedAt(room, NOW)).toBe('2026-10-20T00:00:00.000Z');
  });

  it('dates an empty room from when it opened', () => {
    expect(lastChangedAt({ createdAt: new Date('2026-09-05T08:00:00Z'), meta: {} }, NOW)).toBe('2026-09-05T08:00:00.000Z');
  });
});

describe('sortRooms', () => {
  const rows = [
    row({ id: 1, title: 'Wren Logistics', sources: 4, updatedAt: '2026-10-20T00:00:00.000Z', stage: 'Proposal Sent' }),
    row({ id: 2, title: 'acorn Builders', sources: 12, updatedAt: '2026-09-02T00:00:00.000Z', stage: 'Discovery' }),
    row({ id: 3, title: 'Larkfield', sources: 4, updatedAt: '2026-10-22T00:00:00.000Z', stage: 'Discovery' }),
  ];

  it('sorts by title A–Z by default, ignoring case', () => {
    expect(sortRooms(rows, 'title', 'asc').map(r => r.id)).toEqual([2, 3, 1]);
  });

  it('finds the last updated first, and reverses', () => {
    expect(sortRooms(rows, 'updated', 'desc').map(r => r.id)).toEqual([3, 1, 2]);
    expect(sortRooms(rows, 'updated', 'asc').map(r => r.id)).toEqual([2, 1, 3]);
  });

  it('breaks a tie by title, so the order holds still', () => {
    expect(sortRooms(rows, 'sources', 'desc').map(r => r.id)).toEqual([2, 3, 1]);
    expect(sortRooms(rows, 'stage', 'asc').map(r => r.id)).toEqual([2, 3, 1]);
  });
});

describe('nextSort', () => {
  it('reverses the same column and opens another in its own first direction', () => {
    expect(nextSort({ sort: 'title', dir: 'asc' }, 'title')).toEqual({ sort: 'title', dir: 'desc' });
    expect(nextSort({ sort: 'title', dir: 'asc' }, 'updated')).toEqual({ sort: 'updated', dir: 'desc' });
    expect(nextSort({ sort: 'updated', dir: 'desc' }, 'stage')).toEqual({ sort: 'stage', dir: 'asc' });
  });
});
