/**
 * The agent a thread is with — what the router reads to keep a follow-up
 * where it started (conversation 349, 2026-09-28).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { appendMessage, createConversation, threadAgentOf } = await import('./ConversationService');

const ORG = 'org_thread_agent';

describe('threadAgentOf', () => {
  it('is null before the thread has a reply, so the first turn is the router\'s', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'product-manager' });
    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'File a feature request.' });

    expect(await threadAgentOf({ orgId: ORG, id: conv.id })).toBeNull();
  });

  it('is the agent of the last reply — a hand-off that answered moves the thread', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'product-manager' });
    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'File a feature request.' });
    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'assistant', content: 'Filed.', agentSlug: 'product-manager' });

    expect(await threadAgentOf({ orgId: ORG, id: conv.id })).toBe('product-manager');

    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: '@change-reviewer take a look' });
    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'assistant', content: 'Looked.', agentSlug: 'change-reviewer' });

    expect(await threadAgentOf({ orgId: ORG, id: conv.id })).toBe('change-reviewer');
  });

  it('never reads another workspace\'s thread', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'product-manager' });
    await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'assistant', content: 'Hi.', agentSlug: 'product-manager' });

    expect(await threadAgentOf({ orgId: 'org_other', id: conv.id })).toBeNull();
  });
});
