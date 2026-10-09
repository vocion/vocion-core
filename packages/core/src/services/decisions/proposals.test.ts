/**
 * A PROPOSAL IS ITS OWN APPROVAL DECISION, answered through Review's own
 * decide path, as the person. And what waits on a person elsewhere queues in
 * the dock, answered where it lives. Scoped to the workspace and the
 * conversation. Fixtures are fictional (Northwind).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));
const decide = vi.fn(async (_item: unknown, verb: string) => ({ execution: { status: verb === 'approve' ? 'done' : 'rejected' } }));
const snooze = vi.fn(async () => {});
vi.mock('@/services/ReviewService', () => ({ decide: (...a: unknown[]) => (decide as (...x: unknown[]) => unknown)(...a), snooze: (...a: unknown[]) => (snooze as (...x: unknown[]) => unknown)(...a) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema } = await import('@/models/Schema');
const { answerProposal, proposalDecisionView } = await import('./proposals');
const { answerDecision, answerElsewhere, openDecisions, raiseDecision, waitingElsewhere } = await import('./DecisionService');

const ORG = 'org_proposals';
const DANA = 'usr-dana';

async function pending(over: Partial<typeof actionRunSchema.$inferInsert> = {}) {
  const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', input: { objectType: 'deal', id: '4410', properties: { dealstage: 'negotiation' } }, status: 'pending', invokedBy: 'agent:revenue-lead', proposal: { rationale: 'They signed the LOI.', suggestedDecision: 'approve', origin: { conversationId: 392 } }, ...over }).returning();
  return run!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
});

describe('a proposal read as a Decision', () => {
  it('is a permission prompt: the proposer\'s reason, the exact change, Allow once (with whether it can be undone) and Deny, its own conversation', async () => {
    const run = await pending();
    const view = await proposalDecisionView(run);

    expect(view).toMatchObject({ id: run.id, subject: 'proposal', kind: 'approval', state: 'open', agentSlug: 'revenue-lead', conversationId: 392, body: 'They signed the LOI.', href: `/dashboard/inbox/proposal-${run.id}` });
    expect(view.options.map(o => [o.id, o.label])).toEqual([['approve', 'Allow once'], ['reject', 'Deny']]);
    expect(view.options[0]).toMatchObject({ recommended: true });
    expect(view.options[0]!.consequence).toContain('with Undo');
    expect(view.preview).toContain('negotiation');
  });

  it('docks in the conversation it was filed from, beside that conversation\'s questions, oldest first', async () => {
    const run = await pending();
    const { view: ask } = await raiseDecision({ orgId: ORG, conversationId: 392, ownerUserId: DANA, agentSlug: 'revenue-lead', kind: 'input', question: 'Which stage name?' });
    await pending({ proposal: { origin: { conversationId: 999 } } });

    expect((await openDecisions(ORG, 392)).map(d => [d.subject, d.id])).toEqual([['proposal', run.id], ['ask', ask.id]]);
  });
});

describe('answering a proposal', () => {
  it('Approve decides the run as the person through Review\'s own path — the effect is the run, Undo where real', async () => {
    const run = await pending();
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: run.id, subject: 'proposal', answer: { kind: 'option', optionIds: ['approve'] }, by: DANA, via: 'card' });

    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: run.id }, 'approve', ORG, { reviewedBy: DANA });
    expect(out.effect).toMatchObject({ runId: run.id, actionId: 'hubspot.update', status: 'done', undoable: true });
  });

  it('their own words reject it with their note, for the proposer to revise', async () => {
    const run = await pending();
    await answerDecision({ orgId: ORG, conversationId: 392, id: run.id, subject: 'proposal', answer: { kind: 'free_text', text: 'Use Closed won instead' }, by: DANA, via: 'composer' });

    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: run.id }, 'reject', ORG, { reviewedBy: DANA, note: 'Use Closed won instead', reason: 'Use Closed won instead' });
  });

  it('Skip is "not now": snoozed back to Review, nothing decided', async () => {
    const run = await pending();
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: run.id, subject: 'proposal', answer: { kind: 'skip' }, by: DANA, via: 'card' });

    expect(snooze).toHaveBeenCalledWith(ORG, { kind: 'action', id: run.id }, expect.any(Date), DANA, { note: 'Skipped from chat' });
    expect(decide).not.toHaveBeenCalled();
    expect(out.view.state).toBe('skipped');
  });

  it('is not found from another conversation or workspace, and a decided one is a conflict', async () => {
    const run = await pending();

    await expect(answerProposal({ orgId: ORG, id: run.id, conversationId: 7, answer: { kind: 'skip' }, by: DANA })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(answerProposal({ orgId: 'org_someone_else', id: run.id, conversationId: null, answer: { kind: 'skip' }, by: DANA })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await db.update(actionRunSchema).set({ status: 'done' });

    await expect(answerProposal({ orgId: ORG, id: run.id, conversationId: 392, answer: { kind: 'option', optionIds: ['approve'] }, by: DANA })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('what waits on a person elsewhere', () => {
  it('queues Needs you questions (theirs or anyone\'s) and proposals from no conversation — never another person\'s, a credential, or another conversation\'s', async () => {
    const { upsertAsk } = await import('@/services/AskService');
    const { ask: mine } = await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Archive the Q3 board?', ownerUserId: DANA } });
    const { ask: anyone } = await upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'Which region is Northwind in?' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'input', title: 'Not yours', ownerUserId: 'usr-pat' } });
    await upsertAsk({ orgId: ORG, ask: { kind: 'credential', title: 'Paste the API key' } });
    await raiseDecision({ orgId: ORG, conversationId: 392, ownerUserId: DANA, agentSlug: 'revenue-lead', kind: 'input', question: 'In a conversation' });
    const loose = await pending({ proposal: { rationale: 'From a sweep.' } });
    await pending();

    const waiting = await waitingElsewhere(ORG, DANA);

    expect(waiting.map(d => [d.subject, d.id])).toEqual([['ask', mine.id], ['ask', anyone.id], ['proposal', loose.id]]);
  });

  it('is answered where it lives, with no conversation and no turn', async () => {
    const { upsertAsk } = await import('@/services/AskService');
    const { ask } = await upsertAsk({ orgId: ORG, ask: { kind: 'ruling', title: 'Archive the Q3 board?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] } });
    const out = await answerElsewhere({ orgId: ORG, subject: 'ask', id: ask.id, answer: { kind: 'option', optionIds: ['no'] }, by: DANA });

    expect(out.view.answer).toMatchObject({ optionIds: ['no'], via: 'needs_you' });

    const { view: here } = await raiseDecision({ orgId: ORG, conversationId: 392, ownerUserId: DANA, agentSlug: 'revenue-lead', kind: 'input', question: 'Docked here' });

    await expect(answerElsewhere({ orgId: ORG, subject: 'ask', id: here.id, answer: { kind: 'skip' }, by: DANA })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
