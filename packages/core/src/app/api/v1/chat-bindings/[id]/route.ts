import { NextResponse } from 'next/server';
import { deleteBinding } from '@/services/ChatSurfaceService';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../_shared';

/**
 * DELETE /api/v1/chat-bindings/:id — unbind a channel. Auth: tenant API token or dashboard session.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await context.params).id, 'Binding id');
  if (isErrorResponse(id)) {
    return id;
  }
  const removed = await deleteBinding(caller.orgId, id);
  return removed ? NextResponse.json({ ok: true }) : jsonError('NOT_FOUND', `No binding ${id}`, 404);
}
