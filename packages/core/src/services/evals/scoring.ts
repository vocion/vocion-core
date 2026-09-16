/**
 * Writing scores down.
 *
 * One execution produces one set of transcripts. Each provider that grades
 * them gets its own `eval_run` row, so "how is AgentCore rating us over time"
 * and "how is our own judge rating us over time" are two separate histories
 * that happen to be about the same runs. They share a `runGroupId`, which is
 * what says the two were scoring the same work rather than two different
 * executions that happened to be close together.
 *
 * The transcripts themselves live under the primary run and are not copied per
 * provider — a second provider scoring the same cases does not double the
 * stored text, it just points its scores at the same case rows.
 *
 * Nothing here ever updates a score. A score is a measurement of one execution
 * at one moment; rewriting it to show the latest number destroys the history
 * the trend line is made of. Re-scoring means a new run.
 */

import type { EvalScoreProvider } from './providers/types';
import type { CaseTranscript } from './transcripts';
import type { ProviderScore } from './types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { evalCaseResultSchema, evalRunSchema, evalScoreSchema } from '@/models/Schema';

/** What one provider's scoring produced. */
export type ProviderRunResult = {
  providerId: string;
  runId: number;
  scoreCount: number;
  /** Set when the provider threw. The run is marked failed, not scored zero. */
  error: string | null;
};

export type ScoreWithProviderOptions = {
  orgId: string;
  datasetId: number;
  datasetSlug: string;
  datasetVersion: number | null;
  agentSlug: string;
  workspaceSha: string | null;
  model: string | null;
  runGroupId: string | null;
  transcripts: CaseTranscript[];
  provider: EvalScoreProvider;
  /**
   * Reuse this run row instead of creating one. The primary run already
   * exists because it owns the transcripts; secondary providers get their own.
   */
  existingRunId?: number;
};

/**
 * Map a case index back to the row id its transcript was stored as.
 * @param transcripts
 * @param itemIndex
 */
function caseResultIdFor(transcripts: CaseTranscript[], itemIndex: number | undefined): number | null {
  if (itemIndex === undefined) {
    return null;
  }
  return transcripts.find(transcript => transcript.itemIndex === itemIndex)?.caseResultId ?? null;
}

/**
 * Roll a provider's scores into the numbers the dashboard reads.
 *
 * Pass rate counts only scores that carry a verdict this provider means as
 * pass or fail. An evaluator that errored is excluded from both sides rather
 * than counted as a failure, because "could not be scored" is not "scored
 * badly" and a run where AWS was down should not read as a quality drop.
 * @param scores - Everything this provider said.
 * @param transcripts - Used for latency and cost, which belong to the run.
 */
export function summarizeProviderScores(scores: ProviderScore[], transcripts: CaseTranscript[]) {
  const graded = scores.filter(score => !score.errorCode && score.label !== null && score.label !== undefined);
  const passed = graded.filter(score => score.label === 'pass').length;
  const failed = graded.filter(score => score.label === 'fail').length;

  let judgeInputTokens = 0;
  let judgeOutputTokens = 0;
  for (const score of scores) {
    judgeInputTokens += score.tokenUsage?.inputTokens ?? 0;
    judgeOutputTokens += score.tokenUsage?.outputTokens ?? 0;
  }

  const latencies = transcripts.map(transcript => transcript.latencyMs);
  const agentCents = transcripts.reduce((total, transcript) => total + (transcript.usage?.cents ?? 0), 0);
  const toolCallCount = transcripts.reduce((total, transcript) => total + transcript.trajectory.length, 0);

  return {
    passRate: graded.length > 0 ? passed / graded.length : 0,
    passed,
    failed,
    toolCallCount,
    medianLatencyMs: median(latencies),
    totalCents: round4(agentCents),
    totalInputTokens: transcripts.reduce((total, t) => total + (t.usage?.inputTokens ?? 0), 0),
    totalOutputTokens: transcripts.reduce((total, t) => total + (t.usage?.outputTokens ?? 0), 0),
    meanTurns: meanTurns(transcripts),
    costPerPassedCaseCents: passed > 0 ? round4(agentCents / passed) : null,
    judgeInputTokens,
    judgeOutputTokens,
  };
}

/**
 * Grade the transcripts with one provider and record the result.
 *
 * A provider that throws leaves a failed run rather than no run. Someone
 * looking at the page needs to see that AgentCore was asked and could not
 * answer; silence would read as nobody having tried.
 * @param options - The run's identity, its transcripts, and who is grading.
 */
