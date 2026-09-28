import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, completeWorkerRun, recordFinalRunEvents } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { obj, str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/complete  { workerId, result?, counts?, summary?, events? }
 * Terminal. A run that had been asked to stop is recorded as `cancelled`.
 * `summary` is the worker's own one-paragraph account, shown on the team report.
 * `events` is the run's last batch of step lines, landed before the run closes;
 * the reply's `eventsAccepted` is the highest seq Vocion has dealt with.
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
    const eventsAccepted = await recordFinalRunEvents({ orgId: caller.orgId, id, workerId, events: Array.isArray(body.events) ? body.events : undefined });
    const run = await completeWorkerRun({ orgId: caller.orgId, id, workerId, result: obj(body, 'result'), counts: obj(body, 'counts') as Record<string, number> | undefined, summary: str(body, 'summary') });
    return NextResponse.json({ run, ...(eventsAccepted === undefined ? {} : { eventsAccepted }) });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
