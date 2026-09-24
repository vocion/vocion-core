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

import type { SQL } from 'drizzle-orm';
import type { EvalScoreProvider } from './evals/providers/types';
import type { ProviderRunResult, ScoreWithProviderOptions } from './evals/scoring';
import type { CaseTranscript } from './evals/transcripts';
import type { EvalDatasetItem } from './evals/types';
import type { RunRange } from '@/libs/evals/runRange';
import type { LangChainProvider } from '@/libs/llm';
import process from 'node:process';
import { and, asc, avg, count, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { MAX_TREND_RUNS } from '@/libs/evals/runRange';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { evalCaseResultSchema, evalDatasetSchema, evalEvaluatorSchema, evalRunSchema, evalScoreSchema } from '@/models/Schema';
import { getProvider } from './evals/providers/registry';
import { syncDatasetToProvider } from './evals/publish';
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

/** How many datasets one page of the eval list shows. */
export const EVAL_DATASETS_PAGE_SIZE = 12;

/**
 * One page of eval datasets, optionally narrowed by a search.
 *
 * The search covers the name, the slug and the agent, because those are the
 * three things someone actually remembers about a dataset — "the refund one",
 * "refund-quality", "whatever the support agent runs". Matching is
 * case-insensitive and anywhere in the value, so a half-remembered word finds
 * it.
 * @param orgId - Whose datasets.
 * @param options - Search text, page number (1-based) and page size.
 * @param options.q - Free text; blank or missing means no filter.
 * @param options.page - 1-based page number; anything lower is treated as 1.
 * @param options.pageSize - Rows per page.
 */
export async function listDatasetsPage(
  orgId: string,
  options: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{ datasets: Array<typeof evalDatasetSchema.$inferSelect>; page: number; hasMore: boolean }> {
  const pageSize = options.pageSize ?? EVAL_DATASETS_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const search = options.q?.trim();
  const filters = [eq(evalDatasetSchema.orgId, orgId)];
  if (search) {
    const pattern = `%${search}%`;
    filters.push(or(
      ilike(evalDatasetSchema.name, pattern),
      ilike(evalDatasetSchema.slug, pattern),
      ilike(evalDatasetSchema.agentSlug, pattern),
    )!);
  }
  const rows = await db
    .select()
    .from(evalDatasetSchema)
    .where(and(...filters))
    .orderBy(asc(evalDatasetSchema.slug))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { datasets: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

/** What a dataset card says about its runs, without loading every run. */
export type DatasetRunFacts = {
  runCount: number;
  latestStatus: string | null;
  latestStartedAt: Date | null;
  /** From the newest run that finished, so a run in flight hides nothing. */
  lastPassRate: number | null;
  /** Every grader that has scored this dataset, alphabetically. */
  providers: string[];
};

/**
 * Summarise each dataset's runs in one query.
 *
 * The list used to read the fifty newest runs org-wide and group them in
 * memory, which is wrong twice over: a busy org's newest fifty can contain
 * nothing from the dataset being looked at, and the run count on the card was
 * however many of that fifty happened to belong to it. This asks the database
 * the question the card is actually asking.
 * @param orgId - Whose runs.
 * @param datasetIds - The datasets on this page. An empty list asks nothing.
 */
export async function summariseDatasetRuns(orgId: string, datasetIds: number[]): Promise<Map<number, DatasetRunFacts>> {
  const facts = new Map<number, DatasetRunFacts>();
  if (datasetIds.length === 0) {
    return facts;
  }
  // `db.execute` hands back `{ rows }` on the Postgres driver and a bare array
  // on some others, the same shape `AdoptionService` normalises.
  const result = await db.execute(sql`
    SELECT
      dataset_id,
      count(*)::int AS run_count,
      (array_agg(status ORDER BY started_at DESC))[1] AS latest_status,
      max(started_at) AS latest_started_at,
      (array_agg((metrics->>'passRate')::float8 ORDER BY started_at DESC)
        FILTER (WHERE status = 'succeeded' AND metrics ? 'passRate'))[1] AS last_pass_rate,
      array_agg(DISTINCT provider) AS providers
    FROM eval_run
    WHERE org_id = ${orgId} AND dataset_id = ANY(${sql.raw(`ARRAY[${datasetIds.join(',')}]`)})
    GROUP BY dataset_id
  `);
  const rows = ((result as { rows?: unknown }).rows ?? result) as Array<Record<string, unknown>>;
  for (const row of rows) {
    facts.set(Number(row.dataset_id), {
      runCount: Number(row.run_count ?? 0),
      latestStatus: row.latest_status === null || row.latest_status === undefined ? null : String(row.latest_status),
      latestStartedAt: row.latest_started_at ? new Date(row.latest_started_at as string) : null,
      lastPassRate: row.last_pass_rate === null || row.last_pass_rate === undefined ? null : Number(row.last_pass_rate),
      providers: ((row.providers ?? []) as string[]).slice().sort(),
    });
  }
  return facts;
}

export async function getDataset(orgId: string, slug: string) {
  const [row] = await db
    .select()
    .from(evalDatasetSchema)
    .where(and(eq(evalDatasetSchema.orgId, orgId), eq(evalDatasetSchema.slug, slug)));
  return row ?? null;
}

/**
 * The `started_at` conditions for a period: `from` inclusive, `to` exclusive.
 * An end that is missing adds no condition, so an empty range is all time.
 * @param range - The period, or undefined for all time.
 */
function startedWithin(range: RunRange | undefined): SQL[] {
  const conditions: SQL[] = [];
  if (range?.from) {
    conditions.push(gte(evalRunSchema.startedAt, range.from));
  }
  if (range?.to) {
    conditions.push(lt(evalRunSchema.startedAt, range.to));
  }
  return conditions;
}

/** How many runs one page of the dataset's run list shows. */
export const EVAL_RUNS_PAGE_SIZE = 20;

/**
 * One page of a dataset's runs, newest first.
 *
 * Paged in SQL rather than by slicing a fetched array: a dataset on a nightly
 * schedule passes fifty runs in under two months, and the page that reads
 * "recent runs" would then quietly stop being able to reach the older ones.
 *
 * `hasMore` comes from asking for one row more than the page shows, which
 * costs nothing next to a second `count(*)` over the same rows.
 * @param orgId - Whose runs.
 * @param datasetId - Which dataset.
 * @param options - Page number (1-based), page size, the grader filter and the period.
 * @param options.page - 1-based page number; anything lower is treated as 1.
 * @param options.pageSize - Rows per page.
 * @param options.provider - Narrow to one grader, for the provider filter.
 * @param options.range - Only runs that started inside this period. Omitted means all time.
 */
export async function listRunsPage(
  orgId: string,
  datasetId: number,
  options: { page?: number; pageSize?: number; provider?: string; range?: RunRange } = {},
): Promise<{ runs: Array<typeof evalRunSchema.$inferSelect>; page: number; hasMore: boolean }> {
  const pageSize = options.pageSize ?? EVAL_RUNS_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const filters = [eq(evalRunSchema.orgId, orgId), eq(evalRunSchema.datasetId, datasetId), ...startedWithin(options.range)];
  if (options.provider) {
    filters.push(eq(evalRunSchema.provider, options.provider));
  }
  const rows = await db
    .select()
    .from(evalRunSchema)
    .where(and(...filters))
    .orderBy(desc(evalRunSchema.startedAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { runs: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
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
 * The finished runs a dataset's pass-rate chart plots, for one period.
 *
 * Every run in the period up to {@link MAX_TREND_RUNS}, newest kept first when
 * there are more, and `truncated` says whether that happened so the page can
 * say so. The chart used to read the fifty-run list, which quietly dropped the
 * older half of a nightly dataset's history once it passed two months.
 * @param orgId - Whose runs.
 * @param datasetId - Which dataset.
 * @param range - The period. Omitted means all time.
 */
export async function listRunTrend(orgId: string, datasetId: number, range?: RunRange) {
  const rows = await db
    .select({
      id: evalRunSchema.id,
      provider: evalRunSchema.provider,
      startedAt: evalRunSchema.startedAt,
      datasetVersion: evalRunSchema.datasetVersion,
      metrics: evalRunSchema.metrics,
    })
    .from(evalRunSchema)
    .where(and(
      eq(evalRunSchema.orgId, orgId),
      eq(evalRunSchema.datasetId, datasetId),
      // Only finished runs carry a pass rate; a running or failed one has
      // nothing to plot and must not be drawn as a zero.
      eq(evalRunSchema.status, 'succeeded'),
      ...startedWithin(range),
    ))
    .orderBy(desc(evalRunSchema.startedAt))
    .limit(MAX_TREND_RUNS + 1);
  return { runs: rows.slice(0, MAX_TREND_RUNS), truncated: rows.length > MAX_TREND_RUNS };
}

/** The headline numbers for one dataset over one period. */
export type RunPeriodSummary = {
  /** Every run that started in the period, whatever its status or grader. */
  runCount: number;
  /** Finished runs, scored by the dataset's current grader, that have a pass rate. */
  scoredCount: number;
  /** Mean pass rate of those scored runs, 0–1; null when there are none. */
  averagePassRate: number | null;
  /** The newest of those scored runs' pass rate, 0–1; null when there are none. */
  latestPassRate: number | null;
};

/**
 * The numbers above a dataset's chart, for one period, counted in SQL.
 *
 * The averages cover only runs scored by `provider`, the dataset's current
 * grader: two graders score the same answers differently, and a mean across
 * both is a number neither of them produced. The run count covers every run,
 * because "how often did this run" does not depend on who graded it.
 * @param orgId - Whose runs.
 * @param datasetId - Which dataset.
 * @param provider - The grader whose pass rates to average.
 * @param range - The period. Omitted means all time.
 */
export async function summariseRunPeriod(orgId: string, datasetId: number, provider: string, range?: RunRange): Promise<RunPeriodSummary> {
  const passRate = sql<number>`(${evalRunSchema.metrics}->>'passRate')::float8`;
  const scored = and(
    eq(evalRunSchema.provider, provider),
    eq(evalRunSchema.status, 'succeeded'),
    sql`jsonb_typeof(${evalRunSchema.metrics}->'passRate') = 'number'`,
  );
  const inPeriod = and(eq(evalRunSchema.orgId, orgId), eq(evalRunSchema.datasetId, datasetId), ...startedWithin(range));

  const [totals] = await db
    .select({
      runCount: count(),
      scoredCount: sql<number>`count(*) filter (where ${scored})`.mapWith(Number),
      averagePassRate: sql<string | null>`avg(${passRate}) filter (where ${scored})`,
    })
    .from(evalRunSchema)
    .where(inPeriod);
  const [latest] = await db
    .select({ passRate })
    .from(evalRunSchema)
    .where(and(inPeriod, scored))
    .orderBy(desc(evalRunSchema.startedAt))
    .limit(1);

  // `avg` comes back as a string from both drivers.
  return {
    runCount: totals?.runCount ?? 0,
    scoredCount: totals?.scoredCount ?? 0,
    averagePassRate: totals?.averagePassRate === null || totals?.averagePassRate === undefined ? null : Number(totals.averagePassRate),
    latestPassRate: latest ? Number(latest.passRate) : null,
  };
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
      // A retired evaluator grades nothing, so its last sync error is history,
      // not a problem anyone still has to fix.
      isNull(evalEvaluatorSchema.retiredAt),
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

/**
 * One number per run per evaluator, for the trend lines.
 *
 * The aggregate pass rate answers "is this dataset getting better"; this
 * answers "which part of it is". An agent whose answers improve while its tool
 * use gets worse holds a flat pass rate the whole way, and only a line per
 * evaluator shows that.
 *
 * Only evaluators that return a number are here: a categorical verdict like
 * "Perfectly Correct" has no position on a 0–1 axis, and inventing one would
 * put a made-up number on a chart people read for trends.
 * @param orgId - Whose workspace.
 * @param datasetId - Which dataset.
 * @param range - Only runs that started inside this period. Omitted means all time.
 */
export async function listEvaluatorTrend(orgId: string, datasetId: number, range?: RunRange) {
  const rows = await db
    .select({
      runId: evalRunSchema.id,
      provider: evalRunSchema.provider,
      evaluatorSlug: evalScoreSchema.evaluatorSlug,
      startedAt: evalRunSchema.startedAt,
      datasetVersion: evalRunSchema.datasetVersion,
      meanValue: avg(evalScoreSchema.value),
    })
    .from(evalScoreSchema)
    .innerJoin(evalRunSchema, eq(evalScoreSchema.runId, evalRunSchema.id))
    .where(and(
      eq(evalRunSchema.orgId, orgId),
      eq(evalRunSchema.datasetId, datasetId),
      eq(evalRunSchema.status, 'succeeded'),
      isNotNull(evalScoreSchema.value),
      ...startedWithin(range),
    ))
    .groupBy(
      evalRunSchema.id,
      evalRunSchema.provider,
      evalScoreSchema.evaluatorSlug,
      evalRunSchema.startedAt,
      evalRunSchema.datasetVersion,
    )
    .orderBy(asc(evalRunSchema.startedAt));

  // `avg` comes back as a string from both drivers, and a NULL average would
  // mean a group with no numbers in it — which the NOT NULL filter rules out,
  // so a row that still has none is dropped rather than plotted as zero.
  return rows
    .filter(row => row.meanValue !== null)
    .map(row => ({
      runId: row.runId,
      provider: row.provider,
      evaluatorSlug: row.evaluatorSlug,
      startedAt: row.startedAt,
      datasetVersion: row.datasetVersion,
      meanValue: Number(row.meanValue),
    }))
    .filter(row => Number.isFinite(row.meanValue));
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

/**
 * Someone asked for a grader that does not exist.
 *
 * Its own type so the HTTP layer can answer 400 rather than 500: a typo in a
 * provider id is the caller's mistake, and a 5xx would page whoever watches
 * the error rate for it.
 */
export class UnknownEvalProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownEvalProviderError';
  }
}

/**
 * The grader a dataset names cannot run right now.
 *
 * Almost always an AWS credential that is missing, expired or pointing at a
 * region without AgentCore Evaluations. Raised before any case executes, so
 * nobody pays for a run that could never have been scored.
 */
export class EvalProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalProviderUnavailableError';
  }
}

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

export async function runDataset(opts: RunDatasetOptions): Promise<{
  runId: number;
  metrics: typeof evalRunSchema.$inferSelect['metrics'];
  /**
   * The pass rate this dataset asked to be held to, or null when it named
   * none. Returned because the caller deciding pass or fail — the CLI, which
   * turns it into an exit code — has no other way to learn it without going
   * back to the database for a row this call already read.
   */
  passThreshold: number | null;
}> {
  const result = await runDatasetAndScore(opts);
  const [row] = await db
    .select({ metrics: evalRunSchema.metrics })
    .from(evalRunSchema)
    .where(eq(evalRunSchema.id, result.run.runId));
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  return {
    runId: result.run.runId,
    metrics: row?.metrics ?? {},
    passThreshold: dataset?.passThreshold ?? null,
  };
}

export type RunDatasetAndScoreOptions = RunDatasetOptions & {
  /**
   * Ties this execution's run row to the workflow that started it. A retry
   * reuses it and so reuses the run row, instead of adding a second point to
   * the trend line for work that happened once.
   */
  runGroupId?: string | null;
  /** How many cases to execute at once. Defaults to `DEFAULT_CASE_CONCURRENCY`. */
  concurrency?: number;
};

export type RunDatasetAndScoreResult = {
  runGroupId: string | null;
  run: ProviderRunResult;
  /**
   * The AgentCore batch evaluation started for this run, when one was. Null is
   * the ordinary case — batch evaluation is opt-in per deployment. The caller
   * polls it; it is running on AWS by the time this returns.
   */
  batchJobId: number | null;
};

/**
 * Execute a dataset once and score it with the grader the dataset names.
 *
 * One grader per dataset, taken from `eval_dataset.provider` and authored in
 * the workspace file. Two graders scoring the same cases produced two numbers
 * that disagreed with nothing to say which was right, and a run list that read
 * as if the agent had been tested twice. Comparing graders is still possible —
 * copy the dataset, point the copy at the other grader — but then it is a
 * thing someone set up, with its own history and its own trend line.
 * @param opts - The dataset, and how hard to push.
 */
export async function runDatasetAndScore(
  opts: RunDatasetAndScoreOptions,
): Promise<RunDatasetAndScoreResult> {
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  if (!dataset) {
    throw new Error(`dataset ${opts.datasetSlug} not found for org ${opts.orgId}`);
  }
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);
  const provider = await resolveDatasetProvider(opts.orgId, dataset.provider);

  const items = (dataset.items ?? []) as EvalDatasetItem[];
  const modelOverride = opts.modelOverride
    ? { model: opts.modelOverride, ...(opts.providerOverride ? { provider: opts.providerOverride } : {}) }
    : undefined;

  // Before anything costs a model call, make sure the grader is holding the
  // cases this dataset now declares. Usually a hash comparison and nothing
  // else. A failure here is recorded and the run continues: the scores do not
  // depend on the published copy, so refusing to measure would be the larger
  // loss — the same call the evaluator sync already makes.
  await syncDatasetToProvider(opts.orgId, {
    id: dataset.id,
    slug: dataset.slug,
    name: dataset.name,
    description: dataset.description ?? null,
    items,
  }, provider);

  const transcripts = await produceTranscripts({
    orgId: opts.orgId,
    agentSlug: dataset.agentSlug,
    datasetSlug: dataset.slug,
    items,
    modelOverride,
    concurrency: opts.concurrency,
  });

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

  const runId = await createRun(shared, provider.id);
  await persistTranscripts(runId, transcripts);

  const run = await scoreWithProvider({ ...shared, provider, existingRunId: runId });
  await recordEvalEpisode(opts.orgId, dataset.slug, dataset.agentSlug, run);

  // The audit trail, started here because this is the only place the finished
  // transcripts and their ground truth are both in hand. It grades the spans
  // the agent really emitted, in the customer's own account, so the score is
  // checkable by someone who does not have Vocion.
  //
  // Opt-in, and deliberately not on by default: it bills the customer's AWS
  // account per token graded, and it only works at all once the agent runtime
  // is deployed with tracing on. Off, everything above is unchanged.
  const batchJobId = await maybeStartBatch(opts.orgId, dataset.slug, provider.id, runId, transcripts);

  return { runGroupId: opts.runGroupId ?? null, run, batchJobId };
}

/**
 * Start an AgentCore batch evaluation for this run, when one is wanted.
 *
 * Returns the job row's id when a job was started, and null otherwise — which
 * is the ordinary case. Null means one of: the deployment has not turned batch
 * evaluation on, this dataset is graded by someone other than AgentCore, or
 * the org has no AWS credential connected.
 *
 * Never throws. The on-demand scores are already written by the time this
 * runs, and losing the second opinion must not turn a finished run into a
 * failed one.
 * @param orgId - Whose workspace.
 * @param datasetSlug - The dataset that just ran.
 * @param providerId - The grader that scored it.
 * @param runId - The run to attach the job to.
 * @param transcripts - The finished cases, with their ground truth.
 */
async function maybeStartBatch(
  orgId: string,
  datasetSlug: string,
  providerId: string,
  runId: number,
  transcripts: CaseTranscript[],
): Promise<number | null> {
  if (process.env.VOCION_AGENTCORE_BATCH_EVALS !== '1' || providerId !== 'agentcore') {
    return null;
  }
  try {
    const { startBatchForRun } = await import('./evals/batch');
    return await startBatchForRun({ orgId, runId, datasetSlug, transcripts });
  } catch (error) {
    console.error(`[evals] could not start the batch evaluation for run ${runId}`, error);
    return null;
  }
}

/**
 * The grader this dataset names, if it can actually run.
 *
 * Both failures are loud rather than quiet. A grader this build has never
 * heard of is a workspace file from a newer version, and silently falling back
 * to our own judge would hand someone AWS scores they never got. A grader that
 * cannot run — usually an AWS credential that is missing, expired or in the
 * wrong region — is worth one clear sentence before any case executes, rather
 * than a run that burns the model calls and then fails at scoring time.
 * @param orgId - Whose credentials decide availability.
 * @param providerId - The dataset's grader.
 */
async function resolveDatasetProvider(orgId: string, providerId: string): Promise<EvalScoreProvider> {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new UnknownEvalProviderError(`unknown eval score provider: ${providerId}`);
  }
  const availability = await provider.isAvailable(orgId);
  if (!availability.available) {
    throw new EvalProviderUnavailableError(
      `${provider.label} cannot grade this dataset right now: ${availability.reason}`,
    );
  }
  return provider;
}

/**
 * The run row for this execution. Reused on a retry via the run group.
 * @param shared - Everything the row records about what is being run.
 * @param providerId - The grader this dataset uses.
 */
async function createRun(
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
 * workflow is handed the same `runGroupId`, so its own `createRun` finds this
 * row and fills it in instead of opening a second one.
 * @param opts - Which dataset, under which run group.
 * @param opts.orgId - Whose dataset.
 * @param opts.datasetSlug - Which dataset.
 * @param opts.runGroupId - The workflow id this run belongs to.
 */
export async function createRefreshRun(opts: {
  orgId: string;
  datasetSlug: string;
  runGroupId: string;
}): Promise<{ runId: number; providerId: string }> {
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  if (!dataset) {
    throw new Error(`dataset ${opts.datasetSlug} not found for org ${opts.orgId}`);
  }
  const provider = await resolveDatasetProvider(opts.orgId, dataset.provider);
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);

  const runId = await createRun({
    orgId: opts.orgId,
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    datasetVersion: dataset.version ?? null,
    agentSlug: dataset.agentSlug,
    workspaceSha: workspaceSha ?? null,
    model: null,
    runGroupId: opts.runGroupId,
    transcripts: [],
  }, provider.id);

  return { runId, providerId: provider.id };
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
