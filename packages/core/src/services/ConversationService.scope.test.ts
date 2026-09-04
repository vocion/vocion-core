import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const {
  appendMessage,
  createConversation,
  latestConversationForScope,
  listMessages,
} = await import('@/services/ConversationService');

const ORG = 'org_scope_test';
const SCOPE = 'contacts:9412';

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

afterAll(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

describe('scoped conversations', () => {
  it('createConversation persists the scopeRef; unscoped rows stay null', async () => {
    const scoped = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', scopeRef: SCOPE, createdBy: 'user_v' });
    const unscoped = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: 'user_v' });

    expect(scoped.scopeRef).toBe(SCOPE);
    expect(unscoped.scopeRef).toBeNull();
  });

  it('latestConversationForScope returns the newest conversation for the scope', async () => {
    const older = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', scopeRef: SCOPE, createdBy: 'user_v' });
    // A message bump makes the second thread the newest by updatedAt.
    const newer = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', scopeRef: SCOPE, createdBy: 'user_v' });
    await appendMessage({ orgId: ORG, conversationId: newer.id, role: 'user', content: 'newest thread' });

    const found = await latestConversationForScope({ orgId: ORG, scopeRef: SCOPE, createdBy: 'user_v' });

    expect(found?.id).toBe(newer.id);
    expect(found?.id).not.toBe(older.id);
  });

  it('scoped conversations are per user — another user never sees them', async () => {
    await createConversation({ orgId: ORG, agentSlug: 'revops-lead', scopeRef: SCOPE, createdBy: 'user_v' });

    const other = await latestConversationForScope({ orgId: ORG, scopeRef: SCOPE, createdBy: 'user_a' });

    expect(other).toBeNull();
  });

  it('a different scope resolves independently', async () => {
    await createConversation({ orgId: ORG, agentSlug: 'revops-lead', scopeRef: SCOPE, createdBy: 'user_v' });

    const elsewhere = await latestConversationForScope({ orgId: ORG, scopeRef: 'contacts:777', createdBy: 'user_v' });

    expect(elsewhere).toBeNull();
  });
});

describe('trace persistence', () => {
  it('appendMessage stores the turn trace and listMessages returns it', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', scopeRef: SCOPE, createdBy: 'user_v' });
    const trace = [
      {
        id: 't1',
        actor: { id: 'revops-lead', kind: 'lead', name: 'RevOps Lead' },
        kind: 'search',
        status: 'done',
        label: 'Searched the data room',
        detail: 'hosting, monthly',
      },
    ];

    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'assistant', content: 'Found it.', trace });
    const [row] = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(row?.traceJson).toEqual(trace);
  });

  it('an empty trace persists as null, matching runsJson semantics', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: 'user_v' });

    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'assistant', content: 'Plain answer.', trace: [] });
    const [row] = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(row?.traceJson).toBeNull();
  });
});

/**
 * `conversation_org_agent_updated_idx` used to be unique over
 * (org_id, agent_slug, updated_at), so two conversations with one agent could
 * not share a millisecond. Two people opening a chat at the same moment hit
 * that, and so did this file's own tests about one run in three.
 */
describe('two conversations landing in the same millisecond', () => {
  it('both save, for one agent in one workspace', async () => {
    const together = await Promise.all([
      createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: 'user_v' }),
      createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: 'user_v' }),
    ]);

    expect(new Set(together.map(conversation => conversation.id)).size).toBe(2);
  });

  it('both save when a burst of them arrives at once', async () => {
    const burst = await Promise.all(
      Array.from({ length: 8 }, () => createConversation({ orgId: ORG, agentSlug: 'revops-lead', createdBy: 'user_v' })),
    );

    expect(new Set(burst.map(conversation => conversation.id)).size).toBe(8);
  });
});
