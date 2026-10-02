/**
 * The proposal budget against PGlite: the built-in cap, the workspace's
 * override on the agent row, what counts (the agent's own pending runs and
 * open asks), the weekly idea cap, the person's-turn exemption, and the
 * withdrawal that frees a slot — its own only.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, askSchema } = await import('@/models/Schema');
const svc = await import('./ProposalBudgetService');

const ORG = 'org_proposal_budget';
const AGENT = 'product-manager';

async function wipe() {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(agentSchema);
}

async function pendingRun(title: string, opts: { agent?: string; actionId?: string; status?: string; createdAt?: Date; invokedBy?: string } = {}) {
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: opts.actionId ?? 'objects.propose_candidate',
    input: { title },
    status: opts.status ?? 'pending',
    invokedBy: opts.invokedBy ?? `agent:${opts.agent ?? AGENT}`,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  } as never).returning({ id: actionRunSchema.id });
  return row!.id;
}

async function openAsk(title: string, agent = AGENT) {
  const [row] = await db.insert(askSchema).values({ orgId: ORG, kind: 'recommendation', title, agentSlug: agent, status: 'open', options: [], objectRefs: [] } as never).returning({ id: askSchema.id });
  return row!.id;
}

beforeEach(wipe);

afterAll(wipe);

describe('whose turn it is', () => {
  it('identifies a factory step by its userId stamp, structurally — never by asking the model', () => {
    expect(svc.isFactoryStep({ userId: 'factory:product-manager' })).toBe(true);
    expect(svc.isFactoryStep({ userId: 'agent:product-manager' })).toBe(false);
    expect(svc.isFactoryStep({ userId: 'user_chris' })).toBe(false);
    expect(svc.isFactoryStep({ userId: 'scheduled' })).toBe(false);
    expect(svc.isFactoryStep({})).toBe(false);
    expect(svc.isFactoryStep({ userId: null })).toBe(false);
  });

  it('a person in the conversation exempts the turn; a schedule, a mission or no conversation does not', () => {
    expect(svc.isAgentsOwnSchedule({ userId: 'user_chris', conversationId: 12 })).toBe(false);
    expect(svc.isAgentsOwnSchedule({ userId: 'mcp', conversationId: 12 })).toBe(false);
    expect(svc.isAgentsOwnSchedule({ userId: 'scheduled', conversationId: 12 })).toBe(true);
    expect(svc.isAgentsOwnSchedule({ userId: 'user_chris', conversationId: 12, missionRunId: 7 })).toBe(true);
    expect(svc.isAgentsOwnSchedule({ userId: 'user_chris' })).toBe(true);
    expect(svc.isAgentsOwnSchedule({})).toBe(true);
  });
});

describe('the cap on undecided items', () => {
  it('applies the built-in budget to an agent nobody configured, and the row\'s when the workspace set one', async () => {
    expect(await svc.proposalBudgetFor(ORG, AGENT)).toEqual(svc.DEFAULT_PROPOSAL_BUDGET);

    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 2 } } } as never);

    expect(await svc.proposalBudgetFor(ORG, AGENT)).toEqual({ openMax: 2, weeklyMax: svc.DEFAULT_PROPOSAL_BUDGET.weeklyMax });
  });

  it('counts the agent\'s own pending runs and open asks, nobody else\'s, and refuses at the cap with the list', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 2, weeklyMax: 10 } } } as never);
    await pendingRun('Retry uploads');
    await pendingRun('Someone else\'s', { agent: 'designer' });
    await pendingRun('Decided already', { status: 'done' });

    expect(await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT })).toMatchObject({ ok: true, open: 1, openMax: 2 });

    await openAsk('Approve the roadmap page');
    const verdict = await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT });

    expect(verdict.ok).toBe(false);

    if (!verdict.ok) {
      expect(verdict.reason).toBe('open');
      expect(verdict.open.map(o => o.title)).toEqual(['Retry uploads', 'Approve the roadmap page']);
      expect(verdict.message).toContain('2 undecided items');
      expect(verdict.message).toContain('withdraw_proposal');
      expect(verdict.message).toContain('Retry uploads');
    }
  });

  it('caps new ideas per rolling week, counting every record the agent proposed whatever happened to it', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 50, weeklyMax: 2 } } } as never);
    await pendingRun('Idea one', { status: 'done' });
    await pendingRun('Idea two', { status: 'rejected' });
    await pendingRun('Old idea', { status: 'done', createdAt: new Date(Date.now() - 9 * 86_400_000) });

    const idea = await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, actionId: 'objects.propose_candidate' });
    const notIdea = await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, actionId: 'git.push_branch' });

    expect(idea).toMatchObject({ ok: false, reason: 'weekly', weekly: 2 });
    expect(notIdea.ok).toBe(true);
  });

  it('a factory step at the weekly cap still files; the agent\'s own idea at the same cap is still refused (prod #224, 2026-09-29)', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 50, weeklyMax: 10 } } } as never);
    // 11 of 10 this week, all the agent's own — exactly the prod shape.
    for (let i = 0; i < 11; i++) {
      await pendingRun(`Idea ${i}`, { status: 'done' });
    }

    const factoryPlan = await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, actionId: 'objects.propose_candidate', factoryStep: true });
    const agentsOwnIdea = await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, actionId: 'objects.propose_candidate' });

    expect(factoryPlan).toMatchObject({ ok: true });
    expect(agentsOwnIdea).toMatchObject({ ok: false, reason: 'weekly', weekly: 11 });
  });

  it('a factory-filed run (invokedBy factory:<slug>) never inflates the weekly count that bounds the agent\'s own ideas', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 50, weeklyMax: 2 } } } as never);
    await pendingRun('Filed by the factory', { status: 'done', invokedBy: `factory:${AGENT}` });
    await pendingRun('Filed by the factory too', { status: 'done', invokedBy: `factory:${AGENT}` });

    expect(await svc.weeklyIdeaCount(ORG, AGENT)).toBe(0);
    expect(await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, actionId: 'objects.propose_candidate' })).toMatchObject({ ok: true });
  });
});

describe('a factory step still shows up in the seat\'s own queue', () => {
  it('counts a factory-filed pending run toward the open (Review WIP) limit and its list, same as the agent\'s own', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 1, weeklyMax: 10 } } } as never);
    await pendingRun('Write the plan', { invokedBy: `factory:${AGENT}` });

    const open = await svc.openProposals(ORG, AGENT);

    expect(open.map(o => o.title)).toEqual(['Write the plan']);
    expect(await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT })).toMatchObject({ ok: false, reason: 'open' });
  });

  it('withdraws a factory-filed run in the agent\'s name, same as its own', async () => {
    const planId = await pendingRun('Write the plan', { invokedBy: `factory:${AGENT}` });

    expect(await svc.withdrawProposal({ orgId: ORG, agentSlug: AGENT, kind: 'run', id: planId, reason: 'superseded by a smaller plan' })).toEqual({ ok: true });
  });
});

describe('the Review limit counts only what would reach Review (backlog 038)', () => {
  it('does not refuse a proposal the trust ladder will run within bounds', async () => {
    const { trustRuleSchema } = await import('@/models/Schema');
    const { willExecuteOnItsOwn } = await import('@/services/ActionService');
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'PM', systemPrompt: 'x', model: 'm', temperature: '0.2', approvalPolicy: { proposals: { openMax: 1, weeklyMax: 10 } } } as never);
    await pendingRun('Already waiting');
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'ask.withdraw', threshold: 0.5, enabled: 'true' }).onConflictDoNothing();
    const principal = { kind: 'agent' as const, id: `agent:${AGENT}`, scope: { orgId: ORG }, grants: ['*'], autonomy: 2 as const };

    expect(await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT })).toMatchObject({ ok: false, reason: 'open' });
    expect(await svc.checkProposalBudget({ orgId: ORG, agentSlug: AGENT, queuesForPerson: false })).toMatchObject({ ok: true });
    // The ladder is asked the same way proposeAction asks it: above an enabled rule's bar it runs; below it, it waits.
    expect(await willExecuteOnItsOwn({ orgId: ORG, actionId: 'ask.withdraw', input: { askId: 7, reason: 'superseded' }, principal, proposal: { confidence: 0.9, suggestedDecision: 'approve' } })).toBe(true);
    expect(await willExecuteOnItsOwn({ orgId: ORG, actionId: 'ask.withdraw', input: { askId: 7, reason: 'superseded' }, principal, proposal: { confidence: 0.3, suggestedDecision: 'approve' } })).toBe(false);
    expect(await willExecuteOnItsOwn({ orgId: ORG, actionId: 'ask.withdraw', input: { askId: 7, reason: 'superseded' }, principal, proposal: { confidence: 0.9, suggestedDecision: 'reject' } })).toBe(false);
  });
});

describe('withdrawing to free a slot', () => {
  it('withdraws the agent\'s own pending run with the reason on the record, and refuses another agent\'s', async () => {
    const mine = await pendingRun('Retry uploads');
    const theirs = await pendingRun('Not mine', { agent: 'designer' });

    expect(await svc.withdrawProposal({ orgId: ORG, agentSlug: AGENT, kind: 'run', id: theirs, reason: 'x' })).toMatchObject({ ok: false, message: expect.stringContaining('not yours') });
    expect(await svc.withdrawProposal({ orgId: ORG, agentSlug: AGENT, kind: 'run', id: mine, reason: 'a narrower fix covers it', supersededBy: 'proposal #99' })).toEqual({ ok: true });

    const [row] = await db.select().from(actionRunSchema).where((await import('drizzle-orm')).eq(actionRunSchema.id, mine));

    expect(row?.status).toBe('rejected');
    expect(JSON.stringify(row)).toContain('superseded by proposal #99');
    expect(await svc.withdrawProposal({ orgId: ORG, agentSlug: AGENT, kind: 'run', id: mine, reason: 'again' })).toMatchObject({ ok: false, message: expect.stringContaining('already rejected') });
  });

  it('withdraws the agent\'s own open ask and leaves a person\'s alone', async () => {
    const mine = await openAsk('Approve the roadmap page');
    const theirs = await openAsk('Another agent\'s', 'designer');

    expect(await svc.withdrawProposal({ orgId: ORG, agentSlug: AGENT, kind: 'ask', id: theirs, reason: 'x' })).toMatchObject({ ok: false });
    expect(await svc.withdrawProposal({ orgId: ORG, agentSlug: AGENT, kind: 'ask', id: mine, reason: 'folded into the build card' })).toEqual({ ok: true });
    expect((await svc.openProposals(ORG, AGENT)).length).toBe(0);
    expect(await svc.proposalBudgetLine(ORG, AGENT)).toBe('open 0/5 · ideas 0/10 this week');
  });
});
