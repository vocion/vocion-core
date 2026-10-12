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
    // the agent reads back on its next run. (Each decision DOES leave a
    // TTL'd episode under /runs/ — raw consolidation material, never
    // mounted as instructions — so only rule keys are asserted empty.)
    expect(await queuedJobs()).toHaveLength(2);

    const rows = await db.select().from(memorySchema);

    expect(rows.filter(r => !r.key.startsWith('/runs/'))).toHaveLength(0);
    expect(rows.every(r => r.expiresAt !== null)).toBe(true);
  });

  it('queues nothing for an action a human proposed directly', async () => {
    const runId = await pendingAction('user_someone');

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reason: 'published it myself',
      reviewedBy: REVIEWER,
    });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('trains the agent an app named when it proposed over the API as its own token', async () => {
    const [row] = await db
      .insert(actionRunSchema)
      .values({
        orgId: ORG,
        actionId: 'test.decision-learning-write',
        input: { objectType: 'event-candidate', fields: { title: 'Lakeport Night Market' } },
        proposal: { agentSlug: AGENT },
        status: 'pending',
        invokedBy: 'token:panel-sync',
      })
      .returning({ id: actionRunSchema.id });

    await decide({ kind: 'action', id: row!.id }, 'reject', ORG, { reason: 'a weekly series, not a new event', reviewedBy: REVIEWER });

    const jobs = await queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({ agentSlug: AGENT, targetSlug: STEP, polarityHint: 'correct' });
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

describe('field corrections on approve (via ReviewService.decide)', () => {
  const PROPOSED = { title: 'Harbor Jazz Brunch', categories: ['Live Music', 'Jazz Brunch'], price: '$10' };

  /** A pending event proposal with these fields and the agent's reason for it. */
  async function pendingProposal(): Promise<number> {
    const [row] = await db
      .insert(actionRunSchema)
      .values({
        orgId: ORG,
        actionId: 'test.decision-learning-write',
        input: { objectType: 'event-candidate', fields: PROPOSED },
        proposal: { rationale: 'Listed on the venue calendar.' },
        status: 'pending',
        invokedBy: `agent:${AGENT}`,
      })
      .returning({ id: actionRunSchema.id });
    return row!.id;
  }

  /**
   * The proposal as the reviewer approved it.
   * @param fields - Fields to change on top of what was proposed.
   */
  function approved(fields: Record<string, unknown>): Record<string, unknown> {
    return { objectType: 'event-candidate', fields: { ...PROPOSED, ...fields } };
  }

  it('queues what the reviewer corrected even when they typed nothing, read before the edit replaces it', async () => {
    const runId = await pendingProposal();

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: approved({ categories: ['Live Music', 'Food & Drink'] }),
    });

    const jobs = await queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: `action_run:${runId}:edit` });
    expect(jobs[0]?.payload).toEqual({
      text: '',
      targetSlug: STEP,
      agentSlug: AGENT,
      sourceRunId: runId,
      submittedBy: REVIEWER,
      polarityHint: 'correct',
      edits: [{ field: 'categories', before: ['Live Music', 'Jazz Brunch'], after: ['Live Music', 'Food & Drink'] }],
      quotedText: expect.any(String),
      artifactTitle: 'Harbor Jazz Brunch',
    });

    // The record as the agent proposed it, which the edit reader reads the
    // correction against. Postgres keeps its own key order, so lines, not text.
    const quoted = String((jobs[0]?.payload as { quotedText: string }).quotedText).split('\n');

    expect(quoted).toEqual(expect.arrayContaining([
      'title: "Harbor Jazz Brunch"',
      'categories: "Live Music, Jazz Brunch"',
      'price: "$10"',
    ]));
    expect(quoted.at(-1)).toBe('agent rationale: Listed on the venue calendar.');
  });

  it('sends the note and the corrections as one job', async () => {
    const runId = await pendingProposal();

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      note: 'Pier Hall brunches are food events.',
      reviewedBy: REVIEWER,
      editedInput: approved({ categories: ['Food & Drink'] }),
    });

    const jobs = await queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      text: 'Pier Hall brunches are food events.',
      edits: [{ field: 'categories', before: ['Live Music', 'Jazz Brunch'], after: ['Food & Drink'] }],
    });
  });

  it('queues nothing when the edited payload changed nothing a reviewer would call a correction', async () => {
    const runId = await pendingProposal();

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: approved({ categories: ['Jazz Brunch', 'Live Music'], title: ' Harbor Jazz Brunch ' }),
    });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('does not read a payload that dropped the record wrapper as a correction to every key', async () => {
    const runId = await pendingProposal();

    // Same fields, sent flat: nothing the reviewer changed.
    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: REVIEWER,
      editedInput: { objectType: 'event-candidate', ...PROPOSED },
    });

    expect(await queuedJobs()).toHaveLength(0);
  });

  it('queues no corrections from a caller that opted out of training', async () => {
    const runId = await pendingProposal();

    await decide({ kind: 'action', id: runId }, 'approve', ORG, {
      reviewedBy: 'sync:listings-panel',
      editedInput: approved({ price: 'Free' }),
      learn: false,
    });

    expect(await queuedJobs()).toHaveLength(0);
  });
});
