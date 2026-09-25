/**
 * ask.file / ask.withdraw — the promises an agent's question rests on: it is
 * registered and gated like every other write, a confident filing lands on
 * Needs you at once with who asked and what it is about, a trust rule holds
 * it for a person, Undo withdraws it while it is open and never unwrites an
 * answer, and a withdrawal reopens with Undo.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { askFileAction } = await import('./ask-file');
const { askWithdrawAction } = await import('./ask-withdraw');
const { listActions } = await import('./registry');
const { decideAsk, getAsk } = await import('@/services/AskService');
const { executeAction, proposeAction, undoAction } = await import('@/services/ActionService');
const { track } = await import('@/services/adoption/track');
const { eq } = await import('drizzle-orm');

const ORG = 'org_ask_file';

function productManager(): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['file_ask'], autonomy: 2, scope: { orgId: ORG } };
}

function question(over: Record<string, unknown> = {}) {
  return {
    title: 'Build the CSV export, or answer with the API?',
    body: 'Seven people asked this month. The API already does it; the export is a day of work.',
    kind: 'recommendation',
    options: [
      { id: 'build', label: 'Build the export', description: 'A day of work; in the next release.', recommended: true, confidence: 0.7 },
      { id: 'answer', label: 'Answer with the API', description: 'A written reply pointing at the endpoint.' },
    ],
    groupKey: 'product:batch-2026-09-20',
    groupTitle: 'This week\'s ten',
    missionSlug: 'product-review',
    objectRefs: [{ type: 'request', id: 12 }, { type: 'request', id: '31' }],
    decisionCost: 3,
    origin: { missionRunId: 77 },
    ...over,
  };
}

function file(confidence = 0.9, over: Record<string, unknown> = {}) {
  return proposeAction({
    orgId: ORG,
    actionId: 'ask.file',
    principal: productManager(),
    invokedBy: 'agent:product-manager',
    input: question(over),
    proposal: { confidence, rationale: 'test', suggestedDecision: null, suggestedDecisionReason: null },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct_ask_file', name: 'Acme', slug: 'acme' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_ask_file', slug: 'acme-product', name: 'Acme product' });
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('registration', () => {
  it('both kinds are registered, internal, reversible and on the file_ask grant', () => {
    const ids = listActions().map(a => a.id);

    expect(ids).toContain('ask.file');
    expect(ids).toContain('ask.withdraw');

    for (const action of [askFileAction, askWithdrawAction]) {
      expect(action.external).toBe(false);
      expect(action.undo).toBeDefined();
      expect(action.grant).toBe('file_ask');
    }
  });

  it('a question with no idempotency key stands as its own card; one with a key collapses onto it', () => {
    expect(askFileAction.dedupKeyFor!(askFileAction.inputSchema.parse(question()))).toBeUndefined();
    expect(askFileAction.dedupKeyFor!(askFileAction.inputSchema.parse(question({ sourceRef: 'PM:Batch-1/3' })))).toBe('ask.file:pm:batch-1/3');
  });

  it('takes an app path or an https URL as the context link, and nothing else (walk 20)', () => {
    const ok = (contextUrl: string) => askFileAction.inputSchema.safeParse({ title: 'Ship it?', contextUrl }).success;

    // The form this action writes itself, and the one the model reaches for.
    expect(ok('/dashboard/inbox/110')).toBe(true);
    expect(ok('https://github.com/fictional-co/send/pull/27')).toBe(true);
    expect(ok('//evil.example/phish')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('inbox/110')).toBe(false);
  });

  it('defaults the kind to approval and keeps object ids as strings', () => {
    const parsed = askFileAction.inputSchema.parse({ title: 'Ship it?', objectRefs: [{ type: 'release', id: 4 }] });

    expect(parsed.kind).toBe('approval');
    expect(parsed.objectRefs).toEqual([{ type: 'release', id: '4' }]);
  });
});

describe('done for you — a confident filing lands on Needs you', () => {
  it('creates the ask owned by the agent, bound to the run, about the records, with its URL', async () => {
    const res = await file(0.9);

    expect(res.status).toBe('done');

    const result = res.result as Record<string, unknown>;
    const ask = await getAsk(ORG, result.askId as number);

    expect(ask).not.toBeNull();
    expect(ask!.status).toBe('open');
    expect(ask!.kind).toBe('recommendation');
    expect(ask!.agentSlug).toBe('product-manager');
    expect(ask!.createdBy).toBe('agent:product-manager');
    expect(ask!.sourceRef).toBe(`action_run:${res.runId}`);
    expect(ask!.groupKey).toBe('product:batch-2026-09-20');
    expect(ask!.objectRefs).toEqual([{ type: 'request', id: '12' }, { type: 'request', id: '31' }]);
    expect(ask!.decisionCost).toBe(3);
    expect(ask!.options.map(o => o.id)).toEqual(['build', 'answer']);
    // The context link reaches the mission run the question came up in.
    expect(ask!.contextUrl).toBe('/dashboard/missions/product-review/77');
    expect(result.url).toMatch(/\/w\/acme-product\/dashboard\/inbox\/\d+$/);
    expect(result.created).toBe(true);
  });

  it('re-executing the same run updates the ask it filed instead of asking twice', async () => {
    const res = await file(0.9);
    // A failed-then-retried execution lands on the same sourceRef.
    await db.update(actionRunSchema).set({ status: 'failed' }).where(eq(actionRunSchema.id, res.runId));
    const again = await executeAction(res.runId, ORG);

    expect(again.status).toBe('done');
    expect((again.result as { created: boolean }).created).toBe(false);
    expect(await db.select().from(askSchema).where(eq(askSchema.orgId, ORG))).toHaveLength(1);
  });

  it('refuses two recommended options before any run or ask exists', async () => {
    await expect(file(0.9, {
      options: [{ label: 'A', recommended: true }, { label: 'B', recommended: true }],
    })).rejects.toThrow(/at most one option may be recommended/);

    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });

  it('the decision carries the agent, the kind and the records to the adoption stream', async () => {
    const res = await file(0.9);
    const askId = (res.result as { askId: number }).askId;

    await decideAsk({ orgId: ORG, id: askId, decision: 'build', decidedBy: 'user_chris' });

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG }),
      'ask.decided',
      expect.objectContaining({
        agentSlug: 'product-manager',
        meta: expect.objectContaining({
          kind: 'recommendation',
          status: 'done',
          objectRefs: [{ type: 'request', id: '12' }, { type: 'request', id: '31' }],
        }),
      }),
    );
  });
});

describe('the gate — a trust rule holds a filing for a person', () => {
  it('under the default bar the proposal to ask waits, and no ask exists yet', async () => {
    const res = await file(0.5);

    expect(res.status).toBe('pending');
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });

  it('a workspace that parks ask.file at approval keeps every filing for a person, however confident', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'ask.file', threshold: 0.9, enabled: 'false' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'ask.file', rung: 'execute-with-approval', riskTier: 'low', minConfidence: 0.9, source: 'trust.yaml' });

    const res = await file(0.99);

    expect(res.status).toBe('pending');
    expect(await db.select().from(askSchema)).toHaveLength(0);

    // Approval files it, credited to the person.
    const approved = await executeAction(res.runId, ORG, { reviewedBy: 'user_chris' });

    expect(approved.status).toBe('done');

    const ask = await getAsk(ORG, (approved.result as { askId: number }).askId);

    expect(ask!.status).toBe('open');
    expect(ask!.agentSlug).toBe('product-manager');
  });

  it('a rule that automates above a floor lets a filing over it through and holds one under it', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'ask.file', threshold: 0.95, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'ask.file', rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.95, source: 'trust.yaml' });

    expect((await file(0.9)).status).toBe('pending');
    expect((await file(0.96)).status).toBe('done');
    expect(await db.select().from(askSchema)).toHaveLength(1);
  });
});

describe('undo — the filing is withdrawn, an answer is never unwritten', () => {
  it('undoing a filed ask supersedes it while it is open', async () => {
    const res = await file(0.9);
    const askId = (res.result as { askId: number }).askId;

    const undone = await undoAction(res.runId, ORG, { by: 'user_chris' });

    expect(undone.status).toBe('undone');

    const ask = await getAsk(ORG, askId);

    expect(ask!.status).toBe('superseded');
    expect(ask!.decisionNote).toMatch(/undone by user_chris/);
  });

  it('undoing a filing a person already answered leaves the answer alone and says so', async () => {
    const res = await file(0.9);
    const askId = (res.result as { askId: number }).askId;
    await decideAsk({ orgId: ORG, id: askId, decision: 'approve', decidedBy: 'user_chris' });

    await undoAction(res.runId, ORG, { by: 'user_chris' });

    const ask = await getAsk(ORG, askId);
    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(ask!.status).toBe('approved');
    expect((run!.result as { undo: { withdrawn: boolean } }).undo.withdrawn).toBe(false);
  });
});

describe('ask.withdraw', () => {
  it('closes an open ask as superseded with the reason, and Undo reopens it', async () => {
    const filed = await file(0.9);
    const askId = (filed.result as { askId: number }).askId;

    const res = await proposeAction({
      orgId: ORG,
      actionId: 'ask.withdraw',
      principal: productManager(),
      invokedBy: 'agent:product-manager',
      input: { askId, reason: 'Request 12 was closed as a duplicate.' },
      proposal: { confidence: 0.9, rationale: 'moot', suggestedDecision: null, suggestedDecisionReason: null },
    });

    expect(res.status).toBe('done');
    expect((await getAsk(ORG, askId))!.status).toBe('superseded');
    expect((await getAsk(ORG, askId))!.decisionNote).toBe('Request 12 was closed as a duplicate.');

    await undoAction(res.runId, ORG, { by: 'user_chris' });

    expect((await getAsk(ORG, askId))!.status).toBe('open');
    expect((await getAsk(ORG, askId))!.decisionNote).toBeNull();
  });

  it('refuses a decided ask and an unknown one before any run exists', async () => {
    const filed = await file(0.9);
    const askId = (filed.result as { askId: number }).askId;
    await decideAsk({ orgId: ORG, id: askId, decision: 'reject', decidedBy: 'user_chris' });

    await expect(proposeAction({
      orgId: ORG,
      actionId: 'ask.withdraw',
      principal: productManager(),
      input: { askId, reason: 'moot' },
    })).rejects.toThrow(/already rejected/);
    await expect(proposeAction({
      orgId: ORG,
      actionId: 'ask.withdraw',
      principal: productManager(),
      input: { askId: 99_999, reason: 'moot' },
    })).rejects.toThrow(/No ask #99999/);

    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.actionId, 'ask.withdraw'))).toHaveLength(0);
  });
});
