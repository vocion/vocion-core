/**
 * evalRefresh — the Workflow behind both the refresh button and the schedule.
 *
 * One workflow does the running and the collecting, rather than a runner plus
 * a separate importer. For the synchronous AgentCore path there is nothing to
 * collect later anyway: `Evaluate` returns its scores in the response, and AWS
 * keeps nothing for us to fetch.
 *
 * The batch path does have something to collect, and the wait for it is this
 * workflow — a workflow sleeps for an hour without holding a process open, so
 * nothing is blocked while AWS grades. The run and its on-demand scores are
 * already finished and stored by the time the polling starts, which is what
 * makes it safe for the wait to give up: the batch result is a second,
 * auditable opinion, and abandoning it costs the audit trail, not the
 * measurement.
 *
 * Deterministic sandbox: no I/O in this file. The agent run, the judge, the
 * database and the AWS client all live in the activity.
 *
 * Timeout follows `sourceSyncWorkflow`, which solved the same problem for a
 * slow crawl. An eval run is N cases times an agent call plus a judge call,
 * which is minutes for a real dataset even with cases running eight at a time.
 */

import type * as activities from '../activities';
import { proxyActivities, sleep, workflowInfo } from '@temporalio/workflow';

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
  concurrency?: number;
};

/**
 * How long to wait between asking AWS whether the batch job has finished.
 *
 * A batch job is minutes, not seconds, so polling faster buys nothing and
 * spends API calls. Thirty attempts at a minute apart is half an hour, which
 * is comfortably longer than a job over a dataset-sized set of sessions and
 * short enough that a stuck job does not hold a workflow open all day.
 */
const BATCH_POLL_INTERVAL = '1 minute';
const BATCH_POLL_ATTEMPTS = 30;

export async function evalRefreshWorkflow(input: EvalRefreshWorkflowInput) {
  // Derived from the workflow run itself, so every retry of the activity sees
  // the same value and reuses the run rows rather than creating new ones. A
  // random id generated inside the activity would change on each attempt,
  // which is exactly the bug this prevents.
  const runGroupId = workflowInfo().workflowId;

  const result = await acts.runEvalDatasetActivity({
    orgId: input.orgId,
    datasetSlug: input.datasetSlug,
    runGroupId,
    concurrency: input.concurrency,
  });

  // Nothing to wait for unless this deployment turned batch evaluation on and
  // the run actually started a job.
  if (result.batchJobId === null) {
    return result;
  }

  for (let attempt = 0; attempt < BATCH_POLL_ATTEMPTS; attempt++) {
    await sleep(BATCH_POLL_INTERVAL);
    const finished = await acts.advanceEvalBatchActivity(result.batchJobId);
    if (finished) {
      return result;
    }
  }

  // Out of patience, not out of job. The row keeps whatever AWS last said and
  // the identifiers to go and look, which is more useful than pretending the
  // job failed.
  return result;
}
