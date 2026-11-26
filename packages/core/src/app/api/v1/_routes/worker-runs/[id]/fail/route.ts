import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, failWorkerRun, recordFinalRunEvents } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { obj, str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/fail  { workerId, error, failures?, result?, transcriptArtifactId?, promptArtifactId?, logLinks?, events? }
 * Terminal: the worker gave up. The lease holder stays on the row for the audit trail.
 * `result` is what the run kept (a draft PR). The links to its transcript,
 * prompt and full logs come at the top level of the body — `result` is only
 * sent when work was kept — and are stored on `result` beside it, where a
 * completed run carries them too, so the run page reads one place. `events`
 * is the run's last batch of step lines, landed before the run closes.
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
    const eventsAccepted = await recordFinalRunEvents({ orgId: caller.orgId, id, workerId, events: Array.isArray(body.events) ? body.events : undefined });
    const run = await failWorkerRun({ orgId: caller.orgId, id, workerId, error, failures, result: failResult(body) });
    return NextResponse.json({ run, ...(eventsAccepted === undefined ? {} : { eventsAccepted }) });
  } catch (err) {
    return workerRunErrorResponse(err);
  }
}

/**
 * What a failed run leaves on `result`: the kept work, if any, and the links
 * to its transcript, prompt and full logs. Undefined when the body carries
 * neither, so a bare fail leaves `result` as it was.
 * @param body - The fail body.
 */
function failResult(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const links: Record<string, unknown> = {};
  for (const key of ['transcriptArtifactId', 'promptArtifactId']) {
    if (typeof body[key] === 'string' || typeof body[key] === 'number') {
      links[key] = body[key];
    }
  }
  const logLinks = obj(body, 'logLinks');
  if (logLinks) {
    links.logLinks = logLinks;
  }
  const kept = obj(body, 'result');
  return kept || Object.keys(links).length > 0 ? { ...kept, ...links } : undefined;
}
