import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: {
      getState: vi.fn(),
      setState: vi.fn(),
    },
  },
}));

const { client } = await import('@/libs/Orpc');
const { useLastViewedConversation } = await import('./useLastViewedConversation');

const STORAGE_KEY = 'vocion_chat_last_viewed';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset();
  vi.mocked(client.chatWidget.setState).mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('useLastViewedConversation', () => {
  it('resolves the server value and mirrors it into localStorage', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'gtm-orchestrator', conversationId: 42 });

    const { result } = await renderHook(() => useLastViewedConversation());

    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toEqual({ agentSlug: 'gtm-orchestrator', conversationId: 42 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ agentSlug: 'gtm-orchestrator', conversationId: 42 });
  });

  it('falls back to localStorage when the server has no pointer yet', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentSlug: 'from-local-storage', conversationId: 7 }));
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);

    const { result } = await renderHook(() => useLastViewedConversation());

    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toEqual({ agentSlug: 'from-local-storage', conversationId: 7 });
  });

  it('falls back to localStorage when the server call fails', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentSlug: 'offline-agent', conversationId: null }));
    vi.mocked(client.chatWidget.getState).mockRejectedValue(new Error('network error'));

    const { result } = await renderHook(() => useLastViewedConversation());

    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toEqual({ agentSlug: 'offline-agent', conversationId: null });
  });

  it('resolves to null when neither the server nor localStorage has anything', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);

    const { result } = await renderHook(() => useLastViewedConversation());

    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toBeNull();
  });

  it('persist writes localStorage synchronously and calls the server', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.chatWidget.setState).mockResolvedValue({ agentSlug: 'new-agent', conversationId: 9 });

    const { result, act } = await renderHook(() => useLastViewedConversation());
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => {
      result.current.persist({ agentSlug: 'new-agent', conversationId: 9 });

      // The localStorage write must already be visible here, synchronously,
      // inside the same act callback — not merely after the surrounding
      // `await act(...)` settles.
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ agentSlug: 'new-agent', conversationId: 9 });
    });

    expect(result.current.state).toEqual({ agentSlug: 'new-agent', conversationId: 9 });

    await vi.waitFor(() => expect(client.chatWidget.setState).toHaveBeenCalledWith({ agentSlug: 'new-agent', conversationId: 9 }));
  });

  it('persist does not throw when the server call rejects', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.chatWidget.setState).mockRejectedValue(new Error('offline'));

    const { result, act } = await renderHook(() => useLastViewedConversation());
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    await expect(act(() => {
      result.current.persist({ agentSlug: 'x', conversationId: null });
    })).resolves.not.toThrow();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ agentSlug: 'x', conversationId: null });
  });
});
