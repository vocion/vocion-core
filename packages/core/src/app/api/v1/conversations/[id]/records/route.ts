import { NextResponse } from 'next/server';
import { conversationRecords } from '@/services/chat/turnRecords';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

/**
 * GET /api/v1/conversations/[id]/records
 *
 * The records this conversation is about, newest first, at most three: every
 * record its own actions filed, then those its latest turn read or wrote by
 * id. Each carries its page and whether it has a live status to read
 * (`GET /api/v1/objects/:id/status`). The chat draws one microcard per
 * record under the latest turn, and it survives a reload because it is read
 * from the records, not from the turn's events.
 * @param req - The request.
 * @param ctx - Route params.
 * @param ctx.params - `{ id }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'conversation id');
  if (isErrorResponse(id)) {
    return id;
  }
  const records = await conversationRecords(caller.orgId, id);
  if (!records) {
    return jsonError('NOT_FOUND', 'conversation not found', 404);
  }
  return NextResponse.json({ records });
}
