import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

/**
 * AN UPLOAD NEVER OPENS A PREVIEW BY ITSELF (a phone walk, 2026-10-10: a
 * leads .xlsx opened on its own and took the screen). What a turn that
 * carried files makes shows as a chip in the chat; a turn without files still
 * opens what it made beside the conversation, as before. Fixtures are
 * fictional (Northwind Expo).
 */

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(async () => null), setState: vi.fn(async () => ({ agentSlug: 'lead', conversationId: null })), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn(async () => []) },
    artifacts: { get: vi.fn() },
    conversations: { intake: vi.fn(), get: vi.fn(), create: vi.fn(async () => ({ id: 31 })), list: vi.fn(async () => []), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(async () => ({})), feedback: vi.fn(async () => ({})) },
    decisions: { open: vi.fn(async () => []), waiting: vi.fn(async () => []), answer: vi.fn(), build: vi.fn() },
  },
}));
const openPreview = vi.fn();
vi.mock('@/features/preview/previewState', () => ({ openPreview: (...a: unknown[]) => openPreview(...a) }));

const { useChatSession } = await import('./useChatSession');
const { opensPreviewOnItsOwn } = await import('./autoOpen');

const AGENTS = [{ slug: 'lead', name: 'Workspace lead', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const }];
const LEADS = { id: 77, title: 'northwind-expo-leads.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 20_480, url: '/api/artifacts/77', kind: 'document' as const };

function stream() {
  const encoder = new TextEncoder();
  const events = [
    { type: 'artifact', artifact: { id: 77, title: 'northwind-expo-leads.xlsx', kind: 'table', version: 1 } },
    { type: 'record_created', record: { type: 'object', id: '12' } },
    { type: 'done', response: 'Imported 40 leads.' },
  ];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  openPreview.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({ ok: true, body: stream() })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a turn that carried an upload', () => {
  it('opens no preview by itself — the artifact is a chip in the chat', async () => {
    const { result } = await renderHook(() => useChatSession({ agents: AGENTS, initialAttachments: [LEADS] }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    await result.current.sendMessage('Import these leads');

    await vi.waitFor(() => expect(result.current.messages.at(-1)?.artifacts?.map(a => a.id)).toEqual([77]));

    expect(openPreview).not.toHaveBeenCalled();
  });

  it('a turn with no upload still opens what it made beside the conversation', async () => {
    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    await result.current.sendMessage('Make me a table of the Northwind Expo leads');

    await vi.waitFor(() => expect(openPreview).toHaveBeenCalledWith({ type: 'artifact', id: '77' }, null));
  });

  it('is the rule, pure', () => {
    expect(opensPreviewOnItsOwn({ fromUpload: true })).toBe(false);
    expect(opensPreviewOnItsOwn({ fromUpload: false })).toBe(true);
  });
});
