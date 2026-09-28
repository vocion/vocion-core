import type { PageRow } from './pages';
import { describe, expect, it } from 'vitest';
import {
  compareRowsByField,
  decodeRowCursor,
  encodeRowCursor,
  pageHrefKeeping,
  paginateRows,
  sortRowsByField,
} from './pages';

// The Runs page (/dashboard/p/runs) merges worker_run rows and mission_run
// rows into one list and declares `sort: {field: createdAt, dir: desc}`. On
// prod (2026-09-28) the top rows were agent runs from four days ago, then
// worker runs from 22 hours ago — Chris: "reverse sort the runs page,
// paginate or load more." The cause: the generic sort compared
// `String(date)` when the field wasn't a plain number, and `Date#toString()`
// starts with the weekday name ("Thu Jan 04 2024 …", "Sun Jan 07 2024 …"),
// so the comparison sorted by day-of-week letters instead of by instant.

function row(id: number, createdAt: Date | null, meta: Record<string, unknown> = {}): PageRow {
  return { id, title: `row ${id}`, status: null, createdAt, meta };
}

describe('compareRowsByField / sortRowsByField', () => {
  it('proves the trap: two dates whose weekday names sort the wrong way round', () => {
    const fourDaysAgo = new Date('2024-01-04T12:00:00Z'); // Thursday — older
    const twentyTwoHoursAgo = new Date('2024-01-07T12:00:00Z'); // Sunday — newer, 3 days later

    // The bug in one line: comparing the stringified dates disagrees with
    // comparing the instants they name.
    expect(String(fourDaysAgo).localeCompare(String(twentyTwoHoursAgo))).toBeGreaterThan(0);
    expect(fourDaysAgo.getTime() - twentyTwoHoursAgo.getTime()).toBeLessThan(0);
  });

  it('orders a Date field by instant, newest first — the exact prod scenario', () => {
    const agentRunFourDaysAgo = row(1, new Date('2024-01-04T12:00:00Z'), { kind: 'agent' });
    const workerRun22hAgo = row(2, new Date('2024-01-07T12:00:00Z'), { kind: 'worker' });

    // Merged the way the runs page merges its two sources, in whichever
    // order the two queries happened to return them.
    const merged = [agentRunFourDaysAgo, workerRun22hAgo];

    expect(sortRowsByField(merged, 'createdAt', 'desc').map(r => r.id)).toEqual([2, 1]);
    expect(sortRowsByField([workerRun22hAgo, agentRunFourDaysAgo], 'createdAt', 'desc').map(r => r.id)).toEqual([2, 1]);
  });

  it('also compares an ISO string field by instant, not lexicographically', () => {
    const a = row(1, null, { at: '2024-01-04T12:00:00Z' });
    const b = row(2, null, { at: '2024-01-07T12:00:00Z' });

    expect(sortRowsByField([a, b], 'meta.at', 'desc').map(r => r.id)).toEqual([2, 1]);
  });

  it('sorts ascending too', () => {
    const older = row(1, new Date('2024-01-01T00:00:00Z'));
    const newer = row(2, new Date('2024-01-02T00:00:00Z'));

    expect(sortRowsByField([newer, older], 'createdAt', 'asc').map(r => r.id)).toEqual([1, 2]);
  });

  it('sends a row missing the field to the end regardless of direction', () => {
    const withDate = row(1, new Date('2024-01-01T00:00:00Z'));
    const withoutDate = row(2, null);

    expect(sortRowsByField([withoutDate, withDate], 'createdAt', 'desc').map(r => r.id)).toEqual([1, 2]);
    expect(sortRowsByField([withoutDate, withDate], 'createdAt', 'asc').map(r => r.id)).toEqual([1, 2]);
  });

  it('breaks a tie on id, so the order is fixed rather than whatever Array#sort leaves it', () => {
    const same = new Date('2024-01-01T00:00:00Z');
    const a = row(5, same);
    const b = row(9, same);

    const first = sortRowsByField([a, b], 'createdAt', 'desc').map(r => r.id);
    const second = sortRowsByField([b, a], 'createdAt', 'desc').map(r => r.id);

    expect(first).toEqual(second);
  });

  it('is the same comparator compareRowsByField exposes directly', () => {
    const a = row(1, new Date('2024-01-01T00:00:00Z'));
    const b = row(2, new Date('2024-01-02T00:00:00Z'));

    expect(compareRowsByField(a, b, 'createdAt', 'desc')).toBeGreaterThan(0);
    expect(compareRowsByField(b, a, 'createdAt', 'desc')).toBeLessThan(0);
  });
});

