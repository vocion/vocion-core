import type { DataRoom } from '@/services/DataRoomService';

/**
 * The Data rooms list as a table a person sorts (Chris, 2026-10-23: "align
 * columns, sort by title first, show last updated date. give titles to
 * columns and allow sorting. like i want to find last updated"). Pure: the
 * page builds the rows on the server, the table sorts them in the browser.
 */

export const ROOM_SORTS = ['title', 'sources', 'mustRead', 'updated', 'stage'] as const;
export type RoomSort = typeof ROOM_SORTS[number];

/** The direction a column opens in on its first click: names A–Z, counts and dates biggest and newest first. */
export const FIRST_DIRECTION: Record<RoomSort, 'asc' | 'desc'> = { title: 'asc', stage: 'asc', sources: 'desc', mustRead: 'desc', updated: 'desc' };

export type RoomRow = {
  id: number;
  title: string;
  /** The subline's segments: client › anchor › status. */
  segments: Array<string | null>;
  /** Sources filed in the room. */
  sources: number;
  /** Of those, the ones rated ⭐⭐⭐ ("read this before writing anything"). */
  mustRead: number;
  /** When something in the room last changed (`lastChangedAt`), ISO. */
  updatedAt: string;
  stage: string;
};

/**
 * When something in the room last changed: the newest source filed, highlight
 * kept, or deliverable or milestone dated (no later than now).
 *
 * Neither the room's status line nor the row's `updated_at` says it. An agent
 * rewrites the status on a sweep even when nothing is new ("No new mail as of
 * 7am PT"), so `statusAt` was the same day on every room; and any
 * write to the room's metadata (a brand fetch, a re-anchor) moves
 * `updated_at`. A room with nothing in it yet dates from when it opened.
 * @param room - The room.
 * @param now - The clock: a planned date in the future is not a change.
 * @returns ISO timestamp.
 */
export function lastChangedAt(room: Pick<DataRoom, 'meta' | 'createdAt'>, now: number): string {
  const m = room.meta;
  const stamps = [
    ...(m.sources ?? []).map(s => s.retrievedAt),
    ...(m.highlights ?? []).map(h => h.addedAt),
    ...(m.deliverables ?? []).filter(d => d.status && d.status !== 'planned').map(d => d.date),
    ...(m.milestones ?? []).filter(x => x.status === 'done').map(x => x.date),
  ]
    .map(s => (s ? Date.parse(s) : Number.NaN))
    .filter(t => Number.isFinite(t) && t <= now);
  const newest = stamps.length > 0 ? Math.max(...stamps) : room.createdAt.getTime();
  return new Date(newest).toISOString();
}

/**
 * Sorts the rows: by the chosen column, ties by title A–Z so the order is stable.
 * @param rows - The rows.
 * @param sort - The column.
 * @param dir - Its direction.
 */
export function sortRooms(rows: readonly RoomRow[], sort: RoomSort, dir: 'asc' | 'desc'): RoomRow[] {
  const byTitle = (a: RoomRow, b: RoomRow) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  const key = (a: RoomRow, b: RoomRow): number => {
    switch (sort) {
      case 'sources':
        return a.sources - b.sources;
      case 'mustRead':
        return a.mustRead - b.mustRead;
      case 'updated':
        return a.updatedAt.localeCompare(b.updatedAt);
      case 'stage':
        return a.stage.localeCompare(b.stage, undefined, { sensitivity: 'base' });
      default:
        return byTitle(a, b);
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * key(a, b) || byTitle(a, b));
}

/**
 * The next sort after a click on a column title: the same column reverses,
 * another one opens in its first direction.
 * @param current - The sort now.
 * @param current.sort - Its column.
 * @param current.dir - Its direction.
 * @param clicked - The column clicked.
 */
export function nextSort(current: { sort: RoomSort; dir: 'asc' | 'desc' }, clicked: RoomSort): { sort: RoomSort; dir: 'asc' | 'desc' } {
  if (current.sort === clicked) {
    return { sort: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { sort: clicked, dir: FIRST_DIRECTION[clicked] };
}
