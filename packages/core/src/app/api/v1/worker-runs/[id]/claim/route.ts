import { NextResponse } from 'next/server';
import { signRunToken } from '@/services/runners/runToken';
import { assertExternalWorkersEnabled, claimWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/claim  { workerId, workerVersion?, target? }
 * `workerVersion` is what the worker is — its image tag, build or commit —
 * kept on the run, so a failure in the worker's own environment is retried
 * only once the worker has changed. `target` is which runner target it is
 * (`on-box`, `aws-fargate`), shown on the Runs page.
 * Take the lease. 409 if someone else holds it, 402 if the agent is over budget.
 * Returns the run, a short-lived `toolClaim` for /api/internal/agent-tools, and a
 * `runToken` bound to this run and lease for every call that follows.
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
    const target = str(body, 'target');
    const { run, toolClaim } = await claimWorkerRun({ orgId: caller.orgId, id, workerId, workerVersion: str(body, 'workerVersion') ?? str(body, 'worker_version'), target });
    // The run token, as the installation claim hands one out (Vocion 5.1): a runner that claimed
    // with a workspace token switches to it and drops the workspace token before it clones.
    const runToken = signRunToken({ orgId: run.orgId, runId: run.id, target: target ?? 'worker', workerId });
    return NextResponse.json({ run, toolClaim, runToken, leaseExpiresAt: run.leaseExpiresAt });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
