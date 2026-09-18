import { FolderOpen } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Column, ListEmpty, ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { clerkAuth as auth } from '@/libs/Auth';
import { listDataRooms, roomAnchor, roomHref } from '@/services/DataRoomService';

/**
 * Data rooms — one per client engagement, newest first. Each row is a door to
 * the room; the room is where the documents are written from.
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

  return (
    <ListPage title="Data rooms" description="One room per entity — a deal, a project, an engagement: everything ingested about it and everything written from it, with the rules and notes that keep it growing on its own.">
      {rooms.length === 0
        ? <ListEmpty variant="page" icon={FolderOpen} title="No data rooms yet" description="Ask the agent to open one, or let a deal reaching Proposal stage open its own after the next CRM sync." />
        : (
            <ListRows>
              {rooms.map((r) => {
                const m = r.meta;
                const stars = (m.sources ?? []).filter(s => s.rating === 3).length;
                const anchor = roomAnchor(m);
                return (
                  <ListRow
                    key={r.id}
                    href={roomHref(r.id)}
                    icon={FolderOpen}
                    title={r.title}
                    subline={<Subline segments={[m.client, anchor ? `${anchor.system ? `${anchor.system} ` : ''}${anchor.type}` : null, m.stage, m.status ? `${m.status.slice(0, 90)}${m.status.length > 90 ? '…' : ''}` : null]} />}
                    columns={(
                      <>
                        <Column kind="number">{m.sources?.length ?? 0}</Column>
                        <Column kind="number">{stars}</Column>
                        <Column kind="date">{(m.statusAt ?? r.updatedAt?.toISOString() ?? r.createdAt.toISOString()).slice(0, 10)}</Column>
                      </>
                    )}
                    chip={r.status === 'closed' ? 'Closed' : (m.stage ?? 'Active')}
                  />
                );
              })}
            </ListRows>
          )}
    </ListPage>
  );
}
