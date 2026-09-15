import { NextResponse } from 'next/server';
import { apiListReviews, apiListReviewTypes } from '@/services/writeApi';
import { authApi, isErrorResponse, readPagination, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/reviews
 *
 * The unified pending-review queue — paused workflow runs, missions awaiting
 * review, and pending action proposals — for the caller's org.
 *
 * Query parameters:
 * - `kind` — `workflow` | `mission` | `action`, to see one plane only.
 * - `actionIds` — comma-separated registered action ids, to see one CARD TYPE
 *   (`personalization.enroll`) rather than one plane. `total` narrows with it.
 *   Pass `types=1` instead to get the types present with their counts.
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
  const actionIds = url.searchParams.get('actionIds');
  try {
    if (url.searchParams.get('types') === '1') {
      return NextResponse.json({ types: await apiListReviewTypes(caller) });
    }
    return NextResponse.json(await apiListReviews(caller, {
      assignedTo: url.searchParams.get('assignedTo') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      actionIds: actionIds === null ? undefined : actionIds.split(',').map(s => s.trim()).filter(Boolean),
      includeSnoozed: url.searchParams.get('includeSnoozed') === 'true',
      limit,
      offset,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
