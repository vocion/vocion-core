import { NextResponse } from 'next/server';
import { markRead } from '@/services/notifications/notify';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../_shared';
import { personFor } from '../_lib';

/**
 * POST /api/v1/notifications/read  { ids?: number[], all?: true }
 *
 * Mark notifications read — the ones named, or every unread one with
 * `all: true`. Answers how many changed; a notification already read, or
 * not yours, is not counted.
 * Auth: dashboard session, or a tenant token (its minter's notifications).
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const who = await personFor(caller);
  if (isErrorResponse(who)) {
    return who;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  if (body.all === true) {
    return NextResponse.json({ marked: await markRead(who.userId, who.orgId, 'all') });
  }
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every(i => Number.isInteger(i) && (i as number) > 0)) {
    return jsonError('VALIDATION_FAILED', 'send ids: [notification ids] (at most 500), or all: true', 400);
  }
  return NextResponse.json({ marked: await markRead(who.userId, who.orgId, ids as number[]) });
}