describe('row cursors', () => {
  it('round-trips a Date field by instant', () => {
    const r = row(42, new Date('2024-01-04T12:00:00Z'));
    const encoded = encodeRowCursor(r, 'createdAt');

    expect(decodeRowCursor(encoded)).toEqual({ value: String(r.createdAt!.getTime()), id: '42' });
  });

  it('round-trips a plain meta field', () => {
    const r = row(7, null, { headline: 'built the thing' });
    const encoded = encodeRowCursor(r, 'meta.headline');

    expect(decodeRowCursor(encoded)).toEqual({ value: 'built the thing', id: '7' });
  });

  it('treats a missing or malformed cursor as no cursor, never an error', () => {
    expect(decodeRowCursor(undefined)).toBeNull();
    expect(decodeRowCursor(null)).toBeNull();
    expect(decodeRowCursor('')).toBeNull();
    expect(decodeRowCursor('no-colon-here')).toBeNull();
  });
});

describe('paginateRows', () => {
  const rows: PageRow[] = Array.from({ length: 120 }, (_, i) =>
    // Newest first, one per hour: row 0 is the newest.
    row(120 - i, new Date(Date.UTC(2024, 0, 10, 0, 0, 0) - i * 3_600_000)));

  it('pages through the whole set with no duplicates and no gaps', () => {
    const seen: PageRow['id'][] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 10; guard++) {
      const { page, nextCursor } = paginateRows(rows, 'createdAt', cursor, 50);

      seen.push(...page.map(r => r.id));
      if (!nextCursor) {
        break;
      }
      cursor = nextCursor;
    }

    expect(seen).toEqual(rows.map(r => r.id));
    expect(new Set(seen).size).toBe(rows.length);
  });

  it('sizes each page and reports when more remain', () => {
    const first = paginateRows(rows, 'createdAt', undefined, 50);

    expect(first.page).toHaveLength(50);
    expect(first.page.map(r => r.id)).toEqual(rows.slice(0, 50).map(r => r.id));
    expect(first.nextCursor).not.toBeNull();

    const second = paginateRows(rows, 'createdAt', first.nextCursor, 50);

    expect(second.page.map(r => r.id)).toEqual(rows.slice(50, 100).map(r => r.id));

    const third = paginateRows(rows, 'createdAt', second.nextCursor, 50);

    expect(third.page).toHaveLength(20);
    expect(third.nextCursor).toBeNull();
  });

  it('respects a filter applied before pagination — paging the narrowed set, not the whole one', () => {
    const mixed: PageRow[] = [
      row(1, new Date('2024-01-05T00:00:00Z'), { kind: 'worker' }),
      row(2, new Date('2024-01-04T00:00:00Z'), { kind: 'agent' }),
      row(3, new Date('2024-01-03T00:00:00Z'), { kind: 'worker' }),
      row(4, new Date('2024-01-02T00:00:00Z'), { kind: 'agent' }),
      row(5, new Date('2024-01-01T00:00:00Z'), { kind: 'worker' }),
    ];
    const workersOnly = sortRowsByField(mixed.filter(r => r.meta.kind === 'worker'), 'createdAt', 'desc');

    const { page, nextCursor } = paginateRows(workersOnly, 'createdAt', undefined, 2);

    expect(page.map(r => r.id)).toEqual([1, 3]);
    expect(nextCursor).not.toBeNull();

    const { page: page2, nextCursor: nextCursor2 } = paginateRows(workersOnly, 'createdAt', nextCursor, 2);

    expect(page2.map(r => r.id)).toEqual([5]);
    expect(nextCursor2).toBeNull();
  });

  it('a cursor naming a row no longer present serves nothing further, never a repeat', () => {
    const decoyCursor = encodeRowCursor(row(999, new Date('2099-01-01T00:00:00Z')), 'createdAt');

    const { page, nextCursor } = paginateRows(rows, 'createdAt', decoyCursor, 50);

    expect(page).toEqual([]);
    expect(nextCursor).toBeNull();
  });
});

describe('pageHrefKeeping — the Load more control’s link', () => {
  it('adds the cursor while keeping the view, a query filter and the window', () => {
    const href = pageHrefKeeping('runs', { view: 'engineering', agent: 'task-engineer', days: '30' }, { cursor: '123:45' });

    const params = new URLSearchParams(href.split('?')[1]);

    expect(href.startsWith('/dashboard/p/runs?')).toBe(true);
    expect(params.get('view')).toBe('engineering');
    expect(params.get('agent')).toBe('task-engineer');
    expect(params.get('days')).toBe('30');
    expect(params.get('cursor')).toBe('123:45');
  });

  it('drops a key patched to null, and renders no query string with nothing left', () => {
    expect(pageHrefKeeping('runs', { cursor: 'abc:1' }, { cursor: null })).toBe('/dashboard/p/runs');
  });

  it('ignores an array-valued search param rather than throwing', () => {
    const href = pageHrefKeeping('runs', { agent: ['a', 'b'] }, { cursor: '1:2' });

    expect(href).toBe('/dashboard/p/runs?cursor=1%3A2');
  });
});
