/**
 * EvalService — Phase 7.
 *
 * Run a dataset against the new deepagents runtime, scored by an LLM
 * judge (Haiku 4.5). One dataset = N cases; each case produces an
 * `eval_case_result`. Aggregate metrics land on `eval_run.metrics`.
 *
 * Determinism: temperature=0 for both the agent under test (via
 * `runAgentDeep` defaults) and the judge. Every run stamps the active
 * `workspaceSha` so prompt drift is attributable.
 *
 * Callable from CLI (`npm run eval:run -- --dataset <slug>`) and oRPC.
 * UI is a thin viewer over the rows.
 *
 * A run can name the model the agent under test runs on (`modelOverride`);
 * `services/evals/modelUpgradeTest.ts` runs a dataset twice that way and
 * compares the two on cost per passed case. Every case records its own
 * token usage and cost so that comparison is a read over stored rows.
 */

import type { EvalScoreProvider } from './evals/providers/types';
import type { ProviderRunResult, ScoreWithProviderOptions } from './evals/scoring';
import type { EvalDatasetItem } from './evals/types';
import type { LangChainProvider } from '@/libs/llm';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { evalCaseResultSchema, evalDatasetSchema, evalEvaluatorSchema, evalRunSchema, evalScoreSchema } from '@/models/Schema';
import { getProvider, listAvailableProviders } from './evals/providers/registry';
import { scoreWithProvider } from './evals/scoring';
import { persistTranscripts, produceTranscripts } from './evals/transcripts';

export type { ProviderRunResult };

/* ------------------------------------------------------------------ */
/* Catalog reads                                                       */
/* ------------------------------------------------------------------ */

export async function listDatasets(orgId: string) {
  return db
    .select()
    .from(evalDatasetSchema)
    .where(eq(evalDatasetSchema.orgId, orgId))
    .orderBy(asc(evalDatasetSchema.slug));
}

export async function getDataset(orgId: string, slug: string) {
  const [row] = await db
    .select()
    .from(evalDatasetSchema)
    .where(and(eq(evalDatasetSchema.orgId, orgId), eq(evalDatasetSchema.slug, slug)));
  return row ?? null;
}

/**
 * The 50 most recent runs, newest first.
 *
 * The dataset filter is part of the query rather than applied afterwards: with
 * several datasets running on a schedule, the newest fifty rows org-wide can
 * easily contain none of the one being looked at, and the page would say "no
 * runs yet" about a dataset that ran an hour ago.
 * @param orgId - Whose runs.
 * @param datasetId - Narrow to one dataset. Omitted means every dataset.
 * @param provider - Narrow to one grader, for the provider filter.
 */
export async function listRuns(orgId: string, datasetId?: number, provider?: string) {
  const filters = [eq(evalRunSchema.orgId, orgId)];
  if (datasetId !== undefined) {
    filters.push(eq(evalRunSchema.datasetId, datasetId));
  }
  if (provider) {
    filters.push(eq(evalRunSchema.provider, provider));
  }
  return db
    .select()
    .from(evalRunSchema)
    .where(and(...filters))
    .orderBy(desc(evalRunSchema.startedAt))
    .limit(50);
}

/**
 * Evaluators this dataset declared that could not be set up.
 *
 * Read by the dataset page so a judge that AWS refused says so, instead of
 * quietly never running and leaving someone to wonder why the score they
 * authored never appears.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Which dataset.
 */
export async function listEvaluatorProblems(orgId: string, datasetSlug: string) {
  const rows = await db
    .select({
      slug: evalEvaluatorSchema.slug,
      provider: evalEvaluatorSchema.provider,
      syncError: evalEvaluatorSchema.syncError,
    })
    .from(evalEvaluatorSchema)
    .where(and(
      eq(evalEvaluatorSchema.orgId, orgId),
      eq(evalEvaluatorSchema.datasetSlug, datasetSlug),
    ));
  return rows.filter(row => row.syncError !== null);
}

