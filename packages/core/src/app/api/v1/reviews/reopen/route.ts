import { NextResponse } from 'next/server';
import { apiReopenReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/reopen
 *
 * Take back a person's rejection of a queued action: the run returns to
 * `pending` and is decidable again through `/reviews/decide`. Body:
 * `{ kind: "action", id }`.
 *
 * Only a run that is `rejected` now, by a person, that never executed, and
 * whose action can put its own record back reopens. Anything else is a 409:
 * `INVALID_STATE` (not rejected — including a second reopen),
 * `NOT_REOPENABLE` (rejected by a machine or by no one on record, executed,
or expired) or
 * `SUPERSEDED` (the same record was proposed again and that run is open).
 * Another workspace's run is a 404. Who reopened it and when is kept on the
 * run's proposal envelope (`proposal.reopened`); a note the item carried in
 * the queue moves there too (`priorNote`), so it does not read as current.
 * `REOPEN_FAILED` (500) means the action could not put its record back; the
 * run is left rejected unless someone decided it in the meantime.
 *
 * Requires the `approve` capability, as deciding does. Returns
 * `{ ok, reopened: { kind, id, status, reopenedBy, reopenedAt }, reviews }`.
 * Auth: tenant API token or dashboard session.
 * @param req - The incoming request.
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
    return NextResponse.json(await apiReopenReview(caller, {
      kind: body.kind as 'workflow' | 'mission' | 'action',
      id: Number(body.id),
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
