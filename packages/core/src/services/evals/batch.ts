/**
 * Driving one AgentCore batch evaluation from start to stored scores.
 *
 * Two calls, minutes apart, and a row in between that survives whatever
 * happens to the process. `startBatchForRun` writes the row and asks AWS to
 * begin; `advanceBatchJob` asks where it got to and, once it has stopped,
 * writes what it found. The waiting itself belongs to the Temporal workflow —
 * a workflow can sleep for an hour without holding anything open, and this
 * module should not know how long that is.
 *
 * Why the row is written before AWS is called, not after: the start can fail
 * having already created the job, and a job nobody has the id of keeps running
 * and keeps billing. Writing our own idempotency token first means the retry
 * reaches the same job instead of a second one.
 *
 * A batch failure never costs anyone their on-demand scores. Those are already
 * written by the time this runs, and the whole point of the batch path is a
 * second, auditable opinion — losing it is a gap in the audit trail, not a
 * lost measurement. So everything here records the failure and returns.
 */

import type { BatchProgress } from './providers/agentcoreBatch';
import type { CaseTranscript } from './transcripts';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { bedrockRegion } from '@/libs/llm/bedrockCredentials';
import { evalBatchJobSchema, evalScoreSchema } from '@/models/Schema';
import { resolveAwsCredentials } from '../ApiTokenService';
import { evaluatorIdsFor } from './providers/agentcore';
import {
  AGENTCORE_BATCH_PROVIDER,
  batchClient,
  buildBatchRequest,
  getBatchEvaluation,
  startBatchEvaluation,
} from './providers/agentcoreBatch';

/**
 * Which `service.name` the agent runtime was deployed with.
 *
 * Has to match `OTEL_RESOURCE_ATTRIBUTES` in `infra/agentcore/deploy-runtime.sh`
 * exactly. A mismatch is the quietest failure in this whole path: AWS finds no
 * sessions, grades all of them, and reports success.
 */
function spanServiceNames(): string[] {
  const configured = process.env.VOCION_AGENTCORE_SPAN_SERVICE_NAMES;
  if (configured) {
    return configured.split(',').map(name => name.trim()).filter(Boolean);
  }
  return [`vocion_agent_runtime_${process.env.VOCION_ENV ?? 'dev'}`];
}

/**
 * Which log group Transaction Search writes the runtime's spans to.
 *
 * `aws/spans` is the shared group Transaction Search uses by default, which is
 * what `infra/agentcore/provision.sh` sets up and what the runtime's exporter
 * feeds through the X-Ray OTLP endpoint.
 */
function spanLogGroups(): string[] {
  const configured = process.env.VOCION_AGENTCORE_SPAN_LOG_GROUPS;
  if (configured) {
    return configured.split(',').map(name => name.trim()).filter(Boolean);
  }
  return ['aws/spans'];
}

/** Everything needed to ask AWS to grade a run's sessions. */
export type StartBatchOptions = {
  orgId: string;
  runId: number;
  datasetSlug: string;
  transcripts: CaseTranscript[];
};

/**
 * Ask AWS to grade the spans this run's cases produced.
 *
 * Returns the job row's id when a job was started, and null when there was
 * nothing to start — no AWS credential, no case worth grading. Null is an
 * ordinary outcome, not an error: an org that has not connected AWS simply
 * does not get the batch path.
 * @param options - The run and its finished cases.
 */
