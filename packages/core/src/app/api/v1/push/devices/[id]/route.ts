import { NextResponse } from 'next/server';
import { removeDevice } from '@/services/notifications/devices';
import { NO_PERSON, personOf } from '@/services/notifications/person';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

/**
 * DELETE /api/v1/push/devices/:id
 *
 * Remove one of your devices; it gets no more push. Another person's device
 * is a 404.
 * Auth: dashboard session, or a tenant token (its minter's devices).
 * @param req - Request.
 * @param ctx - Route context.
 * @param ctx.params - `{ id }`.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const userId = await personOf(caller);
  if (!userId) {
    return jsonError('FORBIDDEN', NO_PERSON, 403);
  }
  const who = { orgId: caller.orgId, userId };
  const id = readIdParam((await ctx.params).id, 'device');
  if (isErrorResponse(id)) {
    return id;
  }
  if (!(await removeDevice(who.userId, id))) {
    return jsonError('NOT_FOUND', 'No such device', 404);
  }
  return NextResponse.json({ removed: true });
}
