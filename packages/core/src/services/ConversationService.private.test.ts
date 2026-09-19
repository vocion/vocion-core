/**
 * Containment — the half that actually leaks.
 *
 * Gating the credential keeps a colleague from RESOLVING somebody's Gmail
 * grant. It does nothing about what the grant already produced: a turn that
 * read Jamie's inbox writes that content into `conversation_message`, and
 * before 0121 `getConversation` and `listMessages` filtered by `org_id` alone
 * while `searchConversations` listed every unscoped thread — with a content
 * snippet — to every member.
 *
 * Each case below is one of the doors in the plan's matrix. All of them, or
 * half two is not done.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
  markConversationPrivate,
  searchConversations,
  tailMessages,
} = await import('@/services/ConversationService');

const ORG = 'org_private_test';
const JAMIE = 'user_jamie';
const DANA = 'user_dana';

/** A thread that read Jamie's mailbox, with the inbox content in it. */
async function inboxThread() {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: JAMIE });
  await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'what did Northwind say about the renewal?' });
  await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'assistant', content: 'Bellwater Hall wrote on Tuesday asking for a revised quote.' });
  await markConversationPrivate({ orgId: ORG, id: conv.id, userId: JAMIE });
  return conv;
}

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

afterAll(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

describe('a conversation that used a personal grant', () => {
  it('opens for its owner and for nobody else', async () => {
    const conv = await inboxThread();

    await expect(getConversation({ orgId: ORG, id: conv.id, requestedBy: JAMIE })).resolves.toMatchObject({ id: conv.id });
    // The real gap today: a colleague could open the thread and read the inbox.
    await expect(getConversation({ orgId: ORG, id: conv.id, requestedBy: DANA })).resolves.toBeNull();
  });

  it('hands its messages to nobody else, whoever asks', async () => {
    const conv = await inboxThread();

    await expect(listMessages({ orgId: ORG, conversationId: conv.id, requestedBy: JAMIE })).resolves.toHaveLength(2);
    await expect(listMessages({ orgId: ORG, conversationId: conv.id, requestedBy: DANA })).resolves.toEqual([]);
    // A caller that is not a person at all — a webhook, an API token, a
    // schedule. An org is not a person, and this thread is one person's.
    await expect(listMessages({ orgId: ORG, conversationId: conv.id, requestedBy: null })).resolves.toEqual([]);
    await expect(tailMessages({ orgId: ORG, conversationId: conv.id, requestedBy: DANA })).resolves.toEqual([]);
  });

  it('is absent from a colleague\'s history search, title and snippet alike', async () => {
    await inboxThread();

    const mine = await searchConversations({ orgId: ORG, q: 'Bellwater', requestedBy: JAMIE });
    const theirs = await searchConversations({ orgId: ORG, q: 'Bellwater', requestedBy: DANA });

    expect(mine).toHaveLength(1);
    // Most of the leak was here: the snippet IS the content.
    expect(theirs).toEqual([]);
  });

  it('stays private once marked, and stays with its first owner', async () => {
    const conv = await inboxThread();
    // Sticky: the transcript already holds Jamie's inbox content, so a second
    // call cannot hand the thread to somebody else.
    await markConversationPrivate({ orgId: ORG, id: conv.id, userId: DANA });

    await expect(getConversation({ orgId: ORG, id: conv.id, requestedBy: DANA })).resolves.toBeNull();
    await expect(getConversation({ orgId: ORG, id: conv.id, requestedBy: JAMIE })).resolves.toMatchObject({ id: conv.id });
  });

  it('leaves ordinary threads shared, which is every thread until one is marked', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: JAMIE });
    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'what is our pricing for Contoso Supply?' });

    await expect(getConversation({ orgId: ORG, id: conv.id, requestedBy: DANA })).resolves.toMatchObject({ id: conv.id });
    await expect(listMessages({ orgId: ORG, conversationId: conv.id, requestedBy: DANA })).resolves.toHaveLength(1);
    await expect(searchConversations({ orgId: ORG, q: 'Contoso', requestedBy: DANA })).resolves.toHaveLength(1);
  });
});
