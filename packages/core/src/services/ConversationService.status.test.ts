/**
 * What lands in `conversation_message.status` when a caller says nothing, says
 * something wrong, or is a person rather than an agent.
 *
 * The invariant worth protecting: every agent turn written from here on has a
 * status, so reading one never means guessing whether NULL was "it finished"
 * or "somebody forgot". Rows written before the vocabulary existed are the
 * only NULL assistant rows, and a person's message is NULL by design.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { appendMessage, createConversation, listMessages } = await import('./ConversationService');

const ORG = 'org_turn_status';

async function freshConversation(): Promise<number> {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'sales-assistant' });
  return conv.id;
}

describe('appendMessage turn status', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores an agent turn as complete when the caller names no status', async () => {
    const conversationId = await freshConversation();

    await appendMessage({ orgId: ORG, conversationId, role: 'assistant', content: 'Four closed last month.' });

    const [msg] = await listMessages({ orgId: ORG, conversationId });

    expect(msg?.status).toBe('complete');
  });

  it('keeps the status the caller chose', async () => {
    const conversationId = await freshConversation();

    await appendMessage({ orgId: ORG, conversationId, role: 'assistant', content: 'Four closed last', status: 'incomplete' });

    const [msg] = await listMessages({ orgId: ORG, conversationId });

    expect(msg?.status).toBe('incomplete');
  });

  it('leaves a person\'s message without a status, because a person\'s message does not end badly', async () => {
    const conversationId = await freshConversation();

    await appendMessage({ orgId: ORG, conversationId, role: 'user', content: 'how many deals closed?' });

    const [msg] = await listMessages({ orgId: ORG, conversationId });

    expect(msg?.status).toBeNull();
  });

  it('stores a word outside the vocabulary as complete and warns with the word, so a typo is loud rather than silently healthy', async () => {
    const conversationId = await freshConversation();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await appendMessage({ orgId: ORG, conversationId, role: 'assistant', content: 'done', status: 'finished' as never });

    const [msg] = await listMessages({ orgId: ORG, conversationId });

    expect(msg?.status).toBe('complete');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown turn status'), { status: 'finished' });
  });
});
