import { NextResponse } from 'next/server';
import { apiListReviews } from '@/services/writeApi';
import { authApi, isErrorResponse, readPagination, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/reviews
 *
 * The unified pending-review queue — paused workflow runs, missions awaiting
 * review, and pending action proposals — for the caller's org.
 *
 * Query parameters:
 * - `kind` — `workflow` | `mission` | `action`, to see one plane only.
 * - `assignedTo` — a user id for that person's queue, or `unassigned` for triage.
 * - `includeSnoozed` — `true` to include items delayed into the future.
 * - `limit`, `offset` — the page window. The response carries the real total.
 *
 * Auth: a tenant API token (`Authorization: Bearer vcn_live_…`) or a
 * signed-in dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  try {
    return NextResponse.json(await apiListReviews(caller, {
      assignedTo: url.searchParams.get('assignedTo') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      includeSnoozed: url.searchParams.get('includeSnoozed') === 'true',
      limit,
      offset,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
