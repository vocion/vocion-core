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

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LangChainProvider } from '@/libs/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModelForOrg } from '@/libs/llm';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { evalCaseResultSchema, evalDatasetSchema, evalRunSchema } from '@/models/Schema';
import { runAgentDeep } from './AgentService';

const JUDGE_SYSTEM = `You are an evaluation judge for AI agent outputs.

Given:
  - The user's input.
  - The agent's response.
  - An optional rubric describing what "good" looks like.
  - An optional expected output (treat as guidance, not a literal match — substantive equivalence is fine).

Return STRICT JSON:
  {"verdict": "pass" | "fail" | "error", "score": 0.0..1.0, "rationale": "..."}

Pass when the response satisfies the rubric and is substantively equivalent to the expected output (when given). Score reflects quality within the verdict (0.6+ for pass, <0.5 for fail). The rationale should be one tight sentence the engineer can act on.`;

const JudgeOutputZ = z.object({
  verdict: z.enum(['pass', 'fail', 'error']),
  score: z.number().min(0).max(1),
  rationale: z.string(),
});

export type JudgeOutput = z.infer<typeof JudgeOutputZ>;

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

export async function listRuns(orgId: string, datasetId?: number) {
  const rows = await db
    .select()
    .from(evalRunSchema)
    .where(eq(evalRunSchema.orgId, orgId))
    .orderBy(desc(evalRunSchema.startedAt))
    .limit(50);
  return datasetId ? rows.filter(r => r.datasetId === datasetId) : rows;
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
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  if (!dataset) {
    throw new Error(`dataset ${opts.datasetSlug} not found for org ${opts.orgId}`);
  }
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId).catch(() => null);

  const [run] = await db
    .insert(evalRunSchema)
    .values({
      orgId: opts.orgId,
      datasetId: dataset.id,
      agentSlug: dataset.agentSlug,
      workspaceSha: workspaceSha ?? null,
      model: opts.modelOverride ?? null,
      status: 'running',
    })
    .returning();
  if (!run) {
    throw new Error('failed to create eval_run row');
  }

  const judge = await buildChatModelForOrg('classifier', opts.orgId, { temperature: 0 });
  const items = dataset.items ?? [];
  const latencies: number[] = [];
  const modelOverride = opts.modelOverride
    ? { model: opts.modelOverride, ...(opts.providerOverride ? { provider: opts.providerOverride } : {}) }
    : undefined;
  let toolCallCount = 0;
  let passed = 0;
  let failed = 0;
  let totalCents = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTurns = 0;
  let casesWithUsage = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const startedAt = Date.now();
    let agentResp = '';
    let traceId = '';
    let errored = false;
    let errorMessage = '';
    let caseUsage: CaseUsage | null = null;

    try {
      const result = await runAgentDeep({
        orgId: opts.orgId,
        agentSlug: dataset.agentSlug,
        message: item.input,
        userId: 'eval-runner',
        modelOverride,
      });
      agentResp = result.response;
      traceId = result.traceId;
      toolCallCount += result.toolCalls.length;
      if (result.usage) {
        caseUsage = { ...result.usage, toolCalls: result.toolCalls.length };
        totalCents += result.usage.cents;
        totalInputTokens += result.usage.inputTokens;
        totalOutputTokens += result.usage.outputTokens;
        totalTurns += result.usage.turns;
        casesWithUsage += 1;
      }
    } catch (err) {
      errored = true;
      errorMessage = (err as Error).message ?? 'agent run failed';
    }

    const latencyMs = Date.now() - startedAt;
    latencies.push(latencyMs);

    let verdict: JudgeOutput['verdict'] = 'error';
    let score = 0;
    let rationale = errorMessage || 'no judgment';

    if (!errored) {
      const judgeOutput = await scoreOne(judge, {
        input: item.input,
        response: agentResp,
        rubric: item.rubric,
        expectedOutput: item.expectedOutput,
        orgId: opts.orgId,
        datasetSlug: dataset.slug,
        itemIndex: i,
      });
      verdict = judgeOutput.verdict;
      score = judgeOutput.score;
      rationale = judgeOutput.rationale;
    }

    if (verdict === 'pass') {
      passed++;
    } else {
      failed++;
    }

    await db.insert(evalCaseResultSchema).values({
      runId: run.id,
      itemIndex: i,
      input: item.input,
      output: errored ? null : agentResp,
      score: score.toFixed(3),
      verdict,
      rationale,
      traceId: traceId || null,
      latencyMs,
      usage: caseUsage,
    });
  }

  const metrics = {
    passRate: items.length > 0 ? passed / items.length : 0,
    toolCallCount,
    medianLatencyMs: median(latencies),
    failed,
    passed,
    totalCents: round4(totalCents),
    totalInputTokens,
    totalOutputTokens,
    meanTurns: casesWithUsage > 0 ? round4(totalTurns / casesWithUsage) : 0,
    costPerPassedCaseCents: passed > 0 ? round4(totalCents / passed) : null,
  };

  const [updated] = await db
    .update(evalRunSchema)
    .set({
      status: 'succeeded',
      metrics,
      completedAt: new Date(),
    })
    .where(eq(evalRunSchema.id, run.id))
    .returning();

  // Eval outcomes are episodes too — raw, TTL'd material the consolidation
  // job mines. Fire-and-forget; a failed episode must never fail the run.
  void (async () => {
    const { recordEpisode } = await import('@/services/MemoryService');
    await recordEpisode({
      orgId: opts.orgId,
      runKind: 'eval_run',
      runId: run.id,
      agentSlug: dataset.agentSlug,
      text: `Eval "${dataset.slug}" on ${dataset.agentSlug}: ${passed} passed, ${failed} failed (pass rate ${metrics.passRate ?? 'n/a'}).`,
    });
  })().catch((error) => {
    console.error(`[EvalService] could not record an episode for eval run ${run.id}`, error);
  });

  return { runId: run.id, metrics: updated?.metrics ?? metrics };
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

