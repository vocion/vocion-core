/**
 * `conversations.recordCardDecision` with `dismiss` — the person skipping a
 * choice question. It defers the card, writes the skip as their message, and
 * starts no agent turn; a question already answered cannot be skipped.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { createConversation, listMessages } = await import('@/services/ConversationService');
const { recordCardDecision } = await import('./Conversations');

const ORG = 'org_dismiss_router';

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

async function seedQuestion(state: string) {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'lead' });
  const [message] = await db.insert(conversationMessageSchema).values({
    conversationId: conv.id,
    role: 'assistant',
    content: '',
    runsJson: [{ type: 'card', id: 'card_q', kind: 'choice', label: 'What matters most?', actionId: '', state }],
  }).returning();
  return { conversationId: conv.id, messageId: message!.id };
}

async function cardState(messageId: number) {
  const [row] = await db.select({ runs: conversationMessageSchema.runsJson }).from(conversationMessageSchema).where(eq(conversationMessageSchema.id, messageId));
  return (row!.runs![0] as { state: string }).state;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(guardAuth).mockResolvedValue({ orgId: ORG, userId: 'usr-dismiss' } as unknown as Awaited<ReturnType<typeof guardAuth>>);
  await db.delete(conversationSchema);
});

describe('recordCardDecision dismiss', () => {
  it('skips an open question: the card is deferred and the skip is the person\'s message', async () => {
    const { conversationId, messageId } = await seedQuestion('proposed');

    await call(recordCardDecision, { id: conversationId, cardId: 'card_q', label: 'What matters most?', action: 'dismiss' });

    expect(await cardState(messageId)).toBe('deferred');

    const user = (await listMessages({ orgId: ORG, conversationId })).find(r => r.role === 'user');

    expect(user?.content).toBe('Skipped the question "What matters most?".');
  });

  it('cannot skip a question that was already answered, and writes nothing', async () => {
    const { conversationId, messageId } = await seedQuestion('decided');

    const rejection = await call(recordCardDecision, { id: conversationId, cardId: 'card_q', label: 'What matters most?', action: 'dismiss' }).catch(err => err);

    expect(rejection).toBeInstanceOf(Error);
    expect(await cardState(messageId)).toBe('decided');
    expect((await listMessages({ orgId: ORG, conversationId })).filter(r => r.role === 'user')).toHaveLength(0);
  });
});
