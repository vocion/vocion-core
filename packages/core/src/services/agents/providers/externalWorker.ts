import { createWorkerRun, externalWorkersEnabled } from '@/services/WorkerRunService';

/**
 * The `external-worker` harness target (ADR 0004). Unlike the other three
 * targets this does NOT run a turn: a worker Vocion does not host will pick the
 * run up over `/api/v1/worker-runs`. What the caller gets back is a receipt.
 * Everything the worker later proposes lands in the review queue like any
 * other agent's, so nothing here needs new authorisation semantics.
 * @param opts - The same options the in-process loop receives.
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.message
 * @param opts.userId
 * @param opts.missionSlug
 * @param opts.missionRunId
 * @param opts.conversationId
 * @param opts.allowedSourceSlugs
 */
export async function queueExternalWorkerTurn(opts: {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  missionSlug?: string;
  missionRunId?: number;
  conversationId?: number;
  allowedSourceSlugs?: string[];
}): Promise<{ response: string; traceId: string; toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }> }> {
  if (!externalWorkersEnabled()) {
    throw new Error(`Agent "${opts.agentSlug}" runs on an external worker, but external workers are not enabled on this deployment (VOCION_EXTERNAL_WORKERS=1).`);
  }
  const run = await createWorkerRun({
    orgId: opts.orgId,
    agentSlug: opts.agentSlug,
    createdBy: opts.userId,
    input: {
      message: opts.message,
      conversationId: opts.conversationId ?? null,
      missionSlug: opts.missionSlug ?? null,
      missionRunId: opts.missionRunId ?? null,
      allowedSourceSlugs: opts.allowedSourceSlugs ?? null,
    },
  });
  return {
    response: `Queued as worker run #${run.id} for "${opts.agentSlug}". A worker will claim it; progress and results appear on the run, and anything it proposes lands in Review.`,
    traceId: `worker-run-${run.id}`,
    toolCalls: [],
  };
}