/**
 * The other providers' runs for the same execution.
 *
 * Two runs sharing a `runGroupId` scored the same transcripts, so the run page
 * can offer "AgentCore also graded this" as a link rather than leaving someone
 * to guess which of two runs from the same minute was the matching one.
 * @param orgId - Whose runs.
 * @param runGroupId - The group to read.
 * @param excludeRunId - The run being looked at.
 */
export async function listRunGroup(orgId: string, runGroupId: string, excludeRunId: number) {
  const rows = await db
    .select()
    .from(evalRunSchema)
    .where(and(eq(evalRunSchema.orgId, orgId), eq(evalRunSchema.runGroupId, runGroupId)));
  return rows.filter(row => row.id !== excludeRunId);
}

/**
 * Every score recorded against one run, oldest evaluator first.
 *
 * Read by the run page, which shows one chip per evaluator rather than a
 * single number: "trajectory matched, judge said fail" is a different thing to
 * know than "50% pass", and averaging the two away hides which is which.
 * @param runId - The run to read.
 */
export async function listScoresForRun(runId: number) {
  return db
    .select()
    .from(evalScoreSchema)
    .where(eq(evalScoreSchema.runId, runId))
    .orderBy(asc(evalScoreSchema.id));
}

export async function getRun(orgId: string, runId: number) {
  const [row] = await db
    .select()
    .from(evalRunSchema)
    .where(and(eq(evalRunSchema.orgId, orgId), eq(evalRunSchema.id, runId)));
  if (!row) {
    return null;
  }
  const results = await db
    .select()
    .from(evalCaseResultSchema)
    .where(eq(evalCaseResultSchema.runId, runId))
    .orderBy(asc(evalCaseResultSchema.itemIndex));
  return { ...row, results };
}

/* ------------------------------------------------------------------ */
/* Run a dataset                                                       */
/* ------------------------------------------------------------------ */

export type RunDatasetOptions = {
  orgId: string;
  datasetSlug: string;
  /**
   * Run the agent under test on this model instead of its own. The judge is
   * unaffected — it stays on the `classifier` role so two runs of one dataset
   * are graded by the same model. The model-upgrade test passes this; an
   * ordinary run leaves it unset and `eval_run.model` NULL.
   */
  modelOverride?: string;
  /** The override's vendor; inferred from the id's shape when omitted. */
  providerOverride?: LangChainProvider;
};

export async function runDataset(opts: RunDatasetOptions): Promise<{ runId: number; metrics: typeof evalRunSchema.$inferSelect['metrics'] }> {
  const result = await runDatasetWithProviders({ ...opts, providerIds: ['vocion'] });
  const primary = result.providerRuns[0];
  if (!primary) {
    throw new Error(`no provider scored ${opts.datasetSlug}`);
  }
  const [row] = await db
    .select({ metrics: evalRunSchema.metrics })
    .from(evalRunSchema)
    .where(eq(evalRunSchema.id, primary.runId));
  return { runId: primary.runId, metrics: row?.metrics ?? {} };
}

export type RunDatasetWithProvidersOptions = RunDatasetOptions & {
  /**
   * Which providers grade this execution. Defaults to every provider the org
   * can actually use. `runDataset` pins this to `['vocion']` so its five
   * existing callers — the CLI, the oRPC procedure, the HTTP route, the
   * model-upgrade test and the automatic learning-candidate check — keep
   * behaving exactly as they did and never make a paid AWS call nobody asked
   * for.
   */
  providerIds?: string[];
  /**
   * Ties every provider's run to the one execution they scored. Set by the
   * refresh workflow; a retry reuses it and so reuses the run rows instead of
   * adding a second point to the trend line.
   */
  runGroupId?: string | null;
  /** How many cases to execute at once. Defaults to `DEFAULT_CASE_CONCURRENCY`. */
  concurrency?: number;
};

export type RunDatasetWithProvidersResult = {
  runGroupId: string | null;
  providerRuns: ProviderRunResult[];
};

