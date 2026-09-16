import { NextResponse } from 'next/server';
import { EvalRefreshNotStartedError, startEvalRefresh } from '@/services/evals/refresh';
import { EvalProviderUnavailableError, getDataset, UnknownEvalProviderError } from '@/services/EvalService';
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
 * The grader is the dataset's own — an eval lives in one place, either Vocion
 * or AgentCore — so the caller cannot pick one here.
 *
 * Body (all optional):
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

  let started;
  try {
    started = await startEvalRefresh({
      orgId: auth.orgId,
      datasetSlug: dataset.slug,
      concurrency: body.concurrency,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UnknownEvalProviderError) {
      return jsonError('UNKNOWN_PROVIDER', message, 400);
    }
    if (error instanceof EvalProviderUnavailableError) {
      // The dataset names a grader that cannot run — an AWS credential that is
      // missing or expired, usually. Nothing to retry until someone fixes it.
      return jsonError('PROVIDER_UNAVAILABLE', message, 409);
    }
    if (error instanceof EvalRefreshNotStartedError) {
      // The scheduler is down. Worth retrying, and not the caller's fault.
      return jsonError('EVAL_REFRESH_NOT_STARTED', message, 503);
    }
    // The run could not be prepared at all — no grader available, say. That is
    // a configuration problem, and retrying it changes nothing.
    console.error(`[evals] could not open a refresh run for ${slug}`, error);
    return jsonError('EVAL_REFRESH_FAILED', message, 500);
  }

  return NextResponse.json(
    {
      runId: started.runId,
      runGroupId: started.runGroupId,
      workflowId: started.runGroupId,
      status: 'running',
      provider: started.providerId,
    },
    { status: 202 },
  );
}

type RefreshBody = { concurrency?: number };

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
    concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
  };
}
