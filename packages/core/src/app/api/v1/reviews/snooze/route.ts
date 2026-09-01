import { NextResponse } from 'next/server';
import { apiSnoozeReview } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/snooze
 *
 * Delay a queue item until an ISO timestamp — hidden from the active queue
 * meanwhile, and visible again with `?includeSnoozed=true`. Body:
 * `{ kind, id, until }`. Returns the refreshed queue. Requires the `approve`
 * capability.
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
    return NextResponse.json(await apiSnoozeReview(caller, {
      kind: body.kind as 'workflow' | 'mission' | 'action',
      id: Number(body.id),
      until: String(body.until),
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
