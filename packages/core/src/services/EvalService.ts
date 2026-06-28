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
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModel } from '@/libs/llm';
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

export async function runDataset(opts: {
  orgId: string;
  datasetSlug: string;
}): Promise<{ runId: number; metrics: typeof evalRunSchema.$inferSelect['metrics'] }> {
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
      status: 'running',
    })
    .returning();
  if (!run) {
    throw new Error('failed to create eval_run row');
  }

  const judge = buildChatModel('classifier', { temperature: 0 });
  const items = dataset.items ?? [];
  const latencies: number[] = [];
  let toolCallCount = 0;
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const startedAt = Date.now();
    let agentResp = '';
    let traceId = '';
    let errored = false;
    let errorMessage = '';

    try {
      const result = await runAgentDeep({
        orgId: opts.orgId,
        agentSlug: dataset.agentSlug,
        message: item.input,
        userId: 'eval-runner',
      });
      agentResp = result.response;
      traceId = result.traceId;
      toolCallCount += result.toolCalls.length;
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
    });
  }

  const metrics = {
    passRate: items.length > 0 ? passed / items.length : 0,
    toolCallCount,
    medianLatencyMs: median(latencies),
    failed,
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

  return { runId: run.id, metrics: updated?.metrics ?? metrics };
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

async function scoreOne(
  judge: ReturnType<typeof buildChatModel>,
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
