import { NextResponse } from 'next/server';
import { apiListReviews, WriteApiError } from '@/services/writeApi';
import { jsonError } from '../_shared';

/**
 * GET /api/v1/reviews
 *
 * The unified pending-review queue (skills awaiting approval, paused
 * workflows, missions awaiting review) for the token's org. Authenticated
 * with a tenant API token: `Authorization: Bearer vcn_live_…`.
 * @param req
 */
export async function GET(req: Request) {
  const assignedTo = new URL(req.url).searchParams.get('assignedTo') ?? undefined;
  try {
    return NextResponse.json(await apiListReviews(req.headers.get('authorization'), { assignedTo }));
  } catch (e) {
    if (e instanceof WriteApiError) {
      return jsonError(e.code, e.message, e.status);
    }
    throw e;
  }
}
