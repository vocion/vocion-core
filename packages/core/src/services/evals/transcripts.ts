/**
 * Running the agent, separated from grading it.
 *
 * Scoring used to happen in the same loop as execution, which meant anything
 * added to the judge fired for every caller of `runDataset` — including
 * `LearningCandidateService`, which runs a dataset automatically after a rule
 * is adopted with nobody watching, and `modelUpgradeTest`, which runs one
 * twice and compares the cost. Adding a paid AWS scorer to that loop would
 * have billed a background pipeline and corrupted the number the model-upgrade
 * test exists to produce.
 *
 * So execution produces transcripts and stops. Who grades them, and whether
 * anyone does, is a separate decision made by the caller.
 *
 * The transcript carries the ordered tool calls, not just their count. That
 * ordering is what AgentCore's trajectory evaluators compare against an
 * expected sequence, and it is the only thing AgentCore scores without a model
 * call. `usage.toolCalls` kept a count, which cannot tell "looked up the order,
 * then refunded" from "refunded, then looked up".
 */

import type { EvalDatasetItem } from './types';
import type { LangChainProvider } from '@/libs/llm';
import { eq } from 'drizzle-orm';
import { mapWithConcurrency } from '@/libs/concurrency';
import { db } from '@/libs/DB';
import { evalCaseResultSchema } from '@/models/Schema';
import { runAgentDeep } from '../AgentService';
import { evalCaseSessionId } from './sessionIds';

/**
 * How many cases run at once.
 *
 * Bounded for rate limits, not for money — the spend is the same whether the
 * cases run one at a time or eight at a time, but an unbounded fan-out earns
 * 429s from the model provider and turns into retries, which is slower than
 * the sequential run it replaced. Matches `MAX_CONCURRENT_INGESTS` in
 * `SourceSyncService`, which solved the same problem for document ingest.
 */
export const DEFAULT_CASE_CONCURRENCY = 8;

/** One tool the agent called, in the order it called it. */
export type ToolCallRecord = {
  tool: string;
  input: Record<string, unknown>;
  output: string;
};

/** What one case did, before anyone has an opinion about whether it was good. */
export type CaseTranscript = {
  itemIndex: number;
  item: EvalDatasetItem;
  /** The agent's final answer. Empty when the run threw. */
  output: string;
  /** Ordered tool calls. Empty when the run threw, never undefined. */
  toolCalls: ToolCallRecord[];
  /** Just the tool names, in order — what trajectory evaluators compare. */
  trajectory: string[];
  traceId: string | null;
  latencyMs: number;
  /** True when the agent run threw. `output` is meaningless in that case. */
  errored: boolean;
  errorMessage: string;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cents: number;
    turns: number;
    toolCalls: number;
  } | null;
  /** Set once the row is written, so scores can point at the right case. */
  caseResultId: number | null;
};

/** Everything one case needs, so the worker closes over nothing. */
type CaseJob = {
  orgId: string;
  agentSlug: string;
  datasetSlug: string;
  itemIndex: number;
  item: EvalDatasetItem;
  modelOverride: { model: string; provider?: LangChainProvider } | undefined;
  promptCache: boolean;
};

export type ProduceTranscriptsOptions = {
  orgId: string;
  agentSlug: string;
  /** Names the session each case's spans land under. See `sessionIds.ts`. */
  datasetSlug: string;
  items: EvalDatasetItem[];
  modelOverride?: { model: string; provider?: LangChainProvider };
  /** Defaults to `DEFAULT_CASE_CONCURRENCY`. */
  concurrency?: number;
  /**
   * Whether cases ask the vendor to cache the prompt prefix. On by default:
   * an eval case is a long tool-using turn that re-sends whatever it fetched
   * on every later turn, so the same page is billed again and again. One
   * measured case on a 240 KB listing spent 912,786 input tokens over 13
   * turns, and a run of those took an AWS account past its daily Bedrock
   * token quota. An agent whose harness block sets `promptCache` still wins.
   */
  promptCache?: boolean;
};

/**
 * Run one case and describe what happened.
 *
 * Catches its own failures rather than throwing, because one case that blows
 * up must not abandon the rest of the dataset — a run where forty-nine cases
 * passed and one threw is a useful result, and losing it teaches nobody
 * anything.
 * @param job - The case and everything needed to run it.
 */
