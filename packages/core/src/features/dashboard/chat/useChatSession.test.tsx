import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { useChatSession } = await import('./useChatSession');

const AGENTS = [
  { slug: 'orchestrator', name: 'GTM Orchestrator', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'specialist', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

beforeEach(() => {
  localStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset();
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null });
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('useChatSession', () => {
  it('defaults to the first agent and an empty conversation when nothing was ever viewed', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();
  });

  it('hydrates the last-viewed agent and replays its persisted messages', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'specialist', conversationId: 5 });
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 5,
      orgId: 'org_1',
      agentSlug: 'specialist',
      title: 'Prior thread',
      messageCount: 2,
      messages: [
        { id: 1, conversationId: 5, role: 'user', content: 'hi', runsJson: null, createdAt: new Date() },
        { id: 2, conversationId: 5, role: 'assistant', content: 'hello', runsJson: null, createdAt: new Date() },
      ],
    } as never);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.hydrated).toBe(true));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.conversationId).toBe(5);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('falls back to the first agent when the persisted agentSlug no longer exists', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'deleted-agent', conversationId: 99 });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(client.conversations.get).not.toHaveBeenCalled();
  });

  it('handleSwitchAgent clears messages, resets the conversation, and persists the new pointer', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.handleSwitchAgent('specialist');
    });

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'specialist', conversationId: null }));
  });

  it('startNewConversation clears the view and persists a null conversation pointer', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 5 });
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 5,
      orgId: 'org_1',
      agentSlug: 'orchestrator',
      title: 'Prior thread',
      messageCount: 1,
      messages: [{ id: 1, conversationId: 5, role: 'user', content: 'hi', runsJson: null, createdAt: new Date() }],
    } as never);
    const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      result.current.startNewConversation();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'orchestrator', conversationId: null }));
  });

  it('loadConversation switches agent + messages to the selected conversation and persists it', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 8,
      orgId: 'org_1',
      agentSlug: 'specialist',
      title: 'Older thread',
      messageCount: 1,
      messages: [{ id: 3, conversationId: 8, role: 'assistant', content: 'from history', runsJson: null, createdAt: new Date() }],
    } as never);
    const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.loadConversation(8);
    });

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.conversationId).toBe(8);
    expect(result.current.messages[0]).toMatchObject({ role: 'assistant', content: 'from history' });

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'specialist', conversationId: 8 }));
  });
});
