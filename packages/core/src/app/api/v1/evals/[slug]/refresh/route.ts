import { NextResponse } from 'next/server';
import {
  EVAL_REFRESH_WORKFLOW,
  evalRefreshWorkflowIdFor,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';
import { createRefreshRun, failEvalRun, getDataset } from '@/services/EvalService';
import { authApi, jsonError } from '../../../_shared';

/**
 * Refresh a dataset's scores.
 *
 * The button and the schedule are the same thing: both start
 * `evalRefreshWorkflow`, so a scheduled refresh and a hand-pressed one produce
 * identical rows and a trend line cannot tell them apart. This route returns as
 * soon as the workflow is accepted, which is what the older `runs` route could
 * not do — it awaited the whole execution and said so in its own comment.
 *
 * The run row is created here, before the workflow starts, so the response
 * carries a run id the browser can navigate to immediately. The workflow is
 * given the same id as its run group, so it finds that row rather than opening
 * a second one, and so does every retry of its activity.
 *
 * Body (all optional):
 * - `providerIds`: grade with only these providers. Omitted means every
 *   provider the org can actually use.
 * - `concurrency`: how many cases to execute at once.
 * @param req - The incoming request.
 * @param context - Next's route context.
 * @param context.params - Carries the dataset slug.
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;

  const dataset = await getDataset(auth.orgId, slug);
  if (!dataset) {
    return jsonError('NOT_FOUND', `No eval dataset found for slug "${slug}"`, 404);
  }

  const body = await readBody(req);

  const workflowId = evalRefreshWorkflowIdFor(auth.orgId, dataset.slug, Date.now());

  let run: { runId: number; providerIds: string[] };
  try {
    run = await createRefreshRun({
      orgId: auth.orgId,
      datasetSlug: dataset.slug,
      runGroupId: workflowId,
      providerIds: body.providerIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evals] could not open a refresh run for ${slug}`, error);
    return jsonError('EVAL_REFRESH_FAILED', message, 500);
  }

  try {
    const client = await getTemporalClient();
    await client.workflow.start(EVAL_REFRESH_WORKFLOW, {
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      workflowId,
      args: [{
        orgId: auth.orgId,
        datasetSlug: dataset.slug,
        providerIds: body.providerIds,
        concurrency: body.concurrency,
      }],
    });
  } catch (error) {
    // The row exists and nothing is going to fill it in. Closing it out here
    // is the difference between a run that reads failed and one that spins
    // forever on a worker that was never told to do anything.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evals] could not start the refresh workflow for ${slug}`, error);
    await failEvalRun(run.runId).catch(closeError =>
      console.error(`[evals] could not mark run ${run.runId} failed`, closeError));
    return jsonError('EVAL_REFRESH_NOT_STARTED', message, 503);
  }

  return NextResponse.json(
    {
      runId: run.runId,
      runGroupId: workflowId,
      workflowId,
      status: 'running',
      providers: run.providerIds,
    },
    { status: 202 },
  );
}

type RefreshBody = { providerIds?: string[]; concurrency?: number };

/**
 * Read the optional request body.
 *
 * The button sends nothing at all, so an empty or unparseable body means "use
 * the defaults" rather than a 400.
 * @param req - The incoming request.
 */
async function readBody(req: Request): Promise<RefreshBody> {
  const parsed = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  const body = parsed as RefreshBody;
  return {
    providerIds: Array.isArray(body.providerIds) && body.providerIds.length > 0 ? body.providerIds : undefined,
    concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
  };
}