/**
 * Execute a dataset once and let every named provider grade the same run.
 *
 * Executing once and scoring N times is what keeps the scores comparable: if
 * each provider ran the agent itself, a disagreement between them could be the
 * agent behaving differently rather than the graders disagreeing, and a trend
 * line built on that cannot answer the only question it exists for.
 * @param opts - The dataset, who grades it, and how hard to push.
 */
export async function runDatasetWithProviders(
  opts: RunDatasetWithProvidersOptions,
): Promise<RunDatasetWithProvidersResult> {
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  if (!dataset) {
    throw new Error(`dataset ${opts.datasetSlug} not found for org ${opts.orgId}`);
  }
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);
  const providers = await resolveProviders(opts.orgId, opts.providerIds);
  if (providers.length === 0) {
    throw new Error(`no score provider is available for ${opts.orgId}`);
  }

  const items = (dataset.items ?? []) as EvalDatasetItem[];
  const modelOverride = opts.modelOverride
    ? { model: opts.modelOverride, ...(opts.providerOverride ? { provider: opts.providerOverride } : {}) }
    : undefined;

  const transcripts = await produceTranscripts({
    orgId: opts.orgId,
    agentSlug: dataset.agentSlug,
    items,
    modelOverride,
    concurrency: opts.concurrency,
  });

  // The first provider's run owns the transcripts, because eval_case_result
  // belongs to exactly one run. Every other provider points its scores at the
  // same case rows rather than storing a second copy of the same text.
  const [primaryProvider, ...secondaryProviders] = providers;
  const shared = {
    orgId: opts.orgId,
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    datasetVersion: dataset.version ?? null,
    agentSlug: dataset.agentSlug,
    workspaceSha: workspaceSha ?? null,
    model: opts.modelOverride ?? null,
    runGroupId: opts.runGroupId ?? null,
    transcripts,
  };

  const primaryRunId = await createPrimaryRun(shared, primaryProvider!.id);
  await persistTranscripts(primaryRunId, transcripts);

  const primaryResult = await scoreWithProvider({
    ...shared,
    provider: primaryProvider!,
    existingRunId: primaryRunId,
  });

  // Providers are independent once the transcripts exist, so they grade at the
  // same time rather than one after another.
  const secondaryResults = await Promise.all(
    secondaryProviders.map(provider => scoreWithProvider({ ...shared, provider })),
  );

  const providerRuns = [primaryResult, ...secondaryResults];
  await recordEvalEpisode(opts.orgId, dataset.slug, dataset.agentSlug, primaryResult);

  return { runGroupId: opts.runGroupId ?? null, providerRuns };
}

/**
 * Which providers should grade this run.
 *
 * Named ids are looked up and used as given; an unknown one is an error rather
 * than a silent skip, because a caller that asked for AgentCore and quietly got
 * only our own judge would believe it had AWS scores it does not have. With no
 * ids named, every provider the org can actually use grades the run.
 * @param orgId - Whose credentials decide availability.
 * @param providerIds - Explicit ids, or undefined for "whatever is available".
 */
async function resolveProviders(orgId: string, providerIds?: string[]): Promise<EvalScoreProvider[]> {
  if (!providerIds) {
    return listAvailableProviders(orgId);
  }
  const providers: EvalScoreProvider[] = [];
  for (const id of providerIds) {
    const provider = getProvider(id);
    if (!provider) {
      throw new Error(`unknown eval score provider: ${id}`);
    }
    providers.push(provider);
  }
  return providers;
}

/**
 * The run that owns the transcripts. Reused on a retry via the run group.
 * @param shared
 * @param providerId
 */
async function createPrimaryRun(
  shared: Omit<ScoreWithProviderOptions, 'provider' | 'existingRunId'>,
  providerId: string,
): Promise<number> {
  if (shared.runGroupId) {
    const [existing] = await db
      .select({ id: evalRunSchema.id })
      .from(evalRunSchema)
      .where(and(eq(evalRunSchema.runGroupId, shared.runGroupId), eq(evalRunSchema.provider, providerId)));
    if (existing) {
      return existing.id;
    }
  }
  const [run] = await db
    .insert(evalRunSchema)
    .values({
      orgId: shared.orgId,
      datasetId: shared.datasetId,
      agentSlug: shared.agentSlug,
      workspaceSha: shared.workspaceSha,
      model: shared.model,
      provider: providerId,
      datasetVersion: shared.datasetVersion,
      runGroupId: shared.runGroupId,
      status: 'running',
    })
    .returning({ id: evalRunSchema.id });
  if (!run) {
    throw new Error('failed to create eval_run row');
  }
  return run.id;
}

