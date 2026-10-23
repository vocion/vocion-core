'use client';

import type { RoomRow, RoomSort } from './roomRows';
import { FolderOpen } from 'lucide-react';
import { useMemo } from 'react';
import { Column, ListHeader, ListRow, ListRows, Subline, useListUrlState } from '@/components/patterns';
import { relativeLabel } from '@/libs/timeAgo';
import { nextSort, ROOM_SORTS, sortRooms } from './roomRows';

const LIST = {
  defaults: { tab: '', q: '', sort: 'title', dir: 'asc' as const, chips: [] },
  sorts: ROOM_SORTS,
};

// On a phone the kept columns get a fixed width too, so the header and every
// row still line up (a kept column is otherwise as wide as its own text).
const DATE_PHONE = 'max-sm:w-16';
const STAGE_PHONE = 'max-sm:w-20';

const COLUMNS = [
  { key: 'sources', label: 'Sources', kind: 'number' as const },
  { key: 'mustRead', label: 'Must-read', kind: 'number' as const },
  { key: 'updated', label: 'Last updated', kind: 'date' as const, always: true, className: DATE_PHONE },
  { key: 'stage', label: 'Stage', kind: 'status' as const, align: 'left' as const, always: true, className: STAGE_PHONE },
];

/**
 * The Data rooms as a table: titled columns on one grid, sorted by title until
 * the person clicks another title, and the sort kept in the address.
 * @param props - The table.
 * @param props.rows - The rooms, built on the server.
 * @param props.hrefs - Where each room opens, by id.
 * @param props.now - The server's clock, so "2h ago" reads the same on both sides.
 */
export function RoomsTable(props: { rows: RoomRow[]; hrefs: Record<number, string>; now: number }) {
  const [list, setList] = useListUrlState(LIST);
  const sort = list.sort as RoomSort;
  const rows = useMemo(() => sortRooms(props.rows, sort, list.dir), [props.rows, sort, list.dir]);
  return (
    <div data-testid="rooms-table">
      <ListHeader
        label="Data rooms"
        title={{ key: 'title', label: 'Room' }}
        columns={COLUMNS}
        sort={sort}
        dir={list.dir}
        onSort={key => setList(nextSort({ sort, dir: list.dir }, key as RoomSort))}
        icon
        chevron
      />
      <ListRows>
        {rows.map(r => (
          <ListRow
            key={r.id}
            href={props.hrefs[r.id]}
            icon={FolderOpen}
            title={r.title}
            subline={<Subline segments={r.segments} />}
            columns={(
              <>
                <Column kind="number">{r.sources}</Column>
                <Column kind="number">{r.mustRead}</Column>
                <Column kind="date" always className={DATE_PHONE}>
                  <time dateTime={r.updatedAt} suppressHydrationWarning title={new Date(r.updatedAt).toLocaleString()}>{relativeLabel(new Date(r.updatedAt), props.now)}</time>
                </Column>
                <Column kind="status" align="left" always className={`${STAGE_PHONE} text-foreground`}>{r.stage}</Column>
              </>
            )}
          />
        ))}
      </ListRows>
    </div>
  );
}
