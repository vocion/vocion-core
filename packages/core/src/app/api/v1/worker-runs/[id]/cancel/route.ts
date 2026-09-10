import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, cancelWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, readIdParam } from '../../../_shared';
import { workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/cancel — the human kill switch.
 * `queued` cancels now; a running run is asked to stop and learns it on its next
 * heartbeat (Vocion cannot kill a process it does not host). Auth: tenant API token or dashboard session.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
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
  try {
    assertExternalWorkersEnabled();
    const run = await cancelWorkerRun(caller.orgId, id);
    return NextResponse.json({ run });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
