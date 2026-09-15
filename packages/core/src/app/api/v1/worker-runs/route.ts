import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, createWorkerRun, listWorkerRuns, parseWorkerRunKind, WORKER_RUN_KINDS } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination } from '../_shared';
import { obj, str, workerRunErrorResponse } from './_lib';

/**
 * GET /api/v1/worker-runs?status=&agentSlug=&kind=&limit=&offset=
 * Runs for the caller's org, newest first. Auth: tenant API token or dashboard session.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  try {
    assertExternalWorkersEnabled();
    const url = new URL(req.url);
    const { limit, offset } = readPagination(url);
    const runs = await listWorkerRuns(caller.orgId, {
      status: url.searchParams.get('status') ?? undefined,
      agentSlug: url.searchParams.get('agentSlug') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      limit,
      offset,
    });
    return NextResponse.json({ runs });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}

/**
 * POST /api/v1/worker-runs
 *   { agentSlug, input?, endsAt?, capCents?, leaseSeconds?, kind?, model? }
 * Queue a run for an external worker. `kind` is one of lead | board | worker |
 * red-team | compact | snapshot (default worker); `model` is the model expected
 * to do the work. Auth: tenant API token or dashboard session.
 * @param req - Request.
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
  const agentSlug = str(body, 'agentSlug');
  if (!agentSlug) {
    return jsonError('VALIDATION_FAILED', 'agentSlug is required', 400);
  }
  const endsAt = typeof body.endsAt === 'string' ? new Date(body.endsAt) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    return jsonError('VALIDATION_FAILED', 'endsAt must be an ISO-8601 timestamp', 400);
  }
  const kind = body.kind === undefined ? undefined : parseWorkerRunKind(body.kind);
  if (kind === null) {
    return jsonError('VALIDATION_FAILED', `kind must be one of ${WORKER_RUN_KINDS.join(', ')}`, 400);
  }
  const model = str(body, 'model');
  const capCents = typeof body.capCents === 'number' && body.capCents >= 0 ? Math.floor(body.capCents) : null;
  const leaseSeconds = typeof body.leaseSeconds === 'number' && body.leaseSeconds >= 30 && body.leaseSeconds <= 3600 ? Math.floor(body.leaseSeconds) : undefined;
  try {
    assertExternalWorkersEnabled();
    const run = await createWorkerRun({ orgId: caller.orgId, agentSlug, input: obj(body, 'input'), endsAt, capCents, leaseSeconds, createdBy: caller.actorId, kind, model });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
