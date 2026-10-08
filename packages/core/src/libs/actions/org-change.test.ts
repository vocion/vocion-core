/**
 * `org.change` — a change to the team, on its evidence, with Undo.
 *
 * What matters: it rides the ordinary proposal path and waits for a person
 * (medium risk, so no confidence releases it); the evidence is core's alone
 * (an agent's own proposal arrives without any and is refused, a person's own
 * request runs); each kind's act records what Undo needs and Undo puts the
 * team back exactly; and nothing reaches into another workspace.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// The duplicate judge an adopted rule passes through: "not a duplicate".
vi.mock('@/libs/llm', async orig => ({
  ...(await orig<typeof import('@/libs/llm')>()),
  buildChatModel: () => ({ invoke: async () => ({ content: JSON.stringify({ duplicate_of: null }) }) }),
}));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentBudgetSchema, agentSchema, autonomyPolicySchema, memoryNamespaceSchema, memorySchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { orgChangeAction, orgChangeTarget } = await import('./org-change');
const { policyKeyForRun } = await import('./policyKey');
const { proposeAction, undoAction, executeAction } = await import('@/services/ActionService');
const { getBudget, setLimits } = await import('@/services/BudgetService');
const { getNamespace } = await import('@/services/MemoryService');

const ORG = 'org_change_test';
const OTHER = 'org_change_other';
const ctx = { orgId: ORG, invokedBy: 'agent:org-review', reviewedBy: 'usr-lili' };
const evidence = [{ label: 'Last run', value: 'never', href: '/dashboard/team-report/scout' }];
const review = { kind: 'agent' as const, id: 'agent:org-review', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 as const };

async function agent(slug: string, org = ORG, active = 'true') {
  await db.insert(agentSchema).values({ orgId: org, projectId: org, slug, name: slug === 'scout' ? 'Kestrel Scout' : slug, systemPrompt: 'x', active });
}

async function agentRow(slug: string, org = ORG) {
  const [row] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, org), eq(agentSchema.slug, slug)));
  return row;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-change', name: 'Northwind', slug: 'northwind-change' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct-change', slug: 'northwind-ops', name: 'Northwind Ops', leadAgentSlug: 'chief' },
    { id: OTHER, accountId: 'acct-change', slug: 'contoso-ops', name: 'Contoso Ops' },
  ]);
});

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
  await db.delete(agentBudgetSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
});

describe('the proposal path', () => {
  it('waits for a person whatever the confidence, keyed on its kind\'s own ledger', async () => {
    await agent('scout');

    const res = await proposeAction({
      orgId: ORG,
      actionId: 'org.change',
      input: { change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout — no runs in 41 days', reason: 'Unused.', evidence, asOf: '2026-10-08T12:00:00.000Z' },
      principal: review,
      invokedBy: 'agent:org-review',
      internal: true,
      proposal: { confidence: 0.99, agentSlug: 'org-review', suggestedDecision: 'approve', suggestedDecisionReason: 'Unused for 41 days.' },
    });

    expect(res).toMatchObject({ status: 'pending', outcome: 'created' });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(run!.input).toMatchObject({ evidence });
    expect(run!.dedupKey).toBe('org.change:retire_agent:scout');
    expect(policyKeyForRun('org.change', run!.input)).toBe('org.change.retire_agent');
    // Nothing changed yet.
    expect((await agentRow('scout'))!.active).toBe('true');
  });

  it('refuses an agent\'s own org change — it cannot cite evidence — and runs a person\'s', async () => {
    await agent('scout');
    const input = { change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout', reason: 'I think it is unused.', evidence };

    await expect(proposeAction({
      orgId: ORG,
      actionId: 'org.change',
      input,
      principal: { kind: 'agent', id: 'agent:deal-desk', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 },
      invokedBy: 'agent:deal-desk',
      proposal: { confidence: 0.9, suggestedDecision: 'approve', suggestedDecisionReason: 'x' },
    })).rejects.toThrow(/only the weekly org review can/);

    expect(await orgChangeAction.precheck!({ orgId: ORG, proposedBy: 'usr-lili' }, orgChangeAction.inputSchema.parse({ ...input, evidence: [] }))).toBeUndefined();
  });

  it('refuses retiring the workspace lead, an agent already inactive, or one in another workspace', async () => {
    await agent('chief');
    await agent('gone', ORG, 'false');
    await agent('scout', OTHER);
    const check = (agentSlug: string) => orgChangeAction.precheck!({ orgId: ORG, proposedBy: 'agent:org-review' }, orgChangeAction.inputSchema.parse({ change: { kind: 'retire_agent', agentSlug }, headline: 'h', reason: 'r', evidence }));

    expect(await check('chief')).toContain('is the workspace lead');
    expect(await check('gone')).toContain('already inactive');
    expect(await check('scout')).toBe('no agent "scout" in this workspace');
  });
});

describe('retire_agent', () => {
  it('holds the agent inactive with who and why, and Undo restores it exactly', async () => {
    await agent('scout');
    const input = orgChangeAction.inputSchema.parse({ change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout — no runs in 41 days', reason: 'Unused.', evidence });

    const result = await orgChangeAction.execute(ctx, input);

    expect(await agentRow('scout')).toMatchObject({ active: 'false', pausedBy: 'usr-lili', pausedNote: 'Retire Kestrel Scout — no runs in 41 days' });
    expect(result).toMatchObject({ retired: true, previousActive: 'true', previousPause: null });

    await orgChangeAction.undo!(ctx, input, result);

    expect(await agentRow('scout')).toMatchObject({ active: 'true', pausedAt: null, pausedBy: null, pausedNote: null });
  });

  it('runs through the queue on approval and comes back with Undo on the run', async () => {
    await agent('scout');
    const res = await proposeAction({
      orgId: ORG,
      actionId: 'org.change',
      input: { change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout', reason: 'Unused.', evidence },
      principal: review,
      invokedBy: 'agent:org-review',
      internal: true,
      proposal: { confidence: 0.8, agentSlug: 'org-review', suggestedDecision: 'approve', suggestedDecisionReason: 'Unused.' },
    });
    await db.update(actionRunSchema).set({ status: 'approved', decidedBy: 'usr-lili' }).where(eq(actionRunSchema.id, res.runId));

    expect((await executeAction(res.runId, ORG, { reviewedBy: 'usr-lili' })).status).toBe('done');
    expect((await agentRow('scout'))!.active).toBe('false');

    await undoAction(res.runId, ORG, { by: 'usr-lili' });

    expect((await agentRow('scout'))!.active).toBe('true');
  });
});

describe('set_budget', () => {
  it('writes the new daily cap and Undo writes the previous one back', async () => {
    await agent('deal-desk');
    await setLimits({ orgId: ORG, agentSlug: 'deal-desk', softCentsLimit: 8_000, hardCentsLimit: 10_000, hardTokenLimit: 500_000 });
    const input = orgChangeAction.inputSchema.parse({ change: { kind: 'set_budget', agentSlug: 'deal-desk', dailyCents: 5_000 }, headline: 'Halve Deal Desk\'s daily cap to $50.00', reason: 'Spend on rejected work.', evidence });

    const result = await orgChangeAction.execute(ctx, input);

    expect(await getBudget({ orgId: ORG, agentSlug: 'deal-desk' })).toMatchObject({ softCentsLimit: 5_000, hardCentsLimit: 5_000, hardTokenLimit: 500_000 });

    await orgChangeAction.undo!(ctx, input, result);

    expect(await getBudget({ orgId: ORG, agentSlug: 'deal-desk' })).toMatchObject({ softCentsLimit: 8_000, hardCentsLimit: 10_000, hardTokenLimit: 500_000 });
  });

  it('removes the row Undo finds it created, putting the agent back on the default cap', async () => {
    await agent('deal-desk');
    const input = orgChangeAction.inputSchema.parse({ change: { kind: 'set_budget', agentSlug: 'deal-desk', dailyCents: 15_000 }, headline: 'Raise', reason: 'At cap.', evidence });

    const result = await orgChangeAction.execute(ctx, input);

    expect(result.hadRow).toBe(false);

    await orgChangeAction.undo!(ctx, input, result);

    expect(await getBudget({ orgId: ORG, agentSlug: 'deal-desk' })).toBeFalsy();
  });
});

describe('hire_agent and adopt_rule', () => {
  it('hires through team.hire_agent\'s own act, and Undo removes the hire', async () => {
    const input = orgChangeAction.inputSchema.parse({ change: { kind: 'hire_agent', catalogSlug: 'seo-specialist', dailyCents: 1_500 }, headline: 'Hire an SEO Specialist', reason: 'Revenue Ops is at 20% of target.', evidence });

    const result = await orgChangeAction.execute(ctx, input);

    expect(result).toMatchObject({ kind: 'hire_agent', hired: true, slug: 'seo-specialist' });
    expect(await getBudget({ orgId: ORG, agentSlug: 'seo-specialist' })).toMatchObject({ hardCentsLimit: 1_500 });

    await orgChangeAction.undo!(ctx, input, result);

    expect(await agentRow('seo-specialist')).toBeUndefined();
  });

  it('adopts a standing rule through the feedback loop\'s pipeline, carrying the evidence as its note', async () => {
    await db.insert(memoryNamespaceSchema).values({ orgId: ORG, name: 'global', path: 'workspace/global', title: 'Global', description: 'Workspace rules' });
    const input = orgChangeAction.inputSchema.parse({ change: { kind: 'adopt_rule', ruleText: 'Keep a first-touch email under 120 words.' }, headline: 'Adopt: keep first touches short', reason: 'Four of six sends were turned down as too long.', evidence });

    const result = await orgChangeAction.execute(ctx, input);

    expect(result).toMatchObject({ kind: 'adopt_rule', outcome: 'adopted' });
    expect((await getNamespace(ORG, 'global')).rules.map(r => r.ruleText)).toEqual(['Keep a first-touch email under 120 words.']);

    await orgChangeAction.undo!(ctx, input, result);

    expect((await getNamespace(ORG, 'global')).rules).toEqual([]);
  });
});

describe('the card', () => {
  it('leads with the change and lists the evidence, each line linked, dated', async () => {
    await agent('scout');
    const card = await orgChangeAction.reviewCard!(ctx, orgChangeAction.inputSchema.parse({ change: { kind: 'retire_agent', agentSlug: 'scout' }, headline: 'Retire Kestrel Scout', reason: 'Unused.', evidence, asOf: '2026-10-08T12:00:00.000Z' }));

    expect(card).toMatchObject({ title: 'Retire Kestrel Scout', system: 'Org review', verbs: { approve: 'Retire', reject: 'Decline' } });
    expect(card.fields).toContainEqual({ label: 'Last run', value: 'never', href: '/dashboard/team-report/scout' });
    expect(card.badges).toContainEqual({ label: 'Evidence as of 2026-10-08' });
  });

  it('keys one open proposal per agent and kind, per role, per rule', () => {
    expect(orgChangeTarget({ kind: 'set_budget', agentSlug: 'deal-desk', dailyCents: 1 })).toBe('deal-desk');
    expect(orgChangeTarget({ kind: 'hire_agent', catalogSlug: 'seo-specialist', dailyCents: 1 })).toBe('seo-specialist');
    expect(orgChangeTarget({ kind: 'adopt_rule', agentSlug: 'deal-desk', ruleText: 'Keep it SHORT!' })).toBe('deal-desk:keep it short');
  });
});
