import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { exportDataRoom, getDataRoom } from '@/services/DataRoomService';

/**
 * `GET /api/v1/rooms/:id/export` — the whole data room as one markdown file:
 * the "download context for an LLM" bundle. Same text `read_data_room` hands
 * the agent, so what a person pastes into a chat is what the agent wrote from.
 * A dashboard session or a `vcn_live_` token; the caller's org must own the room.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const { id } = await ctx.params;
  const roomId = Number(id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Data room not found' } }, { status: 404 });
  }
  const room = await getDataRoom(caller.orgId, roomId);
  const md = room ? await exportDataRoom(caller.orgId, roomId) : null;
  if (!room || md === null) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Data room not found' } }, { status: 404 });
  }
  const filename = `${room.title.replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'data-room'} - context.md`;
  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
