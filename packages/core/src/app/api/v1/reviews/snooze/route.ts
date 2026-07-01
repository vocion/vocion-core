import { NextResponse } from 'next/server';
import { apiSnoozeReview, WriteApiError } from '@/services/writeApi';
import { jsonError } from '../../_shared';

/**
 * POST /api/v1/reviews/snooze
 *
 * Snooze a queue item until an ISO timestamp — hidden from the active queue
 * meanwhile. Body: `{ kind, id, until }`. Returns the refreshed queue.
 * Auth: `Authorization: Bearer vcn_live_…`.
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
    const out = await apiSnoozeReview(req.headers.get('authorization'), {
      kind: body.kind as 'skill' | 'workflow' | 'mission',
      id: Number(body.id),
      until: String(body.until),
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof WriteApiError) {
      return jsonError(e.code, e.message, e.status);
    }
    throw e;
  }
}
