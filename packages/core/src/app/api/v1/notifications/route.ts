import { NextResponse } from 'next/server';
import { listNotifications } from '@/services/notifications/inbox';
import { authApi, isErrorResponse, jsonError } from '../_shared';
import { personFor } from './_lib';

/**
 * GET /api/v1/notifications?unread=1&limit=&before=
 *
 * Your notifications in this workspace, newest first — what the bell and the
 * notifications page read. Each carries its kind (and the kind's label), the
 * title and body, the link it opens, the record it is about, whether it is
 * read, and every channel's delivery state (`sent`, `pending` with the retry
 * reason, `failed` with why, `skipped` with why). `unread` is the unread
 * total; `nextBefore` pages further back.
 * Auth: dashboard session, or a tenant token (its minter's notifications).
 *
 * Query parameters:
 * - `unread` — `1` for unread only.
 * - `limit` — page size, 1–100 (default 30).
 * - `before` — only notifications older than this id (from `nextBefore`).
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
  const url = new URL(req.url);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const beforeRaw = url.searchParams.get('before');
  if (beforeRaw !== null && !/^\d+$/.test(beforeRaw)) {
    return jsonError('VALIDATION_FAILED', 'before must be a notification id', 400);
  }
  const page = await listNotifications(who.userId, who.orgId, {
    limit: Number.isFinite(limit) ? limit : undefined,
    before: beforeRaw ? Number(beforeRaw) : undefined,
    unread: url.searchParams.get('unread') === '1' || url.searchParams.get('unread') === 'true',
  });
  return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
}
