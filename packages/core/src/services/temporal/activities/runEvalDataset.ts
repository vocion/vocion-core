/**
 * Running an eval dataset from a Temporal activity.
 *
 * Activities run in the host process with full Node access, which is where the
 * agent, the judge and the AWS client all live. The Workflow that calls this
 * stays in the deterministic sandbox and does no I/O of its own.
 *
 * The `runGroupId` matters more here than anywhere else. Temporal activities
 * are at-least-once: a worker that dies mid-run has its activity retried, and
 * an eval run that inserted its rows already would otherwise insert a second
 * set — a phantom point on a trend line, for work that happened once. The
 * group id is unique per provider in the database, so the retry finds the run
 * it already created instead of making another.
 */

import { listAvailableProviders } from '@/services/evals/providers/registry';
import { runDatasetWithProviders } from '@/services/EvalService';

export type RunEvalDatasetInput = {
  orgId: string;
  datasetSlug: string;
  /**
   * Ties every provider's run to this one execution, and makes a retry
   * idempotent. The workflow generates it once and passes the same value on
   * every attempt.
   */
  runGroupId: string;
  /**
   * Which providers grade the run. Omitted means every provider the org can
   * actually use, which is what a scheduled refresh wants.
   */
  providerIds?: string[];
  concurrency?: number;
};

export type RunEvalDatasetOutput = {
  runGroupId: string;
  providerRuns: Array<{
    providerId: string;
    runId: number;
    scoreCount: number;
    error: string | null;
  }>;
};

/**
 * Execute the dataset once and let every available provider grade it.
 *
 * A provider that fails leaves a failed run rather than taking the activity
 * down with it: AWS being unreachable must not cost someone the scores their
 * own judge produced in the same pass.
 * @param input - Which dataset, under which run group.
 */
export async function runEvalDatasetActivity(input: RunEvalDatasetInput): Promise<RunEvalDatasetOutput> {
  const result = await runDatasetWithProviders({
    orgId: input.orgId,
    datasetSlug: input.datasetSlug,
    providerIds: input.providerIds,
    runGroupId: input.runGroupId,
    concurrency: input.concurrency,
  });

  return {
    runGroupId: input.runGroupId,
    providerRuns: result.providerRuns.map(run => ({
      providerId: run.providerId,
      runId: run.runId,
      scoreCount: run.scoreCount,
      error: run.error,
    })),
  };
}

/**
 * Which providers this org could use right now.
 *
 * Read by the refresh route so the UI can say "AgentCore is not available
 * because ..." before anything runs, rather than after fifty failed cases.
 * @param orgId - Whose credentials to check.
 */
export async function listEvalProvidersActivity(orgId: string): Promise<string[]> {
  const providers = await listAvailableProviders(orgId);
  return providers.map(provider => provider.id);
}