/**
 * Create the run row a refresh will fill in, before the work starts.
 *
 * The refresh button needs somewhere to send the browser the moment it is
 * pressed, and "somewhere" is a run page that says running. Creating the row
 * here rather than inside the workflow is what makes that possible: the
 * workflow is handed the same `runGroupId`, so its own `createPrimaryRun`
 * finds this row and fills it in instead of opening a second one.
 *
 * Only the primary provider's row is created. A secondary provider's run is
 * created when it starts scoring, because until the transcripts exist there is
 * nothing for it to be running against.
 * @param opts - Which dataset, under which run group, graded by whom.
 * @param opts.orgId
 * @param opts.datasetSlug
 * @param opts.runGroupId
 * @param opts.providerIds
 */
export async function createRefreshRun(opts: {
  orgId: string;
  datasetSlug: string;
  runGroupId: string;
  providerIds?: string[];
}): Promise<{ runId: number; providerIds: string[] }> {
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  if (!dataset) {
    throw new Error(`dataset ${opts.datasetSlug} not found for org ${opts.orgId}`);
  }
  const providers = await resolveProviders(opts.orgId, opts.providerIds);
  if (providers.length === 0) {
    throw new Error(`no score provider is available for ${opts.orgId}`);
  }
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);

  const runId = await createPrimaryRun({
    orgId: opts.orgId,
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    datasetVersion: dataset.version ?? null,
    agentSlug: dataset.agentSlug,
    workspaceSha: workspaceSha ?? null,
    model: null,
    runGroupId: opts.runGroupId,
    transcripts: [],
  }, providers[0]!.id);

  return { runId, providerIds: providers.map(provider => provider.id) };
}

/**
 * Mark a run failed when it could not be started at all.
 *
 * Used by the refresh route when Temporal is unreachable: the row already
 * exists and saying running forever would be a lie the UI cannot recover from.
 * @param runId - The row to close out.
 */
export async function failEvalRun(runId: number): Promise<void> {
  await db
    .update(evalRunSchema)
    .set({ status: 'failed', completedAt: new Date() })
    .where(eq(evalRunSchema.id, runId));
}

/**
 * File the run as an episode for the consolidation job to mine.
 *
 * Fire-and-forget, and a failure here is logged rather than propagated: the
 * run really happened, and losing a memory record must not turn a successful
 * eval into a failed one.
 * @param orgId - Whose workspace.
 * @param datasetSlug - What ran.
 * @param agentSlug - Who was tested.
 * @param result - The primary provider's run.
 */
async function recordEvalEpisode(
  orgId: string,
  datasetSlug: string,
  agentSlug: string,
  result: ProviderRunResult,
): Promise<void> {
  const [row] = await db
    .select({ metrics: evalRunSchema.metrics })
    .from(evalRunSchema)
    .where(eq(evalRunSchema.id, result.runId));
  const metrics = row?.metrics ?? {};
  void (async () => {
    const { recordEpisode } = await import('@/services/MemoryService');
    await recordEpisode({
      orgId,
      runKind: 'eval_run',
      runId: result.runId,
      agentSlug,
      text: `Eval "${datasetSlug}" on ${agentSlug}: ${metrics.passed ?? 0} passed, ${metrics.failed ?? 0} failed (pass rate ${metrics.passRate ?? 'n/a'}).`,
    });
  })().catch((error) => {
    console.error(`[EvalService] could not record an episode for eval run ${result.runId}`, error);
  });
}

/** The per-case usage record stored on `eval_case_result.usage`. */
export type CaseUsage = NonNullable<typeof evalCaseResultSchema.$inferSelect['usage']>;
