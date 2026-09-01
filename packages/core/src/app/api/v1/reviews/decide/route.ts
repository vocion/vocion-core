import { NextResponse } from 'next/server';
import { apiDecideReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/decide
 *
 * Approve or reject a queued item. Body:
 *
 *   { kind, id, action, reason?, editedInput? }
 *
 * where `kind` is `workflow` | `mission` | `action` and `action` is `approve`
 * or `reject`. `editedInput` is the edit-then-approve payload — corrected
 * fields for an action, or the input a paused workflow resumes with. It is
 * ignored on reject.
 *
 * Deciding requires the `approve` capability. Returns the refreshed queue.
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
    return NextResponse.json(await apiDecideReview(caller, {
      kind: body.kind as 'workflow' | 'mission' | 'action',
      id: Number(body.id),
      action: body.action as 'approve' | 'reject',
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      editedInput: body.editedInput && typeof body.editedInput === 'object'
        ? body.editedInput as Record<string, unknown>
        : undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
