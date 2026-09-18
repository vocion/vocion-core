/**
 * Filtering the review queue by what the AGENT recommended.
 *
 * The point of the filter is that several lanes can be cut from one pending
 * set — everything a screener wants turned down in one, what it wants approved
 * in another — so these tests care most about the filter being honest: the
 * right rows, a `total` that narrows with them, and no silent whole-queue read
 * when something is off.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ resumeMission: vi.fn(), cancelMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ resumeWorkflow: vi.fn(), cancelWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, missionRunSchema, reviewAssignmentSchema, userActivityEventSchema } = await import('@/models/Schema');
const { listPending, listPendingPage, pendingCount, recordActionSignal } = await import('@/services/ReviewService');

const ORG = 'org_suggested_decision';

type Proposal = Record<string, unknown> | null;

async function seedRun(actionId: string, proposal: Proposal, status = 'pending'): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId, status, input: {}, proposal: proposal as never })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(missionRunSchema);
});

afterAll(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(missionRunSchema);
});

describe('listPending with a suggestedDecision filter', () => {
  it('returns only the items the agent recommended that outcome for', async () => {
    await seedRun('objects.propose_candidate', { confidence: 0.9, suggestedDecision: 'reject' });
    await seedRun('objects.propose_candidate', { confidence: 0.9, suggestedDecision: 'approve' });
    await seedRun('objects.propose_candidate', { confidence: 0.9, suggestedDecision: 'snooze' });

    const rejects = await listPending(ORG, { suggestedDecision: 'reject' });
    const approvals = await listPending(ORG, { suggestedDecision: 'approve' });
    const snoozes = await listPending(ORG, { suggestedDecision: 'snooze' });

    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.suggestedDecision).toBe('reject');
    expect(approvals.map(i => i.suggestedDecision)).toEqual(['approve']);
    expect(snoozes.map(i => i.suggestedDecision)).toEqual(['snooze']);
  });

  it('carries the reason on the row itself, so a lane can show why', async () => {
    // On the thin row on purpose: a lane of "everything my screener wants
    // turned down" would otherwise need one detail fetch per row just to say
    // anything more useful than the badge.
    await seedRun('objects.propose_candidate', {
      confidence: 0.9,
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'The date has already passed.',
    });

    const [item] = await listPending(ORG, { suggestedDecision: 'reject' });

    expect(item!.suggestedDecisionReason).toBe('The date has already passed.');
  });

  it('reads a row with a recommendation and no reason as having none', async () => {
    // Every run proposed before the reason existed is this row. It must read
    // as "nothing said", never as an empty sentence the card would render.
    await seedRun('objects.propose_candidate', { confidence: 0.9, suggestedDecision: 'approve' });

    const [item] = await listPending(ORG, { suggestedDecision: 'approve' });

    expect(item!.suggestedDecisionReason).toBeUndefined();
  });

  it('leaves out items the agent gave no view on', async () => {
    // An agent with no opinion is not an agent recommending approval, so an
    // envelope without the key must not answer a filter for one.
    await seedRun('objects.propose_candidate', { confidence: 0.8 });
    await seedRun('objects.propose_candidate', null);
    await seedRun('objects.propose_candidate', { suggestedDecision: 'approve' });

    const approvals = await listPending(ORG, { suggestedDecision: 'approve' });

    expect(approvals).toHaveLength(1);
  });

  it('narrows the total, not just the page', async () => {
    // The failure this guards: filtering after the read hands back whichever
    // of the newest rows happened to match and still reports the whole queue
    // as the total.
    for (let i = 0; i < 5; i++) {
      await seedRun('objects.propose_candidate', { suggestedDecision: 'approve' });
    }
    await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });

    const page = await listPendingPage(ORG, { suggestedDecision: 'reject', limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(await pendingCount(ORG, { suggestedDecision: 'reject' })).toBe(1);
  });

  it('pages a long single-recommendation lane with a truthful total', async () => {
    for (let i = 0; i < 7; i++) {
      await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });
    }

    const firstPage = await listPendingPage(ORG, { suggestedDecision: 'reject', limit: 3 });

    expect(firstPage.items).toHaveLength(3);
    expect(firstPage.total).toBe(7);
  });

  it('excludes planes that cannot carry a recommendation', async () => {
    // A mission has no proposal envelope. Returning one under a filter about
    // what an agent advised would answer a different question than the one
    // asked.
    await db.insert(missionRunSchema).values({
      orgId: ORG,
      title: 'Awaiting review',
      brief: 'b',
      team: { lead: 'lead', members: [] as string[] },
      status: 'awaiting_review',
    });
    await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });

    const unfiltered = await listPending(ORG);
    const rejects = await listPending(ORG, { suggestedDecision: 'reject' });

    expect(unfiltered).toHaveLength(2);
    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.kind).toBe('action');
  });

  it('composes with the action-type filter instead of overriding it', async () => {
    // Two lanes cut from one pending set: "what my screener wants turned down"
    // is a different question from "every candidate", and asking both at once
    // has to mean both.
    await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });
    await seedRun('hubspot.update', { suggestedDecision: 'reject' });

    const items = await listPending(ORG, {
      suggestedDecision: 'reject',
      actionIds: ['objects.propose_candidate'],
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain('objects.propose_candidate');
  });

  it('hides a snoozed item from the lane, and shows it with includeSnoozed', async () => {
    // The two filters are independent questions — "what did the agent advise"
    // and "has a person parked this" — so a snoozed item has to obey the
    // snooze rule inside the recommendation lane exactly as it does outside it.
    const runId = await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });
    await db.insert(reviewAssignmentSchema).values({
      orgId: ORG,
      kind: 'action',
      runId,
      snoozedUntil: new Date(Date.now() + 86_400_000),
    });

    expect(await listPending(ORG, { suggestedDecision: 'reject' })).toHaveLength(0);

    const withSnoozed = await listPending(ORG, { suggestedDecision: 'reject', includeSnoozed: true });

    expect(withSnoozed).toHaveLength(1);
    expect(withSnoozed[0]!.suggestedDecision).toBe('reject');
  });

  it('counts a snoozed item once, not twice, when it is included', async () => {
    const runId = await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });
    await db.insert(reviewAssignmentSchema).values({
      orgId: ORG,
      kind: 'action',
      runId,
      snoozedUntil: new Date(Date.now() + 86_400_000),
    });

    const page = await listPendingPage(ORG, { suggestedDecision: 'reject', includeSnoozed: true, limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it('keeps failed runs in the lane, because they are still open work', async () => {
    await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' }, 'failed');

    expect(await listPending(ORG, { suggestedDecision: 'reject' })).toHaveLength(1);
  });

  it('drops a decided run out of the lane', async () => {
    await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' }, 'rejected');

    expect(await listPending(ORG, { suggestedDecision: 'reject' })).toHaveLength(0);
  });
});

describe('recordActionSignal', () => {
  // The path a real approve or reject on an action actually takes:
  // `decide()` calls this, not `trackReviewDecision`. Tested here because the
  // agreement metric reads what this writes, and the workflow/mission planes
  // get their stamp from a different function entirely.
  it('stamps the agent recommendation onto the decision event', async () => {
    const runId = await seedRun('objects.propose_candidate', { confidence: 0.8, suggestedDecision: 'reject' });

    await recordActionSignal({ orgId: ORG, runId, userId: 'usr-1', signal: 'reject' });
    const [event] = await db.select().from(userActivityEventSchema);

    expect(event!.metadata).toMatchObject({ decision: 'rejected', suggestedDecision: 'reject' });
  });

  it('stamps the reason beside the recommendation it explains', async () => {
    // Read back months later, the recommendation alone says the agent and the
    // reviewer disagreed; the reason says what the agent was looking at when
    // it did, which is the part anyone evaluating the criteria needs.
    const runId = await seedRun('objects.propose_candidate', {
      confidence: 0.8,
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'Third listing of this same show this week.',
    });

    await recordActionSignal({ orgId: ORG, runId, userId: 'usr-1', signal: 'approve' });
    const [event] = await db.select().from(userActivityEventSchema);

    expect(event!.metadata).toMatchObject({
      decision: 'approved',
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'Third listing of this same show this week.',
    });
  });

  it('leaves the field off when the agent gave no recommendation', async () => {
    const runId = await seedRun('objects.propose_candidate', { confidence: 0.8 });

    await recordActionSignal({ orgId: ORG, runId, userId: 'usr-1', signal: 'approve' });
    const [event] = await db.select().from(userActivityEventSchema);

    expect(event!.metadata).not.toHaveProperty('suggestedDecision');
    expect(event!.metadata).not.toHaveProperty('suggestedDecisionReason');
  });

  it('keeps an edit-then-approve as its own signal, still carrying the recommendation', async () => {
    // `edited` is what makes the approval rate and the agreement rate diverge,
    // so both facts have to survive onto the same event.
    const runId = await seedRun('objects.propose_candidate', { suggestedDecision: 'approve' });

    await recordActionSignal({ orgId: ORG, runId, userId: 'usr-1', signal: 'edit' });
    const [event] = await db.select().from(userActivityEventSchema);

    expect(event!.metadata).toMatchObject({ decision: 'edited', suggestedDecision: 'approve' });
  });
});

describe('listPending without a filter', () => {
  it('carries the recommendation on the thin row so a lane can label itself', async () => {
    // Without this a client rendering a queue would need one detail fetch per
    // row just to show what the agent advised.
    await seedRun('objects.propose_candidate', { suggestedDecision: 'reject' });

    const [item] = await listPending(ORG);

    expect(item!.suggestedDecision).toBe('reject');
  });

  it('reports no recommendation for a value nobody defined', async () => {
    // jsonb accepts anything, so a past-tense spelling or a stray value can
    // reach the row. It should read as "no recommendation", not leak through
    // as one.
    await seedRun('objects.propose_candidate', { suggestedDecision: 'rejected' });

    const [item] = await listPending(ORG);

    expect(item!.suggestedDecision).toBeUndefined();
    expect(await listPending(ORG, { suggestedDecision: 'reject' })).toHaveLength(0);
  });
});
