import { NextResponse } from 'next/server';
import { apiDecideReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/decide
 *
 * Approve or reject a queued item. Body:
 *
 *   { kind, id, action, reason?, editedInput?, externalRef? }
 *
 * where `kind` is `workflow` | `mission` | `action` and `action` is `approve`
 * or `reject`. `editedInput` is the edit-then-approve payload — corrected
 * fields for an action, or the input a paused workflow resumes with. It is
 * ignored on reject.
 *
 * `externalRef` is `{ system, id }` naming the record the caller created in
 * its own system before approving — an admin panel publishes the record, then
 * approves with its id, and the action links the two in one call. Core never
 * calls that system itself. Ignored on reject.
 *
 * Deciding requires the `approve` capability. Returns the refreshed queue.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
/**
 * Read `{ system, id }` off the request body, or undefined when the caller
 * sent nothing usable. Both halves are required: a system with no id, or the
 * reverse, would write a broken link rather than no link.
 * @param value - The raw `externalRef` field from the body.
 */
function readExternalRef(value: unknown): { system: string; id: string } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const { system, id } = value as { system?: unknown; id?: unknown };
  if (typeof system !== 'string' || system === '' || typeof id !== 'string' || id === '') {
    return undefined;
  }
  return { system, id };
}

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
      externalRef: readExternalRef(body.externalRef),
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
