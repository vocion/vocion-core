/**
 * Driving a batch job without losing money or truth.
 *
 * The rules worth pinning here are the ones that cost something when broken: a
 * retry that grades the same sessions twice, a blip that abandons a job AWS is
 * still billing for, and a batch average filed where the page would read it as
 * a per-case score.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('../ApiTokenService', () => ({
  resolveAwsCredentials: vi.fn(async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' })),
}));
vi.mock('./providers/agentcoreBatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/agentcoreBatch')>();
  return { ...actual, getBatchEvaluation: vi.fn(), batchClient: vi.fn(() => ({})) };
});

const { db } = await import('@/libs/DB');
const { evalBatchJobSchema, evalScoreSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { getBatchEvaluation } = await import('./providers/agentcoreBatch');
const { advanceBatchJob, describeBatchJob } = await import('./batch');

const ORG = 'org_batch_eval';

/**
 * A run to hang a job off, and the job itself.
 * @param overrides - The job fields this test is about.
 */
async function seedJob(overrides: Partial<typeof evalBatchJobSchema.$inferInsert> = {}) {
  const runId = await seedRun();
  const [job] = await db.insert(evalBatchJobSchema).values({
    orgId: ORG,
    runId,
    region: 'us-west-2',
    clientToken: 'token-1',
    batchEvaluationId: 'batch-1',
    status: 'IN_PROGRESS',
    ...overrides,
  }).returning();
  return { jobId: job!.id, runId };
}

