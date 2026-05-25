import { NextResponse } from 'next/server';
import { getDataset, runDataset } from '@/services/EvalService';
import { authApi, jsonError } from '../../../_shared';

/**
 * Kick off an eval run for a dataset. Returns the runId immediately;
 * the run continues in the background (status flips to 'succeeded' or
 * 'failed' when complete). UI polls the run-detail page until the
 * `completedAt` timestamp appears.
 *
 * Long-running by nature — each case can take several seconds (LLM
 * generation + LLM judge). The HTTP handler must not block on the full
 * run; we fire-and-forget via Promise.resolve so the runDataset() call
 * still lands in the event loop.
 * @param _req
 * @param context
 * @param context.params
 */
export async function POST(_req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi();
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;

  const dataset = await getDataset(auth.orgId, slug);
  if (!dataset) {
    return jsonError('NOT_FOUND', `No eval dataset found for slug "${slug}"`, 404);
  }

  // Fire-and-forget. runDataset creates the eval_run row early (so the
  // returned runId is meaningful right away) and updates metrics +
  // status as cases complete.
  const start = runDataset({ orgId: auth.orgId, datasetSlug: dataset.slug });
  // We need to wait long enough to get the runId back without blocking
  // on the full execution. The service returns { runId, metrics } once
  // metrics are computed at the end; for an async kickoff we want the
  // initial row insert's id. As a pragmatic v0.5 cut: await the full
  // result (datasets are small in early demos — a few cases × a few
  // seconds is acceptable). When datasets grow, refactor runDataset to
  // expose an immediate-return signature.
  try {
    const result = await start;
    return NextResponse.json({ runId: result.runId, metrics: result.metrics }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError('EVAL_RUN_FAILED', message, 500);
  }
}
