import { NextResponse } from 'next/server';
import { apiDecideReview, WriteApiError } from '@/services/writeApi';
import { jsonError } from '../../_shared';

/**
 * POST /api/v1/reviews/decide
 *
 * Approve or reject a queued item. Body: `{ kind, id, action, reason? }`
 * where kind ∈ skill|workflow|mission and action ∈ approve|reject. Runs the
 * token principal through authz before dispatching, and returns the refreshed
 * queue. Authenticated with `Authorization: Bearer vcn_live_…`.
 * @param req
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('VALIDATION_FAILED', 'Request body must be JSON', 400);
  }

  try {
    const out = await apiDecideReview(req.headers.get('authorization'), {
      kind: body.kind as 'skill' | 'workflow' | 'mission',
      id: Number(body.id),
      action: body.action as 'approve' | 'reject',
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof WriteApiError) {
      return jsonError(e.code, e.message, e.status);
    }
    throw e;
  }
}
