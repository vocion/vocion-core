import { NextResponse } from 'next/server';
import { assertExternalWorkersEnabled, heartbeatWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { obj, str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/checkpoint
 *   { workerId, progress?, cursor?, counts?, usage?: { model, inputTokens?, outputTokens?, cacheReadTokens?, cents? }, langfuseTraceId?, failures? }
 * Extends the lease and records what the worker reports. The reply carries the
 * control signals — stop, paused, endsAt, capRemainingCents — and a fresh toolClaim.
 * Same contract as heartbeat; exists so a worker can name its intent. `cursor` is required here.
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
  const cursor = str(body, 'cursor') ?? undefined;
  if (!cursor) {
    return jsonError('VALIDATION_FAILED', 'cursor is required for a checkpoint', 400);
  }
  const usageRaw = obj(body, 'usage');
  const usage = usageRaw && typeof usageRaw.model === 'string'
    ? {
        model: usageRaw.model,
        inputTokens: typeof usageRaw.inputTokens === 'number' ? usageRaw.inputTokens : undefined,
        outputTokens: typeof usageRaw.outputTokens === 'number' ? usageRaw.outputTokens : undefined,
        cacheReadTokens: typeof usageRaw.cacheReadTokens === 'number' ? usageRaw.cacheReadTokens : undefined,
        cents: typeof usageRaw.cents === 'number' ? Math.max(0, Math.round(usageRaw.cents)) : undefined,
      }
    : undefined;
  const failuresRaw = Array.isArray(body.failures) ? body.failures : [];
  const failures = failuresRaw
    .filter((f): f is { scope?: unknown; message?: unknown } => !!f && typeof f === 'object')
    .map(f => ({ scope: typeof f.scope === 'string' ? f.scope : 'worker', message: String(f.message ?? '') }))
    .filter(f => f.message);
  try {
    assertExternalWorkersEnabled();
    const reply = await heartbeatWorkerRun({
      orgId: caller.orgId,
      id,
      workerId,
      progress: obj(body, 'progress'),
      cursor,
      counts: obj(body, 'counts') as Record<string, number> | undefined,
      usage,
      langfuseTraceId: str(body, 'langfuseTraceId') ?? undefined,
      failures,
    });
    return NextResponse.json({
      leaseExpiresAt: reply.leaseExpiresAt,
      stop: reply.stop,
      paused: reply.paused,
      endsAt: reply.endsAt,
      capRemainingCents: reply.capRemainingCents,
      toolClaim: reply.toolClaim,
      status: reply.run.status,
    });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
