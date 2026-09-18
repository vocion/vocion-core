import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authApi } from '@/app/api/v1/_shared';
import { getDataRoom, updateDataRoom } from '@/services/DataRoomService';

/**
 * `GET /api/v1/rooms/:id` — the room as JSON (title, status, meta).
 * `PATCH /api/v1/rooms/:id` — a person editing the room's own knowledge from
 * its page: the notes (the wiki), the rules, whether the collector may file
 * into it. Everything else changes through the agent's `update_data_room`,
 * so the page stays one obvious path per field. A dashboard session or a
 * `vcn_live_` token; the caller's org must own the room.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const roomId = Number((await ctx.params).id);
  const room = Number.isInteger(roomId) && roomId > 0 ? await getDataRoom(caller.orgId, roomId) : null;
  if (!room) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Data room not found' } }, { status: 404 });
  }
  return NextResponse.json(room);
}

const PatchSchema = z.object({
  notes: z.string().max(60_000).optional(),
  rules: z.array(z.string().max(300)).max(60).optional(),
  autoFile: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const roomId = Number((await ctx.params).id);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Data room not found' } }, { status: 404 });
  }
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.issues.map(i => i.message).join('; ') } }, { status: 400 });
  }
  const current = await getDataRoom(caller.orgId, roomId);
  if (!current) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Data room not found' } }, { status: 404 });
  }
  const { notes, rules, autoFile } = parsed.data;
  const room = await updateDataRoom(caller.orgId, roomId, {
    ...(notes === undefined ? {} : { notes }),
    // Rules are replaced as a whole from the page: the textarea is the list.
    ...(rules === undefined ? {} : { removeRules: current.meta.rules ?? [], addRules: rules }),
    ...(autoFile === undefined ? {} : { autoFile }),
  });
  return NextResponse.json(room);
}
