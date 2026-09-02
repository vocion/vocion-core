import { NextResponse } from 'next/server';
import { apiAssignReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/assign
 *
 * Route a queue item to a user. Body: `{ kind, id, assignedTo, note? }` where
 * `assignedTo` is an org user id, or `null` to unassign. Returns the refreshed
 * queue. Requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  try {
    return NextResponse.json(await apiAssignReview(caller, {
      kind: body.kind as 'workflow' | 'mission' | 'action',
      id: Number(body.id),
      assignedTo: (body.assignedTo as string | null) ?? null,
      note: typeof body.note === 'string' ? body.note : undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
