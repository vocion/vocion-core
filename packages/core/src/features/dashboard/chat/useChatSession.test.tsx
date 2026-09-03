import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    chat: { suggestions: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn() },
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
  sessionStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset();
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null });
  vi.mocked(client.chat.suggestions).mockReset().mockResolvedValue([]);
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
  vi.mocked(client.conversations.list).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('useChatSession', () => {
  it('defaults to the first agent and an empty conversation when nothing was ever viewed', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();
  });

  it('adopts the server-side pointer on a browser that has no local one, and replays its messages', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'specialist', conversationId: 5, updatedAt: new Date() });
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

    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.conversationId).toBe(5);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('does not auto-resume a conversation last viewed on a previous day', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({
      agentSlug: 'specialist',
      conversationId: 5,
      updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(client.conversations.get).not.toHaveBeenCalled();
  });

  it('falls back to the first agent when the persisted agentSlug no longer exists', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'deleted-agent', conversationId: 99, updatedAt: new Date() });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(client.conversations.get).not.toHaveBeenCalled();
  });

  it('prefers this browser\'s own remembered agent over the server-side pointer', async () => {
    localStorage.setItem('vocion:chat:agent', 'specialist');
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null, updatedAt: new Date() });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('specialist');
  });

  it('handleSwitchAgent clears messages, resets the conversation, and persists the new pointer', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    act(() => {
      result.current.handleSwitchAgent('specialist');
    });

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'specialist', conversationId: null }));
  });

  it('handleNewChat clears the view and persists a null conversation pointer', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 5, updatedAt: new Date() });
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
      result.current.handleNewChat();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'orchestrator', conversationId: null }));
  });

  it('handlePickConversation switches agent + messages to the selected conversation and persists it', async () => {
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
    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    await act(async () => {
      await result.current.handlePickConversation(8);
    });

    expect(result.current.agent.slug).toBe('specialist');
    expect(result.current.conversationId).toBe(8);
    expect(result.current.messages[0]).toMatchObject({ role: 'assistant', content: 'from history' });

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'specialist', conversationId: 8 }));
  });

  it('starts a hand-off from another page in a FRESH transcript instead of resuming saved history', async () => {
    // A stash left by another page (e.g. Briefings) — the hand-off effect
    // fires this as soon as an agent slug is resolved. Seeded BEFORE
    // rendering so it's present the instant the hook mounts. A hand-off
    // carries its own context, so resuming an old thread underneath it would
    // answer the new question against unrelated history.
    sessionStorage.setItem('vocion_chat_handoff', JSON.stringify({
      question: 'What about Q3?',
      contextTitle: 'Q3 Plan',
      context: 'Some carried-over context.',
    }));

    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 5, updatedAt: new Date() });
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 9 } as never);

    // Minimal valid SSE response so the hand-off's sendMessage resolves
    // instead of throwing — a single `done` event is enough to close out
    // the stream.
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: sseStream }));

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));

    // The saved thread was never fetched — the hand-off turn is the whole
    // transcript, in order, with the carried-over question first.
    expect(client.conversations.get).not.toHaveBeenCalled();
    expect(result.current.messages[0]).toMatchObject({ role: 'user' });
    expect(result.current.messages[0]!.content).toContain('What about Q3?');
    expect(result.current.messages[0]!.content).toContain('Some carried-over context.');
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant' });
  });

  it('pasted material rides under the instruction, fenced, and the chip clears on send', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 12 } as never);
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: sseStream });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    const pasted = 'From: client@example.com\nSubject: hosting\n(the whole email)';
    result.current.setPastedText(pasted);
    await vi.waitFor(() => expect(result.current.pastedText).toBe(pasted));

    await result.current.sendMessage('summarize this');

    await vi.waitFor(() => expect(result.current.messages.length).toBeGreaterThanOrEqual(2));
    const sent = result.current.messages[0]!.content;

    expect(sent).toContain('summarize this');
    expect(sent).toContain('--- pasted ---');
    expect(sent).toContain('(the whole email)');
    expect(result.current.pastedText).toBeNull();

    // The wire got the composed text too, not just the UI.
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);

    expect(body.message).toContain('--- pasted ---');
  });
});