export async function startBatchForRun(options: StartBatchOptions): Promise<number | null> {
  const gradable = options.transcripts.filter(transcript => !transcript.errored);
  if (gradable.length === 0) {
    return null;
  }
  const credentials = await resolveAwsCredentials(options.orgId);
  if (!credentials) {
    return null;
  }
  const region = bedrockRegion();

  // Written before AWS is called. A start that fails after creating the job
  // would otherwise leave a job running that nothing can name, poll or stop.
  const [row] = await db
    .insert(evalBatchJobSchema)
    .values({
      orgId: options.orgId,
      runId: options.runId,
      region,
      clientToken: randomUUID(),
      status: 'PENDING',
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    // Another attempt at this run already owns the job. Its poller will finish
    // it; starting a second one would grade the same sessions at full price.
    return null;
  }

  try {
    const evaluatorIds = await evaluatorIdsFor(options.orgId, options.datasetSlug, credentials, region);
    const request = buildBatchRequest({
      batchEvaluationName: `vocion-${options.datasetSlug}-run-${options.runId}`.slice(0, 100),
      evaluatorIds,
      serviceNames: spanServiceNames(),
      logGroupNames: spanLogGroups(),
      datasetSlug: options.datasetSlug,
      transcripts: gradable,
      clientToken: row.clientToken,
      description: `Vocion eval run ${options.runId} — dataset ${options.datasetSlug}`,
    });
    const started = await startBatchEvaluation(batchClient(region, credentials), request);
    await db
      .update(evalBatchJobSchema)
      .set({
        batchEvaluationId: started.batchEvaluationId,
        batchEvaluationArn: started.batchEvaluationArn,
        status: 'IN_PROGRESS',
      })
      .where(eq(evalBatchJobSchema.id, row.id));
    return row.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evals] could not start a batch evaluation for run ${options.runId}`, error);
    await db
      .update(evalBatchJobSchema)
      .set({ status: 'FAILED', failure: message, completedAt: new Date() })
      .where(eq(evalBatchJobSchema.id, row.id));
    return row.id;
  }
}

/**
 * Ask where a job got to, and write its scores if it has stopped.
 *
 * Returns true once the job will not change again, which is the workflow's
 * signal to stop polling. A job that has already stopped returns true without
 * calling AWS, so a repeated poll after a workflow retry costs nothing and
 * cannot write the scores twice.
 * @param jobId - The `eval_batch_job` row to advance.
 */
export async function advanceBatchJob(jobId: number): Promise<boolean> {
  const [job] = await db.select().from(evalBatchJobSchema).where(eq(evalBatchJobSchema.id, jobId));
  if (!job) {
    return true;
  }
  if (job.completedAt) {
    return true;
  }
  if (!job.batchEvaluationId) {
    // The start never landed. Nothing to poll and nothing coming.
    return true;
  }

  const credentials = await resolveAwsCredentials(job.orgId);
  if (!credentials) {
    await finishJob(jobId, 'FAILED', 'The AWS credential this job was started with is no longer connected.');
    return true;
  }

  let progress: BatchProgress;
  try {
    progress = await getBatchEvaluation(batchClient(job.region, credentials), job.batchEvaluationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evals] could not poll batch evaluation ${job.batchEvaluationId}`, error);
    // Deliberately not terminal. A poll can fail on a throttle or a blip while
    // the job itself is fine, and giving up here would abandon a job that is
    // still running and still being paid for. The workflow's own timeout is
    // what stops this going on forever.
    await db
      .update(evalBatchJobSchema)
      .set({ failure: message })
      .where(eq(evalBatchJobSchema.id, jobId));
    return false;
  }

  await db
    .update(evalBatchJobSchema)
    .set({
      status: progress.status,
      failure: progress.failure,
      sessionsTotal: progress.sessions.total,
      sessionsCompleted: progress.sessions.completed,
      sessionsFailed: progress.sessions.failed,
      sessionsIgnored: progress.sessions.ignored,
      outputLogGroup: progress.output?.logGroupName ?? null,
      outputLogStream: progress.output?.logStreamName ?? null,
      ...(progress.terminal ? { completedAt: new Date() } : {}),
    })
    .where(eq(evalBatchJobSchema.id, jobId));

  if (progress.terminal && progress.scores.length > 0) {
    await writeBatchScores(job.runId, progress);
  }
  return progress.terminal;
}

/**
 * Store the per-evaluator averages this job produced.
 *
 * Filed under their own provider id, never mixed with the on-demand scores: an
 * average over sessions and one case's result are different kinds of number,
 * and a page that put them on one line could not say which it was showing.
 *
 * `caseResultId` is left null because a batch score is about the whole run. The
 * per-session detail lives in the CloudWatch log group the job wrote to, which
 * is recorded on the job row for a person to open.
 * @param runId - The run these scores belong to.
 * @param progress - The finished job.
 */
async function writeBatchScores(runId: number, progress: BatchProgress): Promise<void> {
  // Clear first: a workflow retry can reach a job that already wrote its
  // scores, and a blind insert would leave the run holding each average twice
  // with nothing to tell the copies apart.
  await db
    .delete(evalScoreSchema)
    .where(and(eq(evalScoreSchema.runId, runId), eq(evalScoreSchema.provider, AGENTCORE_BATCH_PROVIDER)));
  await db.insert(evalScoreSchema).values(progress.scores.map(score => ({
    runId,
    caseResultId: null,
    provider: AGENTCORE_BATCH_PROVIDER,
    evaluatorSlug: score.evaluatorSlug,
    evaluatorName: score.evaluatorName ?? null,
    level: score.level,
    value: score.value ?? null,
    label: score.label ?? null,
    explanation: score.explanation ?? null,
  })));
}

/**
 * Mark a job stopped for a reason of our own rather than AWS's.
 * @param jobId - The job row.
 * @param status - What to call it.
 * @param failure - Why.
 */
async function finishJob(jobId: number, status: string, failure: string): Promise<void> {
  await db
    .update(evalBatchJobSchema)
    .set({ status, failure, completedAt: new Date() })
    .where(eq(evalBatchJobSchema.id, jobId));
}

/** What the run page needs to point someone at the job in AWS. */
export type BatchJobSummary = {
  batchEvaluationId: string | null;
  batchEvaluationArn: string | null;
  region: string;
  status: string;
  failure: string | null;
  sessions: { total: number; completed: number; failed: number; ignored: number };
  output: { logGroupName: string; logStreamName: string } | null;
};

/**
 * The batch job for one run, if it has one.
 * @param orgId - Whose workspace.
 * @param runId - Which run.
 */
export async function describeBatchJob(orgId: string, runId: number): Promise<BatchJobSummary | null> {
  const [job] = await db
    .select()
    .from(evalBatchJobSchema)
    .where(and(eq(evalBatchJobSchema.orgId, orgId), eq(evalBatchJobSchema.runId, runId)));
  if (!job) {
    return null;
  }
  return {
    batchEvaluationId: job.batchEvaluationId,
    batchEvaluationArn: job.batchEvaluationArn,
    region: job.region,
    status: job.status,
    failure: job.failure,
    sessions: {
      total: job.sessionsTotal,
      completed: job.sessionsCompleted,
      failed: job.sessionsFailed,
      ignored: job.sessionsIgnored,
    },
    output: job.outputLogGroup && job.outputLogStream
      ? { logGroupName: job.outputLogGroup, logStreamName: job.outputLogStream }
      : null,
  };
}
