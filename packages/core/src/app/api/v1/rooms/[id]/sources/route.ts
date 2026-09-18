import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { unfileFromDataRoom } from '@/services/DataRoomService';

/**
 * `DELETE /api/v1/rooms/:id/sources?document=<id>` (or `?artifact=<id>`) —
 * take a source out of a room: the undo of a filing, the collector's
 * included. The document stays in the knowledge base; the room forgets the
 * link and will not auto-file that document again. A dashboard session or a
 * `vcn_live_` token; the caller's org must own the room.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const roomId = Number((await ctx.params).id);
  const url = new URL(req.url);
  const documentId = Number(url.searchParams.get('document') ?? '');
  const artifactId = Number(url.searchParams.get('artifact') ?? '');
  if (!Number.isInteger(roomId) || roomId <= 0 || (!(documentId > 0) && !(artifactId > 0))) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Name the room and a document or artifact' } }, { status: 400 });
  }
  const out = await unfileFromDataRoom(caller.orgId, roomId, {
    ...(documentId > 0 ? { documentId } : {}),
    ...(artifactId > 0 ? { artifactId } : {}),
  });
  if (!out) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No such source on this data room' } }, { status: 404 });
  }
  return NextResponse.json({ removed: out.removed, sources: out.room.meta.sources?.length ?? 0 });
}
