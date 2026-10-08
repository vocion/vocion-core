/**
 * Raising a Decision in a conversation and taking its answer as a record.
 * Every read and write is scoped to the workspace AND the conversation.
 * Fixtures are fictional (Northwind, Kestrel Capital; people at .example).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));

// The chosen option's effect runs through the action rail as the person; here
// the rail writes a done run the way a real execute would.
const proposed: Array<{ actionId: string; input: unknown; principal: unknown }> = [];
vi.mock('@/services/ActionService', async () => {
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  return {
    proposeAction: vi.fn(async (opts: { orgId: string; actionId: string; input: Record<string, unknown>; principal: unknown }) => {
      proposed.push({ actionId: opts.actionId, input: opts.input, principal: opts.principal });
      const [run] = await db.insert(actionRunSchema).values({ orgId: opts.orgId, actionId: opts.actionId, input: opts.input, status: 'done' }).returning();
      return { runId: run!.id, status: 'done' };
    }),
    executeAction: vi.fn(),
  };
});

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema } = await import('@/models/Schema');
const { answerDecision, DecisionError, openDecisions, raiseDecision } = await import('./DecisionService');

const ORG = 'org_decisions';
const OTHER_ORG = 'org_decisions_other';
const DANA = 'usr-dana';

async function raiseRepoQuestion(over: Partial<Parameters<typeof raiseDecision>[0]> = {}) {
  return raiseDecision({
    orgId: ORG,
    conversationId: 392,
    ownerUserId: DANA,
    agentSlug: 'product-manager',
    kind: 'ruling',
    question: 'Which repo should the factory build in?',
    body: 'Two repos match "Northwind".',
    options: [
      { id: 'portal', label: 'Northwind Portal', description: 'Builds land in the customer portal.' },
      { id: 'api', label: 'Northwind API', description: 'Builds land in the API.', recommended: true, action: { id: 'objects.update_meta', input: { objectId: 7, fields: { repo: 'northwind/api' } } } },
    ],
    ...over,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  proposed.length = 0;
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
});

describe('raising a Decision', () => {
  it('docks it in the conversation, owned by the person there, asked by the agent — the recommendation first', async () => {
    const { view, created } = await raiseRepoQuestion();

    expect(created).toBe(true);
    expect(view).toMatchObject({ kind: 'choice', state: 'open', conversationId: 392, ownerUserId: DANA, agentSlug: 'product-manager', allowOther: true, multiple: false });
    expect(view.options.map(o => o.id)).toEqual(['api', 'portal']);
    expect((await openDecisions(ORG, 392)).map(d => d.id)).toEqual([view.id]);
  });

  it('asks one question once: the same open question asked again is refreshed, not doubled', async () => {
    const first = await raiseRepoQuestion();
    const again = await raiseRepoQuestion({ body: 'Three repos match now.' });

    expect(again.created).toBe(false);
    expect(again.view.id).toBe(first.view.id);
    expect(await openDecisions(ORG, 392)).toHaveLength(1);
  });

  it('lists what a conversation waits on, oldest first, and nothing from another conversation or workspace', async () => {
    const a = await raiseRepoQuestion();
    const b = await raiseRepoQuestion({ question: 'Ship it behind a flag?', kind: 'approval', options: [] });
    await raiseRepoQuestion({ conversationId: 393, question: 'Rename the board?' });
    await raiseRepoQuestion({ orgId: OTHER_ORG, question: 'Archive Kestrel Capital?' });

    expect((await openDecisions(ORG, 392)).map(d => d.id)).toEqual([a.view.id, b.view.id]);
    expect(await openDecisions(OTHER_ORG, 392)).toHaveLength(1);
  });
});

describe('answering a Decision', () => {
  it('records the chosen option, where it was answered, and runs its effect AS THE PERSON — the run Undo names', async () => {
    const { view } = await raiseRepoQuestion();
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['api'] }, by: DANA, via: 'card' });

    expect(out.view.state).toBe('answered');
    expect(out.view.answer).toMatchObject({ kind: 'option', optionIds: ['api'], labels: ['Northwind API'], via: 'card', by: DANA });
    expect(proposed).toEqual([{ actionId: 'objects.update_meta', input: { objectId: 7, fields: { repo: 'northwind/api' } }, principal: expect.objectContaining({ kind: 'user', id: DANA }) }]);
    expect(out.effect).toMatchObject({ actionId: 'objects.update_meta', status: 'done', label: 'Which repo should the factory build in? — Northwind API' });

    const [row] = await db.select().from(askSchema);

    expect(row!.effectRunId).toBe(out.effect!.runId);
    expect(row!.decidedVia).toBe('card');
    expect(row!.chosenOptionIds).toEqual(['api']);
    expect(await openDecisions(ORG, 392)).toHaveLength(0);
  });

  it('promises Undo on the effect only where its kind has one', async () => {
    const { view } = await raiseRepoQuestion({ options: [{ id: 'send', label: 'Send it', action: { id: 'gmail.send', input: { to: 'pat@northwind.example' } } }, { id: 'hold', label: 'Hold' }] });
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['send'] }, by: DANA, via: 'card' });

    expect(out.effect).toMatchObject({ actionId: 'gmail.send', undoable: false });
  });

  it('takes an answer in their own words as the "other" answer, with their words as the note', async () => {
    const { view } = await raiseRepoQuestion();
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'free_text', text: 'Neither — the Kestrel Capital fork' }, by: DANA, via: 'composer' });

    expect(out.view.answer).toMatchObject({ kind: 'free_text', freeText: 'Neither — the Kestrel Capital fork', via: 'composer' });
    expect(proposed).toHaveLength(0);
  });

  it('closes a skip as skipped, with no answer and nothing run', async () => {
    const { view } = await raiseRepoQuestion();
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'skip' }, by: DANA, via: 'card' });

    expect(out.view.state).toBe('skipped');
    expect(out.view.answer?.kind).toBe('skip');
    expect(proposed).toHaveLength(0);
  });

  it('takes several options where several may be chosen, in order', async () => {
    const { view } = await raiseRepoQuestion({ multiple: true, options: [{ id: 'a', label: 'Uploads' }, { id: 'b', label: 'Exports' }, { id: 'c', label: 'Billing' }] });
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['a', 'c'] }, by: DANA, via: 'card' });

    expect(out.view.answer).toMatchObject({ optionIds: ['a', 'c'], labels: ['Uploads', 'Billing'] });
  });

  it('refuses "1 and 3" as two options on a Decision that takes one', async () => {
    const { view } = await raiseRepoQuestion({ options: [{ id: 'a', label: 'Uploads' }, { id: 'b', label: 'Exports' }, { id: 'c', label: 'Billing' }] });

    await expect(answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['a', 'c'] }, by: DANA, via: 'card' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('never overwrites an answer: the second one is a conflict', async () => {
    const { view } = await raiseRepoQuestion();
    await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['portal'] }, by: DANA, via: 'card' });

    await expect(answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['api'] }, by: DANA, via: 'composer' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('finds nothing to answer in another conversation or another workspace (tenant scoping)', async () => {
    const { view } = await raiseRepoQuestion();

    await expect(answerDecision({ orgId: ORG, conversationId: 999, id: view.id, answer: { kind: 'skip' }, by: DANA, via: 'card' })).rejects.toBeInstanceOf(DecisionError);
    await expect(answerDecision({ orgId: OTHER_ORG, conversationId: 392, id: view.id, answer: { kind: 'skip' }, by: DANA, via: 'card' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await openDecisions(ORG, 392)).map(d => d.id)).toEqual([view.id]);
  });
});

describe('Build it, as a Decision the person takes', () => {
  it('raises "Build <card>" for the intake\'s owner with the card\'s facts and id — no words in the person\'s name', async () => {
    const { artifactSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    await db.delete(businessObjectTypeSchema);
    await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { 'x-intake': true, 'x-owner': 'product-manager' } } as never);
    const [card] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'record', title: 'Request link creator', spec: { fields: [{ k: 'Why', v: 'No link can be made today.' }, { k: 'Owner', v: null }] } } as never).returning();
    const { buildDecisionFor } = await import('./DecisionService');
    const view = await buildDecisionFor({ orgId: ORG, userId: DANA, conversationId: 392, artifactId: card!.id });

    expect(view).toMatchObject({ question: 'Build "Request link creator"', body: 'Why: No link can be made today.', agentSlug: 'product-manager', ownerUserId: DANA, conversationId: 392, refs: [{ type: 'artifact', id: String(card!.id) }] });
    expect(view.options).toEqual([expect.objectContaining({ id: 'build', label: 'Build it', recommended: true })]);

    await db.delete(businessObjectTypeSchema);
    await db.delete(artifactSchema);
  });

  it('refuses where nothing builds a card', async () => {
    const { businessObjectTypeSchema } = await import('@/models/Schema');
    await db.delete(businessObjectTypeSchema);
    const { buildDecisionFor } = await import('./DecisionService');

    await expect(buildDecisionFor({ orgId: ORG, userId: DANA, conversationId: 392, artifactId: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
