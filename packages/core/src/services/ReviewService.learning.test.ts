/**
 * Which review-queue signals reach the feedback classifier.
 *
 * A signal is always measured; whether it can become a rule depends on there
 * being text to learn from. These tests pin that rule down, because getting it
 * wrong in either direction is bad: queue every bare click and the model
 * invents rules nobody stated, queue none and rejections teach nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, feedbackJobSchema } = await import('@/models/Schema');
const { recordActionSignal } = await import('@/services/ReviewService');

const ORG = 'org_review_signals';
const REVIEWER = 'user_reviewer';

/**
 * A pending action an agent proposed, the thing a reviewer reacts to.
 * @param invokedBy
 */
async function makePendingAction(invokedBy = 'agent:sales-assistant'): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'gmail.send',
      input: { to: 'buyer@example.com' },
      status: 'pending',
      invokedBy,
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(feedbackJobSchema);
  await db.delete(actionRunSchema);
});

describe('recordActionSignal', () => {
  it('queues a rejection reason for the classifier, with the agent and run attached', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({
      orgId: ORG,
      runId,
      signal: 'reject',
      userId: REVIEWER,
      hint: 'we never email a buyer before the demo',
    });

    const jobs = await db.select().from(feedbackJobSchema);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: 'review',
      externalId: `action_run:${runId}:reject`,
      status: 'queued',
    });
    expect(jobs[0]?.payload).toMatchObject({
      text: 'we never email a buyer before the demo',
      agentSlug: 'sales-assistant',
      sourceRunId: runId,
      submittedBy: REVIEWER,
      polarityHint: 'correct',
    });
  });

  it('queues an approval note as reinforcement', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({
      orgId: ORG,
      runId,
      signal: 'approve',
      userId: REVIEWER,
      hint: 'leading with the number was exactly right',
    });

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job?.payload).toMatchObject({ polarityHint: 'reinforce' });
  });

  it('queues nothing for an approval with no note', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({ orgId: ORG, runId, signal: 'approve', userId: REVIEWER });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('queues nothing for a rejection with no reason', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({ orgId: ORG, runId, signal: 'reject', userId: REVIEWER });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('queues nothing when the note is only whitespace', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({ orgId: ORG, runId, signal: 'reject', userId: REVIEWER, hint: '   ' });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('never queues a skip, which is not a judgement yet', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({ orgId: ORG, runId, signal: 'skip', userId: REVIEWER, hint: 'later' });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('treats an edit and a rewrite as corrections', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({ orgId: ORG, runId, signal: 'edit', userId: REVIEWER, hint: 'too formal' });
    await recordActionSignal({ orgId: ORG, runId, signal: 'rewrite', userId: REVIEWER, hint: 'shorter' });

    const jobs = await db.select().from(feedbackJobSchema);

    expect(jobs.map(job => job.externalId)).toEqual([
      `action_run:${runId}:edit`,
      `action_run:${runId}:rewrite`,
    ]);
    expect(jobs.every(job => (job.payload as { polarityHint?: string }).polarityHint === 'correct')).toBe(true);
  });

  it('queues one job however many times the same decision is recorded', async () => {
    const runId = await makePendingAction();

    await recordActionSignal({ orgId: ORG, runId, signal: 'reject', userId: REVIEWER, hint: 'wrong call' });
    await recordActionSignal({ orgId: ORG, runId, signal: 'reject', userId: REVIEWER, hint: 'wrong call' });

    expect(await db.select().from(feedbackJobSchema)).toHaveLength(1);
  });

  it('leaves the agent unset when a person proposed the action', async () => {
    const runId = await makePendingAction('user_someone');

    await recordActionSignal({ orgId: ORG, runId, signal: 'reject', userId: REVIEWER, hint: 'wrong call' });

    const [job] = await db.select().from(feedbackJobSchema);

    expect((job?.payload as { agentSlug?: string }).agentSlug).toBeUndefined();
  });
});
