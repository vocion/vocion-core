import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, failWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/fail  { workerId, error, failures? }
 * Terminal: the worker gave up. The lease holder stays on the row for the audit trail.
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
  const error = str(body, 'error');
  if (!workerId || !error) {
    return jsonError('VALIDATION_FAILED', 'workerId and error are required', 400);
  }
  const failuresRaw = Array.isArray(body.failures) ? body.failures : [];
  const failures = failuresRaw
    .filter((f): f is { scope?: unknown; message?: unknown } => !!f && typeof f === 'object')
    .map(f => ({ scope: typeof f.scope === 'string' ? f.scope : 'worker', message: String(f.message ?? '') }))
    .filter(f => f.message);
  try {
    assertExternalWorkersEnabled();
    const run = await failWorkerRun({ orgId: caller.orgId, id, workerId, error, failures });
    return NextResponse.json({ run });
  } catch (err) {
    return workerRunErrorResponse(err);
  }
}
