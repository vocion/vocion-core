/**
 * Starting an eval refresh.
 *
 * One function, called by both the refresh button's route and the scheduled
 * job, so a hand-pressed run and a cron run produce identical rows and the
 * trend line cannot tell them apart. Two code paths that drifted would show up
 * as a step in the chart that nobody could explain.
 *
 * The run row is created before the workflow starts, so the caller has
 * something to point a person at immediately, and the workflow is started
 * under that same id — which is also its run group, so a retried activity
 * finds the rows it already made instead of filing a second run.
 */

import {
  EVAL_REFRESH_WORKFLOW,
  evalRefreshWorkflowIdFor,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';
import { createRefreshRun, failEvalRun } from '@/services/EvalService';

/**
 * Temporal would not take the work.
 *
 * Its own type because the caller answers differently: a dataset that could
 * not even be prepared is a configuration problem the person has to fix, while
 * this is the scheduler being down and worth retrying.
 */
export class EvalRefreshNotStartedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EvalRefreshNotStartedError';
  }
}

export type StartEvalRefreshOptions = {
  orgId: string;
  datasetSlug: string;
  /** How many cases to execute at once. */
  concurrency?: number;
};

export type StartedEvalRefresh = {
  runId: number;
  /** Doubles as the workflow id. */
  runGroupId: string;
  /** The grader this dataset is scored by, from its workspace file. */
  providerId: string;
};

/**
 * Open a run and hand it to Temporal.
 *
 * Throws `EvalRefreshNotStartedError` when the workflow could not be started,
 * having first closed the run out as failed: a row that says `running` with
 * nothing on its way to fill it in is the one state a person cannot recover
 * from on their own. Anything thrown before that point — an unknown dataset,
 * a grader that cannot run — comes through as itself.
 * @param options - Which dataset, and how hard to push.
 */
export async function startEvalRefresh(options: StartEvalRefreshOptions): Promise<StartedEvalRefresh> {
  const workflowId = evalRefreshWorkflowIdFor(options.orgId, options.datasetSlug, Date.now());
  const run = await createRefreshRun({
    orgId: options.orgId,
    datasetSlug: options.datasetSlug,
    runGroupId: workflowId,
  });

  try {
    const client = await getTemporalClient();
    await client.workflow.start(EVAL_REFRESH_WORKFLOW, {
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      workflowId,
      args: [{
        orgId: options.orgId,
        datasetSlug: options.datasetSlug,
        concurrency: options.concurrency,
      }],
    });
  } catch (error) {
    console.error(`[evals] could not start the refresh workflow for ${options.datasetSlug}`, error);
    await failEvalRun(run.runId).catch(closeError =>
      console.error(`[evals] could not mark run ${run.runId} failed`, closeError));
    throw new EvalRefreshNotStartedError((error as Error).message ?? 'could not start the refresh workflow', { cause: error });
  }

  return { runId: run.runId, runGroupId: workflowId, providerId: run.providerId };
}
