/**
 * DONE FOR YOU, FOR A RULING (Chris, 2026-09-29, proposal 5210: "overall that
 * card is complex?"). A ruling sure enough of its recommendation is answered
 * with it on the workspace's own trust bar for `ask.file` — the same ladder
 * verdict the filing ran on — decided by the trust bar, never as a person;
 * Undo reopens it. Below the bar, or when the option would start something,
 * a person decides. Fixtures are fictional.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { pickRecommended, TRUST_LADDER_DECIDER } = await import('./ask-file');
const { getAsk } = await import('@/services/AskService');
const { proposeAction, undoAction } = await import('@/services/ActionService');

const ORG = 'org_ask_ladder';

function productManager(): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['file_ask'], autonomy: 2, scope: { orgId: ORG } };
}

function ruling(over: Record<string, unknown> = {}, optionOver: Record<string, unknown> = {}) {
  return {
    title: 'Copy-link on locked rows?',
    body: 'Locked rows cannot be shared; the button either hides, disables or upsells.',
    kind: 'ruling',
    options: [
      { id: 'disabled', label: 'Show disabled' },
      { id: 'upsell', label: 'Show with upsell' },
      { id: 'hide', label: 'Hide on locked rows', recommended: true, ...optionOver },
    ],
    objectRefs: [{ type: 'request', id: 41 }],
    ...over,
  };
}

function file(confidence: number, input: Record<string, unknown>) {
  return proposeAction({
    orgId: ORG,
    actionId: 'ask.file',
    principal: productManager(),
    invokedBy: 'agent:product-manager',
    input,
    proposal: { confidence, rationale: 'Hiding matches how locked rows already read.', suggestedDecision: null, suggestedDecisionReason: null },
  }) as Promise<{ runId: number; status: string; result?: Record<string, unknown> }>;
}

async function resultOf(runId: number) {
  const [row] = await db.select().from(actionRunSchema).where((await import('drizzle-orm')).eq(actionRunSchema.id, runId));
  return row!.result as Record<string, unknown>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct_ask_ladder', name: 'Acme', slug: 'acme-l' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_ask_ladder', slug: 'acme-ladder', name: 'Acme ladder' });
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('a ruling above the trust bar answers itself with its recommendation', () => {
  it('files and decides the ask with the recommended option, by the trust bar, and says so', async () => {
    const res = await file(0.95, ruling());

    expect(res.status).toBe('done');

    const result = await resultOf(res.runId);

    expect(result).toMatchObject({ answered: 'hide', answeredLabel: 'Hide on locked rows', answeredBy: TRUST_LADDER_DECIDER });

    const ask = await getAsk(ORG, result.askId as number);

    expect(ask).toMatchObject({ status: 'done', decision: 'hide', decidedBy: 'trust-ladder' });
  });

  it('reads the option\'s own confidence before the proposal\'s', async () => {
    // The filing clears its bar; the recommendation itself is unsure.
    const res = await file(0.95, ruling({}, { confidence: 0.4 }));
    const result = await resultOf(res.runId);

    expect(result.answered).toBeNull();
    expect((await getAsk(ORG, result.askId as number))?.status).toBe('open');
  });

  it('Undo takes the answer back: the ask is open again, undecided', async () => {
    const res = await file(0.95, ruling());
    const askId = (await resultOf(res.runId)).askId as number;

    await undoAction(res.runId, ORG, { by: 'usr-dana' });

    expect(await getAsk(ORG, askId)).toMatchObject({ status: 'open', decision: null, decidedBy: null });
  });
});

describe('below the bar, or when a choice would start something, a person decides', () => {
  it('a workspace whose bar for asking is higher leaves the ruling open', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'ask.file', threshold: 0.99, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'ask.file', rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.99, source: 'trust.yaml' });
    // The filing is approved by a person; the ruling still waits for their answer.
    const res = await file(0.97, ruling({}, { confidence: 0.97 }));

    expect(res.status).toBe('pending');
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });

  it('an option that carries an action is never chosen for you: it would run as nobody', async () => {
    const res = await file(0.95, ruling({}, { action: { id: 'factory.dispatch_task', input: { taskId: 3 } } }));
    const result = await resultOf(res.runId);

    expect(result.answered).toBeNull();
    expect((await getAsk(ORG, result.askId as number))?.status).toBe('open');
  });

  it('only a ruling answers itself — a recommendation is read back by whoever asked', async () => {
    const res = await file(0.95, ruling({ kind: 'recommendation' }));
    const result = await resultOf(res.runId);

    expect(result.answered).toBeNull();
  });

  it('one recommended option, or none chosen', () => {
    expect(pickRecommended([{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }])?.id).toBe('a');
    expect(pickRecommended([{ id: 'a', label: 'A' }])).toBeNull();
    expect(pickRecommended([{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B', recommended: true }])).toBeNull();
  });
});
