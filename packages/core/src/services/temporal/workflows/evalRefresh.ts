/**
 * evalRefresh — the Workflow behind both the refresh button and the schedule.
 *
 * One workflow does the running and the collecting, rather than a runner plus
 * a separate importer. For the synchronous AgentCore path there is nothing to
 * collect later anyway: `Evaluate` returns its scores in the response, and AWS
 * keeps nothing for us to fetch. When the batch path lands, the durable wait
 * belongs here too — a Temporal workflow can sleep for an hour without holding
 * a process open, so the wait is the workflow.
 *
 * Deterministic sandbox: no I/O in this file. The agent run, the judge, the
 * database and the AWS client all live in the activity.
 *
 * Timeout follows `sourceSyncWorkflow`, which solved the same problem for a
 * slow crawl. An eval run is N cases times an agent call plus a judge call,
 * which is minutes for a real dataset even with cases running eight at a time.
 */

import type * as activities from '../activities';
import { proxyActivities, workflowInfo } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // Long by design: a big dataset is a lot of model calls. Capped retries,
  // because an eval that fails three times is telling us something rather
  // than waiting to get lucky.
  startToCloseTimeout: '30 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 3,
  },
});

export type EvalRefreshWorkflowInput = {
  orgId: string;
  datasetSlug: string;
  /**
   * Which providers grade this run. Omitted means every provider the org can
   * use, which is what a scheduled refresh wants; the refresh button can pin
   * one when someone only wants to re-score with a single grader.
   */
  providerIds?: string[];
  concurrency?: number;
};

export async function evalRefreshWorkflow(input: EvalRefreshWorkflowInput) {
  // Derived from the workflow run itself, so every retry of the activity sees
  // the same value and reuses the run rows rather than creating new ones. A
  // random id generated inside the activity would change on each attempt,
  // which is exactly the bug this prevents.
  const runGroupId = workflowInfo().workflowId;

  return acts.runEvalDatasetActivity({
    orgId: input.orgId,
    datasetSlug: input.datasetSlug,
    runGroupId,
    providerIds: input.providerIds,
    concurrency: input.concurrency,
  });
}
