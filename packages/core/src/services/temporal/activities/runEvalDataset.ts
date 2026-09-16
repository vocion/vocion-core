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
 *
 * Both imports are deferred. `EvalService` reaches LangChain and a Bedrock
 * client through the agent it runs, and the worker boots every activity module
 * eagerly — so a static import here would cost seconds of startup and megabytes
 * of module graph on a worker that may never run an eval. The same split the
 * processor registry already uses, and `temporal-worker.imports.test.ts`
 * asserts it holds.
 */

export type RunEvalDatasetInput = {
  orgId: string;
  datasetSlug: string;
  /**
   * Ties every provider's run to this one execution, and makes a retry
   * idempotent. The workflow generates it once and passes the same value on
   * every attempt.
   */
  runGroupId: string;
  concurrency?: number;
};

export type RunEvalDatasetOutput = {
  runGroupId: string;
  providerId: string;
  runId: number;
  scoreCount: number;
  error: string | null;
};

/**
 * Execute the dataset once and score it with the grader it names.
 * @param input - Which dataset, under which run group.
 */
export async function runEvalDatasetActivity(input: RunEvalDatasetInput): Promise<RunEvalDatasetOutput> {
  const { runDatasetAndScore } = await import('@/services/EvalService');
  const result = await runDatasetAndScore({
    orgId: input.orgId,
    datasetSlug: input.datasetSlug,
    runGroupId: input.runGroupId,
    concurrency: input.concurrency,
  });

  return {
    runGroupId: input.runGroupId,
    providerId: result.run.providerId,
    runId: result.run.runId,
    scoreCount: result.run.scoreCount,
    error: result.run.error,
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
  const { listAvailableProviders } = await import('@/services/evals/providers/registry');
  const providers = await listAvailableProviders(orgId);
  return providers.map(provider => provider.id);
}
