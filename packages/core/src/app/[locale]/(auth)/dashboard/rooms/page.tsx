import type { RoomRow } from '@/features/dashboard/rooms/roomRows';
import { FolderOpen } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListEmpty, ListPage } from '@/components/patterns';
import { PluginPanel } from '@/features/dashboard/plugins/PluginPanel';
import { lastChangedAt } from '@/features/dashboard/rooms/roomRows';
import { RoomsTable } from '@/features/dashboard/rooms/RoomsTable';
import { clerkAuth as auth } from '@/libs/Auth';
import { askInChatHref } from '@/libs/links';
import { listDataRooms, roomAnchor, roomHref } from '@/services/DataRoomService';

/** Now, read once per render: `Date.now()` counts as impure inside a render. */
function readNow(): number {
  return Date.now();
}

/**
 * Data rooms — one per client engagement, as a table: titled columns, sorted
 * by title until the person sorts by another (`RoomsTable`). Each row is a
 * door to the room; the room is where the documents are written from.
 * @param props
 * @param props.params
 */
export default async function DataRoomsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }
  const rooms = await listDataRooms(orgId);
  const now = readNow();
  const rows: RoomRow[] = rooms.map((r) => {
    const m = r.meta;
    const anchor = roomAnchor(m);
    // The stage has its own column now, so the subline drops it.
    return {
      id: r.id,
      title: r.title,
      segments: [m.client ?? null, anchor ? `${anchor.system ? `${anchor.system} ` : ''}${anchor.type}` : null, m.status ? `${m.status.slice(0, 90)}${m.status.length > 90 ? '…' : ''}` : null],
      sources: m.sources?.length ?? 0,
      mustRead: (m.sources ?? []).filter(s => s.rating === 3).length,
      updatedAt: lastChangedAt(r, now),
      stage: r.status === 'closed' ? 'Closed' : (m.stage ?? 'Active'),
    };
  });

  return (
    <ListPage title="Data rooms" description="One room per deal, project or engagement, holding everything known about it.">
      <PluginPanel orgId={orgId} slug="data-rooms" />

      {rooms.length === 0
        ? <ListEmpty variant="page" icon={FolderOpen} title="No data rooms yet" description="A room collects everything about one engagement, and a deal reaching Proposal stage opens its own." action={{ label: 'Ask to open a room', href: askInChatHref('Open a data room for ') }} />
        : <RoomsTable rows={rows} hrefs={Object.fromEntries(rooms.map(r => [r.id, roomHref(r.id)]))} now={now} />}
    </ListPage>
  );
}
