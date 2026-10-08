import { NextResponse } from 'next/server';
import { signRunToken } from '@/services/runners/runToken';
import { assertExternalWorkersEnabled, heartbeatWorkerRun } from '@/services/WorkerRunService';
import { authApi, isErrorResponse, jsonError, readIdParam, readJsonBody } from '../../../_shared';
import { obj, str, workerRunErrorResponse } from '../../_lib';

/**
 * POST /api/v1/worker-runs/:id/heartbeat
 *   { workerId, workerVersion?, progress?, cursor?, counts?, usage?: { model, inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, cents? }, langfuseTraceId?, failures?, events? }
 * Extends the lease and records what the worker reports. The reply carries the
 * control signals — stop, paused, endsAt, capRemainingCents — and a fresh toolClaim;
 * to a runner calling with a run token, a fresh `runToken` instead.
 *
 * `events` is the run's step log since the last beat — `[{ seq, ts, phase,
 * level?, message?, fields? }]`, at most 200 — and `eventsAccepted` in the
 * reply is the highest seq Vocion has dealt with (`services/runs/RunLogService.ts`).
 * Lines that cannot be stored never fail the heartbeat; the reply then omits
 * `eventsAccepted` and the worker resends them.
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

  const usageRaw = obj(body, 'usage');
  const usage = usageRaw && typeof usageRaw.model === 'string'
    ? {
        model: usageRaw.model,
        inputTokens: typeof usageRaw.inputTokens === 'number' ? usageRaw.inputTokens : undefined,
        outputTokens: typeof usageRaw.outputTokens === 'number' ? usageRaw.outputTokens : undefined,
        cacheReadTokens: typeof usageRaw.cacheReadTokens === 'number' ? usageRaw.cacheReadTokens : undefined,
        // A cache WRITE costs more than a plain input token (1.25x), so a
        // worker that reports one and has it folded into `inputTokens` is
        // undercharged for every cold turn. Read separately for the same
        // reason `TokenUsage` keeps the two apart.
        cacheWriteTokens: typeof usageRaw.cacheWriteTokens === 'number' ? usageRaw.cacheWriteTokens : undefined,
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
      events: Array.isArray(body.events) ? body.events : undefined,
      workerVersion: str(body, 'workerVersion') ?? str(body, 'worker_version'),
    });
    return NextResponse.json({
      leaseExpiresAt: reply.leaseExpiresAt,
      stop: reply.stop,
      paused: reply.paused,
      endsAt: reply.endsAt,
      capRemainingCents: reply.capRemainingCents,
      status: reply.run.status,
      ...(reply.eventsAccepted === undefined ? {} : { eventsAccepted: reply.eventsAccepted }),
      // A runner on a run token gets a fresh one each beat (Vocion 5.1), bound to the lease holder
      // the beat just proved: a run token lives two hours past the last beat, not the run's
      // whole length, so one copied out of a container dies soon after its run stops. It gets no
      // toolClaim: the runner calls no agent tool, and that claim acts across the workspace.
      ...(caller.run
        ? { runToken: signRunToken({ orgId: caller.orgId, runId: id, target: caller.run.target, workerId: caller.run.workerId ?? workerId }) }
        : { toolClaim: reply.toolClaim }),
    });
  } catch (error) {
    return workerRunErrorResponse(error);
  }
}
