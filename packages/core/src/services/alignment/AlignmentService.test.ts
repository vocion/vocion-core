/**
 * The alignment ledger fills from BOTH decide paths — the review queue
 * (`ReviewService.decide` on an action run) and the inbox (`AskService.decideAsk`)
 * — and scores what it holds. PGlite; the other dispatch services are stubbed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, autonomyPolicySchema, decisionAlignmentSchema, feedbackJobSchema, reviewAssignmentSchema, trustRuleSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide } = await import('@/services/ReviewService');
const { decideAsk, upsertAsk } = await import('@/services/AskService');
const { agentKeyOf, recordDecision, REINFORCE_EVERY, scoreFor, scoresByAgentAndKey } = await import('@/services/alignment/AlignmentService');
const { enqueue } = await import('@/services/FeedbackWorkerService');
const { eq } = await import('drizzle-orm');

registerAction({
  id: 'test.alignment',
  name: 'Test alignment',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});

const ORG = 'org_alignment_test';

async function seedRun(proposal: Record<string, unknown> | null, invokedBy = 'agent:closer'): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId: 'test.alignment', input: { value: 'x' }, status: 'pending', invokedBy, proposal: proposal as never })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function ledger() {
  return db.select().from(decisionAlignmentSchema).where(eq(decisionAlignmentSchema.orgId, ORG)).orderBy(decisionAlignmentSchema.id);
}

async function wipe() {
  await db.delete(decisionAlignmentSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(trustRuleSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(feedbackJobSchema);
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await wipe();
});

afterAll(wipe);

describe('review-queue decisions', () => {
  it('a rejection of a recommended approval lands as a disagreement, with the agent, confidence and note', async () => {
    const id = await seedRun({ confidence: 0.81, suggestedDecision: 'approve', agentSlug: 'ignored-when-invokedBy-names-the-agent' });

    await decide({ kind: 'action', id }, 'reject', ORG, { reviewedBy: 'usr_chris', reason: 'wrong account' });

    const [row] = await ledger();

    expect(row).toMatchObject({
      subjectKind: 'action',
      subjectKey: 'test.alignment',
      subjectId: id,
      agentSlug: 'closer',
      decision: 'rejected',
      recommended: 'approve',
      implicit: false,
      agreed: false,
      autoExecuted: false,
      hasNote: true,
      decidedBy: 'usr_chris',
    });
    expect(row!.confidence).toBeCloseTo(0.81, 5);
  });

  it('an approval of a proposal with no stated recommendation counts as an IMPLICIT agreement', async () => {
    const id = await seedRun({ confidence: 0.9 });

    await decide({ kind: 'action', id }, 'approve', ORG, { reviewedBy: 'usr_chris' });

    const [row] = await ledger();

    expect(row).toMatchObject({ decision: 'approved', recommended: 'approve', implicit: true, agreed: true, hasNote: false });
  });

  it('edit-then-approve agrees; agreeing with a recommended rejection agrees too', async () => {
    const edited = await seedRun({ suggestedDecision: 'approve' });
    const rejectAdvised = await seedRun({ suggestedDecision: 'reject' });

    await decide({ kind: 'action', id: edited }, 'approve', ORG, { reviewedBy: 'usr_chris', editedInput: { value: 'y' } });
    await decide({ kind: 'action', id: rejectAdvised }, 'reject', ORG, { reviewedBy: 'usr_chris' });

    const rows = await ledger();

    expect(rows.map(r => [r.decision, r.recommended, r.agreed])).toEqual([
      ['edited', 'approve', true],
      ['rejected', 'reject', true],
    ]);
  });

  it('an auto-executed run a person rejected is marked, so the ladder can act on it', async () => {
    const id = await seedRun({ confidence: 0.99, autoApproved: true, autoApprovedThreshold: 0.95 });

    await decide({ kind: 'action', id }, 'reject', ORG, { reviewedBy: 'usr_chris' });

    expect((await ledger())[0]).toMatchObject({ decision: 'rejected', autoExecuted: true, agreed: false });
  });
});

describe('ask decisions', () => {
  it('choosing the recommended option agrees and carries that option\'s confidence', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: {
      kind: 'ruling',
      title: 'Which app model?',
      agentSlug: 'ceo',
      options: [{ id: 'per-workspace', label: 'One per workspace', recommended: true, confidence: 0.72 }, { id: 'per-agent', label: 'One per agent' }],
    } });

    await decideAsk({ orgId: ORG, id: ask.id, decision: 'per-workspace', decidedBy: 'usr_chris' });

    const [row] = await ledger();

    expect(row).toMatchObject({ subjectKind: 'ask', subjectKey: 'ruling', subjectId: ask.id, agentSlug: 'ceo', decision: 'per-workspace', recommended: 'per-workspace', implicit: false, agreed: true, hasNote: false });
    expect(row!.confidence).toBeCloseTo(0.72, 5);
  });

  it('an "other" answer with a note disagrees and is marked as carrying a correction', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Ship it?', agentSlug: 'ceo', options: [{ id: 'yes', label: 'Yes', recommended: true }, { id: 'no', label: 'No' }] } });

    await decideAsk({ orgId: ORG, id: ask.id, decision: 'other', note: 'ship Tuesday instead', decidedBy: 'usr_chris' });

    expect((await ledger())[0]).toMatchObject({ decision: 'other', recommended: 'yes', agreed: false, hasNote: true });
  });

  it('an ask with no recommended option is decided but has nothing to agree with', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'merge', title: 'Merge #12', agentSlug: 'ceo' } });

    await decideAsk({ orgId: ORG, id: ask.id, decision: 'approve', decidedBy: 'usr_chris' });

    expect((await ledger())[0]).toMatchObject({ decision: 'approve', recommended: null, agreed: null });

    const score = await scoreFor({ orgId: ORG, subjectKey: 'merge', agentSlug: 'ceo' });

    expect(score).toMatchObject({ n: 0, decided: 1, agreementRate: null });
  });
});

describe('scores', () => {
  it('aggregates agreement per (agent, kind) and per window; null rather than 0% with nothing to compare', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const put = (subjectId: number, agreed: boolean, at: Date, agentSlug = 'closer') => recordDecision({
      orgId: ORG,
      subjectKind: 'action',
      subjectKey: 'hubspot.update',
      subjectId,
      agentSlug,
      decision: agreed ? 'approved' : 'rejected',
      recommended: 'approve',
      outcome: agreed ? 'approve' : 'reject',
      at,
    });
    await put(1, true, daysAgo(1));
    await put(2, true, daysAgo(5));
    await put(3, false, daysAgo(20));
    await put(4, true, daysAgo(60));
    await put(5, false, daysAgo(2), 'other-agent');

    const week = await scoreFor({ orgId: ORG, subjectKey: 'hubspot.update', agentSlug: 'closer', window: '7d', now });
    const month = await scoreFor({ orgId: ORG, subjectKey: 'hubspot.update', agentSlug: 'closer', window: '30d', now });
    const all = await scoreFor({ orgId: ORG, subjectKey: 'hubspot.update', agentSlug: 'closer', window: 'all', now });
    const everyone = await scoreFor({ orgId: ORG, subjectKey: 'hubspot.update', window: '30d', now });
    const byAgent = await scoresByAgentAndKey(ORG, '30d', now, 'action');

    expect(week).toMatchObject({ n: 2, agreed: 2, agreementRate: 1, rejected: 0 });
    expect(month).toMatchObject({ n: 3, agreed: 2, rejected: 1 });
    expect(month.agreementRate).toBeCloseTo(2 / 3, 5);
    expect(all).toMatchObject({ n: 4, agreed: 3 });
    expect(everyone).toMatchObject({ n: 4, agreed: 2, agreementRate: 0.5 });
    expect(byAgent.get(agentKeyOf('closer', 'hubspot.update'))).toMatchObject({ n: 3 });
    expect(byAgent.get(agentKeyOf('other-agent', 'hubspot.update'))).toMatchObject({ n: 1, agreementRate: 0 });
    expect(await scoreFor({ orgId: ORG, subjectKey: 'nothing.yet' })).toMatchObject({ n: 0, agreementRate: null });
  });

  it('is idempotent on a re-decided subject', async () => {
    await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'x', subjectId: 1, decision: 'approved', recommended: 'approve', outcome: 'approve' });
    await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'x', subjectId: 1, decision: 'approved', recommended: 'approve', outcome: 'approve' });

    expect(await ledger()).toHaveLength(1);
  });
});

describe('learning on agreement', () => {
  it(`every ${REINFORCE_EVERY} agreed decisions per (agent, kind) propose ONE reinforce candidate, at most once a day`, async () => {
    const at = new Date('2026-09-15T09:00:00Z');
    for (let i = 1; i <= REINFORCE_EVERY * 2; i++) {
      await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'hubspot.update', subjectId: i, agentSlug: 'closer', decision: 'approved', recommended: 'approve', outcome: 'approve', decidedBy: 'usr_chris', at });
    }

    // Two multiples of N, but the same day: the pipeline's idempotency key is
    // per (kind, agent, day), so it is asked twice with the same id.
    expect(enqueue).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(enqueue).mock.calls.map(c => c[0]);

    expect(new Set(calls.map(c => c.externalId)).size).toBe(1);
    expect(calls[0]).toMatchObject({
      orgId: ORG,
      source: 'review',
      externalId: 'alignment:action:hubspot.update:closer:2026-09-15',
      payload: { agentSlug: 'closer', polarityHint: 'reinforce', submittedBy: 'usr_chris' },
    });
    expect(calls[0]!.payload.text).toContain('hubspot.update proposals from closer are consistently accepted');
    expect(calls[0]!.payload.text).toContain('10 of 10');
  });

  it('a disagreement proposes nothing here — corrections go through the existing reject path', async () => {
    for (let i = 1; i <= REINFORCE_EVERY; i++) {
      await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'hubspot.update', subjectId: i, agentSlug: 'closer', decision: 'rejected', recommended: 'approve', outcome: 'reject' });
    }

    expect(enqueue).not.toHaveBeenCalled();
  });
});