async function runCase(job: CaseJob): Promise<CaseTranscript> {
  const startedAt = Date.now();
  try {
    const result = await runAgentDeep({
      orgId: job.orgId,
      agentSlug: job.agentSlug,
      message: job.item.input,
      userId: 'eval-runner',
      modelOverride: job.modelOverride,
      promptCache: job.promptCache,
      // Names the session this case's spans land under, so a batch job can
      // address its expected answer to the same session the on-demand path
      // synthesizes. Without it every case in the dataset shares one session.
      sessionId: evalCaseSessionId(job.datasetSlug, job.itemIndex),
    });
    const toolCalls = result.toolCalls ?? [];
    return {
      itemIndex: job.itemIndex,
      item: job.item,
      output: result.response,
      toolCalls,
      trajectory: toolCalls.map(call => call.tool),
      traceId: result.traceId || null,
      latencyMs: Date.now() - startedAt,
      errored: false,
      errorMessage: '',
      usage: result.usage ? { ...result.usage, toolCalls: toolCalls.length } : null,
      caseResultId: null,
    };
  } catch (error) {
    const errorMessage = (error as Error).message ?? 'agent run failed';
    console.error(`[evals] case ${job.itemIndex} of ${job.agentSlug} failed to run`, error);
    return {
      itemIndex: job.itemIndex,
      item: job.item,
      output: '',
      toolCalls: [],
      trajectory: [],
      traceId: null,
      latencyMs: Date.now() - startedAt,
      errored: true,
      errorMessage,
      usage: null,
      caseResultId: null,
    };
  }
}

/**
 * Execute every case in a dataset and return what each one did.
 *
 * Nothing here judges anything, and nothing here is written to the database —
 * see `persistTranscripts`, which needs a run row to attach them to.
 * @param options - Which agent, which cases, and how hard to push.
 */
export async function produceTranscripts(options: ProduceTranscriptsOptions): Promise<CaseTranscript[]> {
  const jobs: CaseJob[] = options.items.map((item, itemIndex) => ({
    orgId: options.orgId,
    agentSlug: options.agentSlug,
    datasetSlug: options.datasetSlug,
    itemIndex,
    item,
    modelOverride: options.modelOverride,
    // On unless the caller says otherwise. The agent's own harness block is
    // the other place this can be turned off, and it wins over this.
    promptCache: options.promptCache ?? true,
  }));
  return mapWithConcurrency(jobs, options.concurrency ?? DEFAULT_CASE_CONCURRENCY, runCase);
}

/**
 * Write the transcripts as `eval_case_result` rows and remember their ids.
 *
 * Clears the run's existing case rows first, because this can run twice. A
 * Temporal activity is at-least-once, and a retry reuses the same run through
 * its run group — so a blind insert would leave that run holding two rows per
 * case, and the run page reads every row by run id with nothing to tell the
 * copies apart. Deleting first is safe: the rows being replaced belong to the
 * attempt that died, and the scores that pointed at them died with it.
 *
 * One delete and one insert inside a transaction, rather than a statement per
 * case: a crash partway through used to leave a run holding half its cases
 * with no way to roll back.
 *
 * The grade columns (`score`, `verdict`, `rationale`) stay empty here. They are
 * filled by the Vocion provider, which still writes them so `modelUpgradeTest`
 * — which reads those columns directly — keeps working untouched.
 * @param runId - The run that owns these transcripts.
 * @param transcripts - Mutated in place to record each row's id.
 */
export async function persistTranscripts(runId: number, transcripts: CaseTranscript[]): Promise<void> {
  if (transcripts.length === 0) {
    return;
  }

  const rows = await db.transaction(async (tx) => {
    await tx.delete(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, runId));
    return tx
      .insert(evalCaseResultSchema)
      .values(transcripts.map(transcript => ({
        runId,
        itemIndex: transcript.itemIndex,
        input: transcript.item.input,
        output: transcript.errored ? null : transcript.output,
        traceId: transcript.traceId,
        latencyMs: transcript.latencyMs,
        usage: transcript.usage,
        trajectory: transcript.trajectory,
      })))
      .returning({ id: evalCaseResultSchema.id, itemIndex: evalCaseResultSchema.itemIndex });
  });

  // Matched on itemIndex rather than position: `returning` gives no ordering
  // guarantee, and a score pointed at the wrong case is worse than no score.
  const idByItemIndex = new Map(rows.map(row => [row.itemIndex, row.id]));
  for (const transcript of transcripts) {
    transcript.caseResultId = idByItemIndex.get(transcript.itemIndex) ?? null;
  }
}
