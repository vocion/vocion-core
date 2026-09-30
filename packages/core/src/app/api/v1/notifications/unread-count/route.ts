import { NextResponse } from 'next/server';
import { unreadCount } from '@/services/notifications/inbox';
import { authApi, isErrorResponse } from '../../_shared';
import { personFor } from '../_lib';

/**
 * GET /api/v1/notifications/unread-count
 *
 * How many of your notifications in this workspace are unread — the bell's
 * badge. Cheap enough to poll.
 * Auth: dashboard session, or a tenant token (its minter's count).
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const who = await personFor(caller);
  if (isErrorResponse(who)) {
    return who;
  }
  return NextResponse.json({ unread: await unreadCount(who.userId, who.orgId) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
