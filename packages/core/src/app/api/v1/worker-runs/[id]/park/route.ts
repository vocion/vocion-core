import { NextResponse } from 'next/server';
import { ResumeGateError } from '@/services/needsYou/ResumeGateService';
import { assertExternalWorkersEnabled, parkWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { obj, str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/park — stop spending until the asks it waits on are answered.
 * Body: `{ workerId, waitingOn: [askId, …], reason?, cursor?, progress? }`.
 *
 * Everything the run has left to do waits on these asks, so it stops
 * spending until they are answered. Vocion files ONE resume-gate ask on Needs
 * you ("nothing I can do until …"), the run becomes `paused` and gives up its
 * lease — the worker can exit; nothing is reaped. When every ask named is
 * answered, or a person presses Resume, the run is `queued` again for any
 * worker to claim with the `cursor` it left; Stop cancels it. Parking again
 * while parked adds to what it waits on and keeps the one gate.
 *
 * 200 `{ run, gateAskId, waitingOn, created }`. 404 for an ask that is not in
 * this workspace, 409 when none of the asks is still open (read the answers
 * and carry on) or the run is not running. Auth: tenant API token or session;
 * the caller must hold the lease.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params - The run id.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await context.params).id, 'Worker run id');
  if (isErrorResponse(id)) {
    return id;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const workerId = str(body, 'workerId');
  if (!workerId) {
    return jsonError('VALIDATION_FAILED', 'workerId is required', 400);
  }
  try {
    assertExternalWorkersEnabled();
    const parked = await parkWorkerRun({
      orgId: caller.orgId,
      id,
      workerId,
      waitingOn: body.waitingOn,
      reason: str(body, 'reason'),
      cursor: str(body, 'cursor'),
      progress: obj(body, 'progress'),
    });
    return NextResponse.json(parked);
  } catch (error) {
    if (error instanceof ResumeGateError) {
      return jsonError(error.code, error.message, error.status);
    }
    return workerRunErrorResponse(error);
  }
}
