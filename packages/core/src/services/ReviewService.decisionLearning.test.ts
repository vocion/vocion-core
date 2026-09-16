/**
 * A reviewer's approve/reject on an agent-proposed action QUEUES the
 * reviewer's own words for the learning classifier, and writes no rule.
 *
 * Every decision used to write a `learning` row of composed text ("do not
 * propose this class again without stronger evidence") into the step the
 * proposing agent reads back on every run, so a busy step filled up with
 * machine commentary on individual runs phrased as standing policy. These
 * tests pin the replacement down in both directions: what queues, with which
 * polarity and against which step, and what must never queue, a bare click,
 * an opted-out automated caller, or an action no agent proposed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, feedbackJobSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide } = await import('@/services/ReviewService');

registerAction({
  id: 'test.decision-learning-write',
  name: 'Test decision-learning write',
  description: 'test',
  inputSchema: z.object({ objectType: z.string().optional(), fields: z.record(z.string(), z.unknown()).optional() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});

const ORG = 'org_decision_learning';
const AGENT = 'event-ingestion-lead';
/** The agent's OWN step, not the org's first one, which is what it must not use. */
const STEP = 'event-ingestion-updates';
const REVIEWER = 'user_reviewer';

/**
 * The proposing agent plus the step it declares, and a decoy step created
 * first so "the org's first learning step by id" is the wrong answer.
 */
async function seedAgent(): Promise<void> {
  for (const name of ['crm-updates', STEP]) {
    await db.insert(memoryNamespaceSchema).values({ orgId: ORG, name, path: `workspace/${name}`, title: name, description: name, agentSlugs: [] });
  }
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: AGENT,
    name: AGENT,
    systemPrompt: 'Be helpful.',
    learningSteps: [STEP],
  });
}

/**
 * A pending action awaiting review.
 * @param invokedBy - `agent:<slug>` for a proposal, a user id for a human's own action.
 */
async function pendingAction(invokedBy = `agent:${AGENT}`): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId: ORG,
      actionId: 'test.decision-learning-write',
      input: { objectType: 'event-candidate', fields: { title: 'Midd Summer Market' } },
      status: 'pending',
      invokedBy,
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function queuedJobs(): Promise<Array<typeof feedbackJobSchema.$inferSelect>> {
  return db.select().from(feedbackJobSchema);
}

async function clear(): Promise<void> {
  await db.delete(feedbackJobSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
}

beforeEach(async () => {
  await clear();
  await seedAgent();
});

afterAll(clear);

describe('recordActionDecisionLearning (via ReviewService.decide)', () => {
  it('queues an approval reason as reinforcement, against the proposing agent\'s own step', async () => {
    const runId = await pendingAction();

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reason: 'the venue and the start time both matched the listing',
      reviewedBy: REVIEWER,
    });

    const jobs = await queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: 'review',
      externalId: `action_run:${runId}:approve`,
      status: 'queued',
    });
    expect(jobs[0]?.payload).toMatchObject({
      text: 'the venue and the start time both matched the listing',
      targetSlug: STEP,
      agentSlug: AGENT,
      sourceRunId: runId,
      submittedBy: REVIEWER,
      polarityHint: 'reinforce',
    });
  });

  it('queues a rejection reason as a correction', async () => {
    const runId = await pendingAction();

    await decide({ kind: 'action', id: runId }, 'reject', ORG, {
      reason: 'this is the weekly series, not a new event',
      reviewedBy: REVIEWER,
    });

    const jobs = await queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: `action_run:${runId}:reject` });
    expect(jobs[0]?.payload).toMatchObject({
      text: 'this is the weekly series, not a new event',
      targetSlug: STEP,
      polarityHint: 'correct',
    });
  });

  it('queues nothing for a decision the reviewer gave no words to', async () => {
    const bare = await pendingAction();
    const blank = await pendingAction();

    await decide({ kind: 'action', id: bare }, 'approve', ORG, { reviewedBy: REVIEWER });
    await decide({ kind: 'action', id: blank }, 'reject', ORG, { reason: '   ', reviewedBy: REVIEWER });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('queues nothing when the caller opted out, however good the reason', async () => {
    const runId = await pendingAction();

    // What a past-event sweep does: one canned reason across hundreds of rows,
    // which is a machine's judgement and must not become a learning candidate.
    await decide({ kind: 'action', id: runId }, 'reject', ORG, {
      reason: 'event date has passed',
      reviewedBy: 'cron:reject-past',
      learn: false,
    });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('queues nothing when the caller opted out and sent a note, not a reason', async () => {
    const runId = await pendingAction();

    // The note takes the OTHER queueing path (the triage signal), so an
    // opt-out that only covered the decision path would leak here.
    await decide({ kind: 'action', id: runId }, 'reject', ORG, {
      note: 'past event, closed in bulk',
      reviewedBy: 'cron:reject-past',
      learn: false,
    });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('never writes a learning rule, whichever way the decision went', async () => {
    const approved = await pendingAction();
    const rejected = await pendingAction();

    await decide({ kind: 'action', id: approved }, 'approve', ORG, { reason: 'right call', reviewedBy: REVIEWER });
    await decide({ kind: 'action', id: rejected }, 'reject', ORG, { reason: 'wrong call', reviewedBy: REVIEWER });

    // Both decisions were live, they queued, and neither reached the rules
    // the agent reads back on its next run.
    expect(await queuedJobs()).toHaveLength(2);
    expect(await db.select().from(memorySchema)).toHaveLength(0);
  });

  it('queues nothing for an action a human proposed directly', async () => {
    const runId = await pendingAction('user_someone');

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reason: 'published it myself',
      reviewedBy: REVIEWER,
    });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('a blank reason falls through to the note and still targets the agent step', async () => {
    const runId = await pendingAction();

    await decide({ kind: 'action', id: runId }, 'reject', ORG, {
      reason: '   ',
      note: 'the price was the door fee, not the ticket',
      reviewedBy: REVIEWER,
    });

    const jobs = await queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({ text: 'the price was the door fee, not the ticket', targetSlug: STEP, polarityHint: 'correct' });
  });
});
