import { NextResponse } from 'next/server';
import { apiAssignReview, WriteApiError } from '@/services/writeApi';
import { jsonError } from '../../_shared';

/**
 * POST /api/v1/reviews/assign
 *
 * Route a queue item to a user. Body: `{ kind, id, assignedTo, note? }` where
 * `assignedTo` is an org user id or `null` to unassign. Returns the refreshed
 * queue. Auth: `Authorization: Bearer vcn_live_…`.
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
    const out = await apiAssignReview(req.headers.get('authorization'), {
      kind: body.kind as 'skill' | 'workflow' | 'mission',
      id: Number(body.id),
      assignedTo: (body.assignedTo as string | null) ?? null,
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof WriteApiError) {
      return jsonError(e.code, e.message, e.status);
    }
    throw e;
  }
}
