/**
 * `conversations.recordCardDecision` records a card's decision ON THE CARD —
 * the action, who, when, and which typed option — and never writes a turn the
 * person did not type. Before, it appended a USER message ("Approved the card
 * …"): the transcript showed words nobody wrote, and the next turn routed and
 * intent-read them. Org scoped. Fixtures are fictional (Northwind).
 */
import { ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { appendMessage, createConversation, listMessages } = await import('@/services/ConversationService');
const { recordCardDecision } = await import('./Conversations');

const ORG = 'org_card_decision';

function signedInTo(orgId: string) {
  vi.mocked(guardAuth).mockResolvedValue({ orgId, userId: 'usr-dana' } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

async function threadWithARuling() {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'product-manager', createdBy: 'usr-dana' });
  await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'which repo?', userId: 'usr-dana' });
  await appendMessage({
    orgId: ORG,
    conversationId: conv.id,
    role: 'assistant',
    content: 'Two repos match.',
    runs: [{ type: 'card', id: 'card_ruling1', kind: 'action', label: 'Rule: which repo?', actionId: 'ask.file', input: { kind: 'ruling' }, runId: 61, state: 'filed' }],
  });
  return conv;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

describe('conversations.recordCardDecision', () => {
  it('writes the decision and WHICH option onto the card, and no user turn', async () => {
    const conv = await threadWithARuling();
    signedInTo(ORG);
    const before = await listMessages({ orgId: ORG, conversationId: conv.id });

    const out = await call<{ recorded: boolean }>(recordCardDecision, { id: conv.id, cardId: 'card_ruling1', label: 'Rule: which repo?', action: 'approve', runId: 61, optionId: 'api' });

    expect(out.recorded).toBe(true);

    const after = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(after).toHaveLength(before.length);
    expect(after.filter(r => r.role === 'user').map(r => r.content)).toEqual(['which repo?']);

    const card = (after.find(r => r.role === 'assistant')!.runsJson ?? []).find(r => r.type === 'card');

    expect(card).toMatchObject({ state: 'decided', decision: { action: 'approve', by: 'usr-dana', option: 'api' } });
  });

  it('records a deferral as deferred', async () => {
    const conv = await threadWithARuling();
    signedInTo(ORG);
    await call(recordCardDecision, { id: conv.id, cardId: 'card_ruling1', label: 'Rule: which repo?', action: 'defer', runId: 61 });
    const card = ((await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant')!.runsJson ?? []).find(r => r.type === 'card');

    expect(card).toMatchObject({ state: 'deferred', decision: { action: 'defer' } });
  });

  it('is not-found from another workspace, and the card is untouched', async () => {
    const conv = await threadWithARuling();
    signedInTo('org_someone_else');
    const rejection = await call(recordCardDecision, { id: conv.id, cardId: 'card_ruling1', label: 'x', action: 'approve' }).catch(err => err);

    expect(rejection).toBeInstanceOf(ORPCError);

    const card = ((await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant')!.runsJson ?? []).find(r => r.type === 'card');

    expect(card).toMatchObject({ state: 'filed' });
  });
});
