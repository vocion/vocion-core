import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/rooms/<id> → /dashboard/projects/<id> (308), for links written
 * before projects were renamed from data rooms (2026-10-27).
 * @param props
 * @param props.params
 */
export default async function RoomRedirect(props: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await props.params;
  permanentRedirect(`/dashboard/projects/${encodeURIComponent(id)}`);
}