export async function scoreWithProvider(options: ScoreWithProviderOptions): Promise<ProviderRunResult> {
  const runId = options.existingRunId ?? await createProviderRun(options);

  let scores: ProviderScore[];
  try {
    scores = await options.provider.score({
      orgId: options.orgId,
      datasetSlug: options.datasetSlug,
      agentSlug: options.agentSlug,
      transcripts: options.transcripts,
    });
  } catch (error) {
    const message = (error as Error).message ?? `${options.provider.id} scoring failed`;
    console.error(`[evals] ${options.provider.id} could not score ${options.datasetSlug}`, error);
    await db
      .update(evalRunSchema)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(evalRunSchema.id, runId));
    return { providerId: options.provider.id, runId, scoreCount: 0, error: message };
  }

  await persistScores(runId, options.provider.id, scores, options.transcripts);

  await db
    .update(evalRunSchema)
    .set({
      status: 'succeeded',
      metrics: summarizeProviderScores(scores, options.transcripts),
      completedAt: new Date(),
    })
    .where(eq(evalRunSchema.id, runId));

  return { providerId: options.provider.id, runId, scoreCount: scores.length, error: null };
}

/**
 * Create the run row this provider's scores hang off.
 *
 * When a `runGroupId` is set, a retried workflow activity finds the run it
 * already created instead of making a second one — the unique index on
 * (run_group_id, provider) is what stops an at-least-once retry adding a
 * phantom point to the trend line.
 * @param options - Everything identifying the run.
 */
async function createProviderRun(options: ScoreWithProviderOptions): Promise<number> {
  if (options.runGroupId) {
    const [existing] = await db
      .select({ id: evalRunSchema.id })
      .from(evalRunSchema)
      .where(and(
        eq(evalRunSchema.runGroupId, options.runGroupId),
        eq(evalRunSchema.provider, options.provider.id),
      ));
    if (existing) {
      return existing.id;
    }
  }

  const [run] = await db
    .insert(evalRunSchema)
    .values({
      orgId: options.orgId,
      datasetId: options.datasetId,
      agentSlug: options.agentSlug,
      workspaceSha: options.workspaceSha,
      model: options.model,
      provider: options.provider.id,
      datasetVersion: options.datasetVersion,
      runGroupId: options.runGroupId,
      status: 'running',
    })
    .returning({ id: evalRunSchema.id });
  if (!run) {
    throw new Error(`failed to create an eval_run row for ${options.provider.id}`);
  }
  return run.id;
}

/**
 * Write the score rows, and mirror the Vocion judge's verdict onto the case.
 *
 * The mirror exists because `modelUpgradeTest` reads `eval_case_result.score`,
 * `verdict` and `rationale` directly. Keeping those columns written exactly as
 * before means that comparison keeps working untouched while everything new
 * reads `eval_score`. It is two places holding one fact, which is a debt, and
 * it is written down as one.
 * @param runId - The provider's run.
 * @param providerId - Stamped on every score.
 * @param scores - What the provider said.
 * @param transcripts - Used to resolve a case index to its row id.
 */
async function persistScores(
  runId: number,
  providerId: string,
  scores: ProviderScore[],
  transcripts: CaseTranscript[],
): Promise<void> {
  if (scores.length === 0) {
    return;
  }

  await db.insert(evalScoreSchema).values(scores.map(score => ({
    runId,
    caseResultId: caseResultIdFor(transcripts, score.itemIndex),
    provider: providerId,
    evaluatorSlug: score.evaluatorSlug,
    evaluatorName: score.evaluatorName ?? null,
    evaluatorArn: score.evaluatorArn ?? null,
    level: score.level,
    value: score.value ?? null,
    label: score.label ?? null,
    explanation: score.explanation ?? null,
    tokenUsage: score.tokenUsage ?? null,
    errorCode: score.errorCode ?? null,
    errorMessage: score.errorMessage ?? null,
  })));

  if (providerId !== 'vocion') {
    return;
  }
  for (const score of scores) {
    if (score.evaluatorSlug !== 'vocion:judge') {
      continue;
    }
    const caseResultId = caseResultIdFor(transcripts, score.itemIndex);
    if (!caseResultId) {
      continue;
    }
    await db
      .update(evalCaseResultSchema)
      .set({
        score: (score.value ?? 0).toFixed(3),
        verdict: score.label ?? 'error',
        rationale: score.explanation ?? null,
      })
      .where(eq(evalCaseResultSchema.id, caseResultId));
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function meanTurns(transcripts: CaseTranscript[]): number {
  const withUsage = transcripts.filter(transcript => transcript.usage);
  if (withUsage.length === 0) {
    return 0;
  }
  const total = withUsage.reduce((sum, transcript) => sum + (transcript.usage?.turns ?? 0), 0);
  return round4(total / withUsage.length);
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
