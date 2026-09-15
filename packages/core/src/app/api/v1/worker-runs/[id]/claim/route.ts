import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, claimWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/claim  { workerId }
 * Take the lease. 409 if someone else holds it, 402 if the agent is over budget.
 * Returns the run and a short-lived `toolClaim` for /api/internal/agent-tools.
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
    const { run, toolClaim } = await claimWorkerRun({ orgId: caller.orgId, id, workerId });
    return NextResponse.json({ run, toolClaim, leaseExpiresAt: run.leaseExpiresAt });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
