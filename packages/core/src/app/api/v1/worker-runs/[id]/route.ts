import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, getWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../_shared';
import { workerRunErrorResponse } from '../_lib';

/**
 * GET /api/v1/worker-runs/:id — one run. Auth: tenant API token or dashboard session.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
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
    const run = await getWorkerRun(caller.orgId, id);
    return run ? NextResponse.json({ run }) : jsonError('NOT_FOUND', `No worker run ${id}`, 404);
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