/** A minimal run row for a job to belong to. */
async function seedRun(): Promise<number> {
  const { evalDatasetSchema, evalRunSchema } = await import('@/models/Schema');
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: `refund-quality-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Refund quality',
    agentSlug: 'refunds',
    provider: 'agentcore',
    items: [],
  }).returning();
  const [run] = await db.insert(evalRunSchema).values({
    orgId: ORG,
    datasetId: dataset!.id,
    agentSlug: 'refunds',
    provider: 'agentcore',
  }).returning();
  return run!.id;
}

beforeEach(() => {
  vi.mocked(getBatchEvaluation).mockReset();
});

describe('advanceBatchJob', () => {
  it('does not call AWS for a job that already finished', async () => {
    // A workflow retry reaches a job that completed on the previous attempt.
    // Polling it again spends an API call to learn nothing, and writing its
    // scores again would leave the run holding each average twice.
    const { jobId } = await seedJob({ status: 'COMPLETED', completedAt: new Date() });

    await expect(advanceBatchJob(jobId)).resolves.toBe(true);

    expect(getBatchEvaluation).not.toHaveBeenCalled();
  });

  it('stops without polling when the job was never started', async () => {
    // The start call failed after the row was written. There is no job on
    // AWS's side, so nothing is coming and nothing is being billed.
    const { jobId } = await seedJob({ batchEvaluationId: null, status: 'FAILED' });

    await expect(advanceBatchJob(jobId)).resolves.toBe(true);

    expect(getBatchEvaluation).not.toHaveBeenCalled();
  });

  it('keeps waiting when a poll fails', async () => {
    // A throttle or a blip on the poll says nothing about the job, which is
    // still running and still being paid for. Treating it as terminal would
    // abandon a job that is about to produce a result.
    const { jobId } = await seedJob();
    vi.mocked(getBatchEvaluation).mockRejectedValueOnce(new Error('Rate exceeded'));

    await expect(advanceBatchJob(jobId)).resolves.toBe(false);

    const [job] = await db.select().from(evalBatchJobSchema).where(eq(evalBatchJobSchema.id, jobId));

    expect(job?.failure).toContain('Rate exceeded');
    expect(job?.completedAt).toBeNull();
  });

  it('keeps waiting while the job is in progress', async () => {
    const { jobId } = await seedJob();
    vi.mocked(getBatchEvaluation).mockResolvedValueOnce({
      status: 'IN_PROGRESS',
      terminal: false,
      failure: null,
      scores: [],
      sessions: { total: 4, completed: 1, failed: 0, ignored: 0 },
      output: null,
    });

    await expect(advanceBatchJob(jobId)).resolves.toBe(false);

    const [job] = await db.select().from(evalBatchJobSchema).where(eq(evalBatchJobSchema.id, jobId));

    expect(job?.sessionsCompleted).toBe(1);
    expect(job?.completedAt).toBeNull();
  });

  it('files a finished job\'s averages under their own provider', async () => {
    // A batch score is an average over sessions; an on-demand score is one
    // case's result. Filed together, the trend line would mix two kinds of
    // number and nobody could say which one they were reading.
    const { jobId, runId } = await seedJob();
    vi.mocked(getBatchEvaluation).mockResolvedValueOnce({
      status: 'COMPLETED',
      terminal: true,
      failure: null,
      scores: [{
        evaluatorSlug: 'Builtin.TrajectoryInOrderMatch',
        evaluatorName: 'Builtin.TrajectoryInOrderMatch',
        level: 'SESSION',
        value: 0.75,
        label: null,
        explanation: 'Average over 4 session(s)',
      }],
      sessions: { total: 4, completed: 4, failed: 0, ignored: 0 },
      output: { logGroupName: '/aws/bedrock-agentcore/evaluations', logStreamName: 'job-1' },
    });

    await expect(advanceBatchJob(jobId)).resolves.toBe(true);

    const scores = await db.select().from(evalScoreSchema).where(eq(evalScoreSchema.runId, runId));

    expect(scores).toHaveLength(1);
    expect(scores[0]?.provider).toBe('agentcore-batch');
    expect(scores[0]?.value).toBe(0.75);
    // A batch score is about the run, not about one case.
    expect(scores[0]?.caseResultId).toBeNull();
  });

  it('records where AWS wrote the detail, so a person can go and read it', async () => {
    // This is the whole reason the batch path exists: a score someone can
    // check in their own account without going through Vocion.
    const { jobId, runId } = await seedJob();
    vi.mocked(getBatchEvaluation).mockResolvedValueOnce({
      status: 'COMPLETED',
      terminal: true,
      failure: null,
      scores: [],
      sessions: { total: 2, completed: 2, failed: 0, ignored: 0 },
      output: { logGroupName: '/aws/bedrock-agentcore/evaluations', logStreamName: 'job-1' },
    });

    await advanceBatchJob(jobId);

    const summary = await describeBatchJob(ORG, runId);

    expect(summary?.output).toEqual({
      logGroupName: '/aws/bedrock-agentcore/evaluations',
      logStreamName: 'job-1',
    });
    expect(summary?.batchEvaluationId).toBe('batch-1');
    expect(summary?.region).toBe('us-west-2');
  });

  it('keeps the scores from a job that finished with errors, and says so', async () => {
    // Some sessions graded, some not. The numbers are real measurement and
    // worth keeping; the failure has to stay visible so nobody reads the
    // average as covering the whole dataset.
    const { jobId, runId } = await seedJob();
    vi.mocked(getBatchEvaluation).mockResolvedValueOnce({
      status: 'COMPLETED_WITH_ERRORS',
      terminal: true,
      failure: 'Batch evaluation finished with errors on 1 of 4 session(s).',
      scores: [{
        evaluatorSlug: 'Builtin.Correctness',
        evaluatorName: 'Builtin.Correctness',
        level: 'SESSION',
        value: 0.6,
        label: null,
        explanation: 'Average over 3 session(s), 1 failed',
      }],
      sessions: { total: 4, completed: 3, failed: 1, ignored: 0 },
      output: null,
    });

    await expect(advanceBatchJob(jobId)).resolves.toBe(true);

    const scores = await db.select().from(evalScoreSchema).where(eq(evalScoreSchema.runId, runId));

    expect(scores).toHaveLength(1);

    const summary = await describeBatchJob(ORG, runId);

    expect(summary?.failure).toContain('1 of 4');
    expect(summary?.sessions.failed).toBe(1);
  });

  it('does not write the same averages twice when the workflow retries', async () => {
    // At-least-once activities mean this can genuinely run twice for one job.
    const { jobId, runId } = await seedJob();
    const finished = {
      status: 'COMPLETED',
      terminal: true,
      failure: null,
      scores: [{
        evaluatorSlug: 'Builtin.Correctness',
        evaluatorName: 'Builtin.Correctness',
        level: 'SESSION' as const,
        value: 1,
        label: null,
        explanation: 'Average over 2 session(s)',
      }],
      sessions: { total: 2, completed: 2, failed: 0, ignored: 0 },
      output: null,
    };
    vi.mocked(getBatchEvaluation).mockResolvedValue(finished);

    await advanceBatchJob(jobId);
    // Second attempt: the guard is the completedAt check, so this must not
    // reach AWS or the score table at all.
    await advanceBatchJob(jobId);

    const scores = await db.select().from(evalScoreSchema).where(eq(evalScoreSchema.runId, runId));

    expect(scores).toHaveLength(1);
  });
});
