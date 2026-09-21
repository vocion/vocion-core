/**
 * file_ask / withdraw_ask as the agent works them: the tool stamps who is
 * asking and where the question came up, says plainly whether the question
 * was asked or is waiting for a go-ahead, and lets an agent take back only
 * what it filed.
 */
import type { AgentEvent, RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { fileAskTool, withdrawAskTool } = await import('./fileAsk');
const { getAsk, upsertAsk } = await import('@/services/AskService');

const ORG = 'org_file_ask_tool';

function ctxFor(over: Partial<RuntimeContext> = {}): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    orgId: ORG,
    userId: 'scheduled',
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs: ['request'],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    missionSlug: 'product-review',
    missionRunId: 41,
    emit: e => events.push(e),
    events,
    ...over,
  } as RuntimeContext & { events: AgentEvent[] };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct_file_ask', name: 'Acme', slug: 'acme' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_file_ask', slug: 'acme', name: 'Acme' });
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('file_ask', () => {
  it('files the question as the agent, bound to the mission run, and hands back the id and the link', async () => {
    const ctx = ctxFor();
    const out = await fileAskTool(ctx).invoke({
      title: 'Build the export or answer with the API?',
      body: 'Seven asked. The API already does it.',
      kind: 'recommendation',
      options: ['Build it', { label: 'Answer with the API', recommended: true }],
      group_key: 'product:batch-1',
      object_refs: [{ type: 'request', id: 12 }],
      decision_cost: 2,
      confidence: 0.9,
    });

    expect(out).toMatch(/^Ask #\d+ filed \(recommendation, run #\d+\)\. It is on Needs you: .*\/w\/acme\/dashboard\/inbox\/\d+ Part of decision sheet "product:batch-1"\./);
    expect(out).toMatch(/say the question was asked, not answered/);

    const [ask] = await db.select().from(askSchema);

    expect(ask!.agentSlug).toBe('product-manager');
    expect(ask!.contextUrl).toBe('/dashboard/missions/product-review/41');
    expect(ask!.objectRefs).toEqual([{ type: 'request', id: '12' }]);
    expect(ask!.decisionCost).toBe(2);
    expect(ask!.options.map(o => o.id)).toEqual(['build-it', 'answer-with-the-api']);
    expect(ctx.events.some(e => (e as { tool?: string }).tool === 'file_ask')).toBe(true);
  });

  it('says the question is waiting for a go-ahead, not asked, when the bar is not met', async () => {
    const out = await fileAskTool(ctxFor()).invoke({ title: 'Ship it?', confidence: 0.4 });

    expect(out).toMatch(/PENDING a person's decision first/);
    expect(out).toMatch(/Do NOT say the question was asked/);
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });

  it('reports a refusal from the rail as a sentence the model can act on', async () => {
    const out = await fileAskTool(ctxFor()).invoke({
      title: 'Which?',
      options: [{ label: 'A', recommended: true }, { label: 'B', recommended: true }],
      confidence: 0.9,
    });

    expect(out).toMatch(/^Ask refused \(VALIDATION_FAILED\): at most one option may be recommended/);
  });
});

describe('withdraw_ask', () => {
  it('withdraws what this agent filed, and refuses another agent\'s question', async () => {
    const mine = await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Mine', agentSlug: 'product-manager' } });
    const theirs = await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Theirs', agentSlug: 'task-planner' } });
    const ctx = ctxFor();

    const refused = await withdrawAskTool(ctx).invoke({ ask_id: theirs.ask.id, reason: 'moot', confidence: 0.9 });

    expect(refused).toMatch(/Refused: ask #\d+ was filed by "task-planner"/);
    expect((await getAsk(ORG, theirs.ask.id))!.status).toBe('open');

    const out = await withdrawAskTool(ctx).invoke({ ask_id: mine.ask.id, reason: 'Request 12 closed as a duplicate.', confidence: 0.9 });

    expect(out).toMatch(/^Ask #\d+ withdrawn \("Mine", run #\d+\)/);
    expect((await getAsk(ORG, mine.ask.id))!.status).toBe('superseded');
  });

  it('tells the agent the answer when the ask was already decided', async () => {
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'approval', title: 'Mine', agentSlug: 'product-manager' } });
    await db.update(askSchema).set({ status: 'approved', decision: 'approve' });

    const out = await withdrawAskTool(ctxFor()).invoke({ ask_id: ask.id, reason: 'moot', confidence: 0.9 });

    expect(out).toMatch(/already approved; there is nothing to withdraw\. The answer was "approve"/);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });
});
