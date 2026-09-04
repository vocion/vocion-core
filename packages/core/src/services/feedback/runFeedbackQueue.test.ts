/**
 * Thumbs-up and thumbs-down notes on a run, on their way to the classifier.
 * The note was always stored on the run row; what these tests pin down is that
 * it now also reaches the queue, and that a rating with no note still queues
 * nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/attribution', () => ({
  resolveRunAgentSlug: async () => 'pipeline-analyst',
}));

const { db } = await import('@/libs/DB');
const { feedbackJobSchema } = await import('@/models/Schema');
const { queueRunFeedbackForLearning } = await import('@/services/feedback/runFeedbackQueue');

const ORG = 'org_run_feedback';

beforeEach(async () => {
  await db.delete(feedbackJobSchema);
});

describe('queueRunFeedbackForLearning', () => {
  it('queues a thumbs-down note as a correction', async () => {
    await queueRunFeedbackForLearning({
      orgId: ORG,
      kind: 'workflow',
      runId: 12,
      rating: 'down',
      note: 'the summary buried the number again',
      submittedBy: 'user_1',
    });

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job).toMatchObject({ source: 'review', externalId: 'workflow_run:12:feedback' });
    expect(job?.payload).toMatchObject({
      text: 'the summary buried the number again',
      agentSlug: 'pipeline-analyst',
      sourceRunId: 12,
      submittedBy: 'user_1',
      polarityHint: 'correct',
    });
  });

  it('queues a thumbs-up note as reinforcement', async () => {
    await queueRunFeedbackForLearning({
      orgId: ORG,
      kind: 'mission',
      runId: 3,
      rating: 'up',
      note: 'the ranking was exactly what I needed',
      submittedBy: 'user_1',
    });

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job?.externalId).toBe('mission_run:3:feedback');
    expect(job?.payload).toMatchObject({ polarityHint: 'reinforce' });
  });

  it('queues nothing for a rating with no note', async () => {
    await queueRunFeedbackForLearning({
      orgId: ORG,
      kind: 'workflow',
      runId: 12,
      rating: 'down',
      note: null,
      submittedBy: 'user_1',
    });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('queues nothing when the note is only whitespace', async () => {
    await queueRunFeedbackForLearning({
      orgId: ORG,
      kind: 'workflow',
      runId: 12,
      rating: 'down',
      note: '  \n ',
      submittedBy: 'user_1',
    });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('queues nothing when the rating was cleared', async () => {
    await queueRunFeedbackForLearning({
      orgId: ORG,
      kind: 'workflow',
      runId: 12,
      rating: null,
      note: 'changed my mind',
      submittedBy: 'user_1',
    });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('queues one job however many times the same run is rated', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await queueRunFeedbackForLearning({
        orgId: ORG,
        kind: 'workflow',
        runId: 12,
        rating: 'down',
        note: 'still buries the number',
        submittedBy: 'user_1',
      });
    }

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(1);
  });
});
