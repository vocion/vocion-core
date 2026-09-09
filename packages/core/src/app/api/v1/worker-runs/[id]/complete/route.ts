import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, completeWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { obj, str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/complete  { workerId, result?, counts? }
 * Terminal. A run that had been asked to stop is recorded as `cancelled`.
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
    const run = await completeWorkerRun({ orgId: caller.orgId, id, workerId, result: obj(body, 'result'), counts: obj(body, 'counts') as Record<string, number> | undefined });
    return NextResponse.json({ run });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