async function scoreOne(
  judge: BaseChatModel,
  ctx: {
    input: string;
    response: string;
    rubric?: string;
    expectedOutput?: string;
    orgId: string;
    datasetSlug: string;
    itemIndex: number;
  },
): Promise<JudgeOutput> {
  const user = [
    `User input: ${ctx.input}`,
    `Agent response: ${ctx.response.slice(0, 4000)}`,
    ctx.rubric ? `Rubric: ${ctx.rubric}` : '',
    ctx.expectedOutput ? `Expected (guidance): ${ctx.expectedOutput.slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n\n');

  const trace = traceFor({
    feature: FEATURES.EVAL_JUDGE,
    slug: ctx.datasetSlug,
    orgId: ctx.orgId,
    userId: 'eval-runner',
    input: { input: ctx.input, itemIndex: ctx.itemIndex },
    metadata: { itemIndex: ctx.itemIndex },
  });
  const generation = trace.generation({
    name: 'judge',
    model: 'classifier',
    input: user,
  });

  const res = await judge.invoke([
    new SystemMessage(JUDGE_SYSTEM),
    new HumanMessage(user),
  ]);
  const raw = typeof res.content === 'string'
    ? res.content
    : Array.isArray(res.content)
      ? res.content.map(c => (c as { text?: string }).text ?? '').join('')
      : '';

  const usage = (res as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number } } }).usage_metadata;
  generation.end({
    output: raw,
    usageDetails: usage
      ? cleanUsageDetails({
          input: usage.input_tokens,
          output: usage.output_tokens,
          cache_read_input_tokens: usage.input_token_details?.cache_read,
        })
      : undefined,
  });

  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const fallback = { verdict: 'error' as const, score: 0, rationale: 'judge returned non-JSON' };
    trace.update({ output: fallback });
    return fallback;
  }
  const validated = JudgeOutputZ.safeParse(parsed);
  if (!validated.success) {
    const fallback = { verdict: 'error' as const, score: 0, rationale: 'judge output failed schema validation' };
    trace.update({ output: fallback });
    return fallback;
  }
  trace.update({ output: validated.data });
  return validated.data;
}

/** The per-case usage record stored on `eval_case_result.usage`. */
export type CaseUsage = NonNullable<typeof evalCaseResultSchema.$inferSelect['usage']>;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}
