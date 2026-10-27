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
import { listDataRooms, projectHref, roomAnchor } from '@/services/DataRoomService';

/** Now, read once per render: `Date.now()` counts as impure inside a render. */
function readNow(): number {
  return Date.now();
}

/**
 * Projects — one per client or engagement, as a table: titled columns, sorted
 * by title until the person sorts by another (`RoomsTable`). Each row is a
 * door to the project; the project is where the work is written from. A core
 * workspace page: in every workspace and every app's sidebar.
 * @param props
 * @param props.params
 */
export default async function ProjectsPage(props: { params: Promise<{ locale: string }> }) {
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
    <ListPage title="Projects" description="One project per client or engagement, holding everything known about it and everything written from it.">
      <PluginPanel orgId={orgId} slug="data-rooms" />

      {rooms.length === 0
        ? <ListEmpty variant="page" icon={FolderOpen} title="No projects yet" description="A project collects everything about one client or engagement: its instructions, brand, wiki, sources and the work written from it." action={{ label: 'Ask to open a project', href: askInChatHref('Open a project for ') }} />
        : <RoomsTable rows={rows} hrefs={Object.fromEntries(rooms.map(r => [r.id, projectHref(r.id)]))} now={now} />}
    </ListPage>
  );
}
