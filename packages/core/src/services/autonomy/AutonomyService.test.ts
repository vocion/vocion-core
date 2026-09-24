/**
 * Promotion writes the trust rule, demotion reverts it, a rejected
 * auto-execution demotes on its own, and trust.yaml mirrors into policy rows.
 * PGlite; the adoption stream is stubbed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { autonomyPolicySchema, decisionAlignmentSchema, trustRuleSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');
const { recordDecision } = await import('@/services/alignment/AlignmentService');
const svc = await import('@/services/autonomy/AutonomyService');
const { track } = await import('@/services/adoption/track');

const ORG = 'org_autonomy_test';
const NOW = new Date('2026-09-15T12:00:00Z');

async function wipe() {
  await db.delete(decisionAlignmentSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(trustRuleSchema);
}

/**
 * n agreed hubspot.update decisions by one agent, inside the 30-day window.
 * @param n
 * @param actionId
 * @param startId
 */
async function agreedDecisions(n: number, actionId = 'hubspot.update', startId = 1000) {
  for (let i = 0; i < n; i++) {
    await recordDecision({
      orgId: ORG,
      subjectKind: 'action',
      subjectKey: actionId,
      subjectId: startId + i,
      agentSlug: 'crm-agent',
      decision: 'approved',
      // Stated, not inferred. Evidence for a promotion has to be approvals of
      // something the agent actually recommended — an inferred `approve` is
      // the ledger's old reading of silence, and it no longer counts towards
      // the rate the ladder reads.
      recommended: 'approve',
      outcome: 'approve',
      confidence: 0.92,
      at: new Date(NOW.getTime() - i * 3_600_000),
    });
  }
}

async function trustRule(actionId: string) {
  const [row] = await db.select().from(trustRuleSchema).where(and(eq(trustRuleSchema.orgId, ORG), eq(trustRuleSchema.actionId, actionId)));
  return row ?? null;
}

async function policy(actionId: string) {
  const [row] = await db.select().from(autonomyPolicySchema).where(and(eq(autonomyPolicySchema.orgId, ORG), eq(autonomyPolicySchema.actionId, actionId)));
  return row ?? null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await wipe();
});

afterAll(wipe);

describe('effective policy and the list', () => {
  it('reads a kind with no rows as Execute with approval at the registry default tier', async () => {
    const e = await svc.effectivePolicy(ORG, 'hubspot.update');

    expect(e).toMatchObject({ rung: 'execute-with-approval', riskTier: 'low', minConfidence: 0.85, policy: null, trustRule: null });
  });

  it('reads a derived key with no rows as its action: low for a record write, high for a merge', async () => {
    // `objects.update_meta.request` is registered under no such id. The tier
    // comes from `objects.update_meta` behind it; without that every object
    // type nobody wrote a rule for would read as an unknown, high-risk kind
    // and never run on its own.
    const write = await svc.effectivePolicy(ORG, 'objects.update_meta.request');

    expect(write.riskTier).toBe('low');
    expect(write.rung).toBe('execute-with-approval');

    const merge = await svc.effectivePolicy(ORG, 'git.merge.docs');

    expect(merge.riskTier).toBe('high');

    // A key that prefixes no registered action is what it always was.
    expect((await svc.effectivePolicy(ORG, 'nothing.registered.here')).riskTier).toBe('high');
  });

  it('governs a derived key with no rows of its own by the rule on its action, and lets the class override', async () => {
    // One rule, "a merge is a person's": `git.merge` at approval. A proposal
    // is keyed `git.merge.ui`, which has no row, so it reads the parent's.
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'git.merge', threshold: 1, enabled: 'false' });

    const ui = await svc.effectivePolicy(ORG, 'git.merge.ui');

    expect(ui).toMatchObject({ actionId: 'git.merge.ui', rung: 'execute-with-approval', riskTier: 'high', minConfidence: 1 });
    expect(ui.trustRule?.actionId).toBe('git.merge');

    // A class with its own rule keeps it: docs may earn its way while the
    // parent stays at approval.
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'git.merge.docs', threshold: 0.95, enabled: 'true' });

    const docs = await svc.effectivePolicy(ORG, 'git.merge.docs');

    expect(docs.trustRule?.actionId).toBe('git.merge.docs');
    expect(docs.minConfidence).toBe(0.95);
    // And a key that prefixes no registered action still reads as itself.
    expect((await svc.effectivePolicy(ORG, 'nothing.registered.here')).trustRule).toBeNull();

    // The fallback is opt-in: a record write keeps each object type's ledger
    // its own, so a bare objects.update_meta rule binds to no type.
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'objects.update_meta', threshold: 0.9, enabled: 'true' });

    expect((await svc.effectivePolicy(ORG, 'objects.update_meta.request')).trustRule).toBeNull();
  });

  it('reads an enabled trust rule with no policy row as Execute within bounds at the rule threshold', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'hubspot.update', threshold: 0.9, enabled: 'true' });

    const e = await svc.effectivePolicy(ORG, 'hubspot.update');

    expect(e).toMatchObject({ rung: 'execute-within-bounds', minConfidence: 0.9 });
  });

  it('lists every registered kind, holds never-auto kinds, and says what is missing', async () => {
    await agreedDecisions(8);

    const views = await svc.listPolicies(ORG, NOW);
    const hubspot = views.find(v => v.actionId === 'hubspot.update')!;
    const gmail = views.find(v => v.actionId === 'gmail.send')!;

    expect(hubspot.alignment).toMatchObject({ n: 8, agreed: 8, agreementRate: 1 });
    expect(hubspot.eligibility).toMatchObject({ earned: false, reason: 'Needs 12 more decided recommendations (8 of 20).' });
    expect(gmail.neverAuto).toBe(true);
    expect(gmail.automates).toBe(false);
    expect(gmail.eligibility.gaps[0]!.kind).toBe('never-auto');
  });
});

