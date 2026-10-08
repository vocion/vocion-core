/**
 * ANSWERS FIRST: before a turn is routed or intent-read, a card's typed answer
 * is recorded as it is, and typed words are read against the open Decision.
 * The model read is injected; code routes on its typed field.
 * Fixtures are fictional (Northwind).
 */
import type { DecisionAnswerReading } from '@/services/agents/turnJudge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));

const { db } = await import('@/libs/DB');
const { askSchema } = await import('@/models/Schema');
const { raiseDecision } = await import('./DecisionService');
const { answersFirst, stillOpenNote } = await import('./answersFirst');

const ORG = 'org_answers_first';
const DANA = 'usr-dana';

async function dockQuestion(over: Partial<Parameters<typeof raiseDecision>[0]> = {}) {
  const { view } = await raiseDecision({
    orgId: ORG,
    conversationId: 392,
    ownerUserId: DANA,
    agentSlug: 'product-manager',
    kind: 'ruling',
    question: 'Which area should the factory start on?',
    options: [{ id: 'uploads', label: 'Uploads', recommended: true }, { id: 'exports', label: 'Exports' }, { id: 'billing', label: 'Billing' }],
    ...over,
  });
  return view;
}

/**
 * A judge that reads the message as this, and remembers it was asked.
 * @param reading
 */
function judgeSaying(reading: DecisionAnswerReading) {
  return vi.fn(async () => reading);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(askSchema);
});

describe('a card\'s answer arrives typed', () => {
  it('is recorded as it is — nothing read, nothing routed', async () => {
    const view = await dockQuestion();
    const read = judgeSaying({ kind: 'none', option_ids: [], free_text: null });
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '', wire: { id: view.id, option_ids: ['exports'] }, read });

    expect(out.kind).toBe('answered');
    expect(out.kind === 'answered' && out.source).toBe('card');
    expect(out.kind === 'answered' && out.answered.view.answer).toMatchObject({ optionIds: ['exports'], via: 'card' });
    expect(read).not.toHaveBeenCalled();
  });

  it('is refused, with a status, when it is malformed, not in this conversation, or already decided', async () => {
    const view = await dockQuestion();

    expect(await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '', wire: { id: view.id } })).toMatchObject({ kind: 'refused', status: 400 });
    expect(await answersFirst({ orgId: ORG, userId: DANA, conversationId: 999, message: '', wire: { id: view.id, skip: true } })).toMatchObject({ kind: 'refused', status: 404 });
    expect(await answersFirst({ orgId: 'org_someone_else', userId: DANA, conversationId: 392, message: '', wire: { id: view.id, skip: true } })).toMatchObject({ kind: 'refused', status: 404 });

    await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '', wire: { id: view.id, skip: true } });

    expect(await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '', wire: { id: view.id, option_ids: ['exports'] } })).toMatchObject({ kind: 'refused', status: 409 });
  });
});

describe('typed words are read against the open Decision before routing', () => {
  it('"the second one" — an option, recorded as answered in the composer', async () => {
    const view = await dockQuestion();
    const read = judgeSaying({ kind: 'option', option_ids: ['exports'], free_text: null });
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: 'the second one', read });

    expect(read).toHaveBeenCalledWith(expect.objectContaining({ message: 'the second one', decision: expect.objectContaining({ id: view.id }) }));
    expect(out.kind === 'answered' && out.source).toBe('composer');
    expect(out.kind === 'answered' && out.answered.answer).toEqual({ kind: 'option', optionIds: ['exports'] });
  });

  it('"1 and 3" on a Decision that takes one is their words, sent to the asker as a free-text answer', async () => {
    await dockQuestion();
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '1 and 3', read: judgeSaying({ kind: 'option', option_ids: ['uploads', 'billing'], free_text: null }) });

    expect(out.kind === 'answered' && out.answered.answer).toEqual({ kind: 'free_text', text: '1 and 3' });
  });

  it('"1 and 3" on a Decision that takes several is both options, in order', async () => {
    await dockQuestion({ multiple: true });
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '1 and 3', read: judgeSaying({ kind: 'option', option_ids: ['uploads', 'billing'], free_text: null }) });

    expect(out.kind === 'answered' && out.answered.answer).toEqual({ kind: 'option', optionIds: ['uploads', 'billing'] });
  });

  it('"1 and 3" where only options are accepted routes as usual, and the Decision stays docked', async () => {
    const view = await dockQuestion({ allowOther: false });
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: '1 and 3', read: judgeSaying({ kind: 'option', option_ids: ['uploads', 'billing'], free_text: null }) });

    expect(out).toEqual({ kind: 'none', open: expect.objectContaining({ id: view.id, state: 'open' }) });
  });

  it('a genuinely new topic routes as usual — told the Decision is still waiting', async () => {
    const view = await dockQuestion();
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: 'what did Northwind say yesterday?', read: judgeSaying({ kind: 'none', option_ids: [], free_text: null }) });

    expect(out.kind).toBe('none');
    expect(out.kind === 'none' && out.open?.id).toBe(view.id);
    expect(stillOpenNote(view)).toContain(`Decision #${view.id} ("Which area should the factory start on?") is still docked`);
  });

  it('an option the Decision does not have is read as their words', async () => {
    await dockQuestion();
    const out = await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: 'go with search', read: judgeSaying({ kind: 'option', option_ids: ['search'], free_text: null }) });

    expect(out.kind === 'answered' && out.answered.answer).toEqual({ kind: 'free_text', text: 'go with search' });
  });

  it('reads nothing when nothing is open, or there is no conversation', async () => {
    const read = judgeSaying({ kind: 'option', option_ids: ['uploads'], free_text: null });

    expect(await answersFirst({ orgId: ORG, userId: DANA, conversationId: 392, message: 'hello', read })).toEqual({ kind: 'none', open: null });
    expect(await answersFirst({ orgId: ORG, userId: DANA, conversationId: null, message: 'hello', read })).toEqual({ kind: 'none', open: null });
    expect(read).not.toHaveBeenCalled();
  });
});