describe('promote', () => {
  it('refuses until the evidence is there', async () => {
    await agreedDecisions(19);

    await expect(svc.promote(ORG, 'hubspot.update', 'usr_chris')).rejects.toMatchObject({ code: 'NOT_EARNED' });
    expect(await trustRule('hubspot.update')).toBeNull();
  });

  it('writes the policy row, an ENABLED trust rule at the floor, the evidence, and an adoption event', async () => {
    await agreedDecisions(20);

    const view = await svc.promote(ORG, 'hubspot.update', 'usr_chris');

    expect(view.rung).toBe('execute-within-bounds');
    expect(view.automates).toBe(true);
    expect(await trustRule('hubspot.update')).toMatchObject({ enabled: 'true', threshold: 0.85 });

    const row = (await policy('hubspot.update'))!;

    expect(row).toMatchObject({ rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.85, promotedBy: 'usr_chris', source: 'app', flagged: false });
    expect(row.evidence).toMatchObject({ n: 20, agreed: 20, promotedFrom: 'execute-with-approval' });
    expect(track).toHaveBeenCalledWith({ orgId: ORG, userId: 'usr_chris' }, 'autonomy.promoted', { meta: { actionId: 'hubspot.update', from: 'execute-with-approval', to: 'execute-within-bounds', automatic: false } });
  });
});

describe('demote', () => {
  it('steps down one rung and DISABLES the trust rule, keeping its threshold', async () => {
    await agreedDecisions(20);
    await svc.promote(ORG, 'hubspot.update', 'usr_chris');

    const view = await svc.demote(ORG, 'hubspot.update', 'usr_chris', 'too early');

    expect(view.rung).toBe('execute-with-approval');
    expect(await trustRule('hubspot.update')).toMatchObject({ enabled: 'false', threshold: 0.85 });
    expect(track).toHaveBeenLastCalledWith({ orgId: ORG, userId: 'usr_chris' }, 'autonomy.demoted', { meta: { actionId: 'hubspot.update', from: 'execute-within-bounds', to: 'execute-with-approval', automatic: false } });
  });

  it('is always available, all the way down to Observe', async () => {
    for (const expected of ['assist', 'recommend', 'observe']) {
      const view = await svc.demote(ORG, 'hubspot.update', 'usr_chris');

      expect(view.rung).toBe(expected);
    }

    await expect(svc.demote(ORG, 'hubspot.update', 'usr_chris')).rejects.toMatchObject({ code: 'AT_BOTTOM' });
  });
});

describe('automatic demotion', () => {
  it('a rejected auto-executed run drops the kind one rung, disables the rule and flags it', async () => {
    await agreedDecisions(20);
    await svc.promote(ORG, 'hubspot.update', 'usr_chris');

    await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'hubspot.update', subjectId: 5000, agentSlug: 'crm-agent', decision: 'rejected', recommended: 'approve', outcome: 'reject', confidence: 0.97, autoExecuted: true });

    const row = (await policy('hubspot.update'))!;

    expect(row).toMatchObject({ rung: 'execute-with-approval', flagged: true, source: 'system' });
    expect(row.flagReason).toContain('had already executed under the trust rule at 97% confidence');
    expect(await trustRule('hubspot.update')).toMatchObject({ enabled: 'false' });
    expect(track).toHaveBeenLastCalledWith({ orgId: ORG, userId: 'system' }, 'autonomy.demoted', { meta: { actionId: 'hubspot.update', from: 'execute-within-bounds', to: 'execute-with-approval', automatic: true } });
  });

  it('an ordinary rejection of an ordinary kind at the default rung is just evidence', async () => {
    await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'hubspot.update', subjectId: 5001, decision: 'rejected', recommended: 'approve', outcome: 'reject', autoExecuted: false });

    expect(await policy('hubspot.update')).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it('acknowledging clears the flag without moving the rung', async () => {
    await agreedDecisions(20);
    await svc.promote(ORG, 'hubspot.update', 'usr_chris');
    await recordDecision({ orgId: ORG, subjectKind: 'action', subjectKey: 'hubspot.update', subjectId: 5002, decision: 'rejected', recommended: 'approve', outcome: 'reject', autoExecuted: true });

    const view = await svc.acknowledgeFlag(ORG, 'hubspot.update');

    expect(view).toMatchObject({ rung: 'execute-with-approval', flagged: false, flagReason: null });
  });
});

describe('syncPoliciesFromManifest', () => {
  it('mirrors rung, risk and floor for every authored rule and the top-level risk map', async () => {
    const errors = await svc.syncPoliciesFromManifest(ORG, {
      rules: [
        { action: 'hubspot.update', autoApproveAbove: 0.9, enabled: true },
        { action: 'gmail.send', autoApproveAbove: 0.99, enabled: false, rung: 'assist', risk: 'high' },
      ],
      risk: { 'qc.release': 'high' },
    });

    expect(errors).toEqual([]);
    expect(await policy('hubspot.update')).toMatchObject({ rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.9, source: 'trust.yaml' });
    expect(await policy('gmail.send')).toMatchObject({ rung: 'assist', riskTier: 'high', minConfidence: 0.99 });
    expect(await policy('qc.release')).toMatchObject({ rung: 'execute-with-approval', riskTier: 'high', minConfidence: null });
  });

  it('refuses a rung that disagrees with enabled', async () => {
    const errors = await svc.syncPoliciesFromManifest(ORG, {
      rules: [{ action: 'hubspot.update', autoApproveAbove: 0.9, enabled: false, rung: 'autonomous' }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('must agree');
    expect(await policy('hubspot.update')).toBeNull();
  });
});
