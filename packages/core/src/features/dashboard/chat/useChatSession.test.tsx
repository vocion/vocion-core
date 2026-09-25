import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn(), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(async () => ({})), feedback: vi.fn(async () => ({})) },
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

  it('opens a NEW conversation with the lead — the server pointer chooses neither the thread nor the agent (§9)', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'specialist', conversationId: 5, updatedAt: new Date(), railWidth: null, railOpen: null });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(client.conversations.get).not.toHaveBeenCalled();
  });

  it('resumes the thread this browser session was already in (keyed on the workspace agent), and replays its messages', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 5, updatedAt: new Date(), railWidth: null, railOpen: null });
    sessionStorage.setItem('vocion:chat:session:orchestrator', '5');
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 5,
      orgId: 'org_1',
      agentSlug: 'orchestrator',
      title: 'Prior thread',
      messageCount: 2,
      autonomy: 'act-within-bounds',
      messages: [
        { id: 1, conversationId: 5, role: 'user', content: 'hi', runsJson: null, createdAt: new Date() },
        { id: 2, conversationId: 5, role: 'assistant', content: 'hello', runsJson: null, createdAt: new Date(), feedbackRating: 'up', feedbackNote: null },
      ],
    } as never);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.conversationId).toBe(5);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    // Persisted ids and feedback ride along, and the thread's autonomy rung is adopted.
    expect(result.current.messages[1]).toMatchObject({ id: 2, feedback: { rating: 'up', note: null } });
    expect(result.current.autonomy).toBe('act-within-bounds');
  });

  it('carries the incomplete mark over on reload, so a turn that failed part-way still reads as failed (#114)', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 7, updatedAt: new Date(), railWidth: null, railOpen: null });
    sessionStorage.setItem('vocion:chat:session:orchestrator', '7');
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 7,
      orgId: 'org_1',
      agentSlug: 'orchestrator',
      title: 'Cut off',
      messageCount: 3,
      messages: [
        { id: 1, conversationId: 7, role: 'user', content: 'how many deals closed?', runsJson: null, createdAt: new Date() },
        { id: 2, conversationId: 7, role: 'assistant', content: 'Four closed last month, worth', runsJson: null, createdAt: new Date(), status: 'incomplete' },
        { id: 3, conversationId: 7, role: 'assistant', content: 'Four closed last month, worth $216K.', runsJson: null, createdAt: new Date(), status: null },
      ],
    } as never);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.messages).toHaveLength(3));

    expect(result.current.messages[1]).toMatchObject({ id: 2, status: 'incomplete' });
    expect(result.current.messages[2]!.status).toBeUndefined();
  });

  it('resumes the thread the URL names (`?conversation=<id>`) even on a fresh session', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 9,
      orgId: 'org_1',
      agentSlug: 'orchestrator',
      title: 'Shared link',
      messageCount: 1,
      messages: [{ id: 1, conversationId: 9, role: 'user', content: 'from a link', runsJson: null, createdAt: new Date() }],
    } as never);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS, resumeConversationId: 9 }));

    await vi.waitFor(() => expect(result.current.conversationId).toBe(9));

    expect(result.current.messages[0]).toMatchObject({ content: 'from a link' });
    expect(sessionStorage.getItem('vocion:chat:session:orchestrator')).toBe('9');
  });

  it('never resumes from the last-viewed pointer alone, however recent — and the pointer never picks the agent (§9.10)', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({
      agentSlug: 'specialist',
      conversationId: 5,
      updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      railWidth: null,
      railOpen: null,
    });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(client.conversations.get).not.toHaveBeenCalled();
  });

  it('falls back to the first agent when the persisted agentSlug no longer exists', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'deleted-agent', conversationId: 99, updatedAt: new Date(), railWidth: null, railOpen: null });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(client.conversations.get).not.toHaveBeenCalled();
  });

  it('opens with the workspace lead — never a remembered agent, whether from this browser or the server pointer (§9)', async () => {
    localStorage.setItem('vocion:chat:agent', 'specialist');
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'specialist', conversationId: null, updatedAt: new Date(), railWidth: null, railOpen: null });

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.leadSlug).toBe('orchestrator');
  });

  it('`/search <query>` routes one turn to the retrieval-only path and sends the bare query (§9.10)', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 3, agentSlug: 'orchestrator' } as never);
    // The runtime says who spoke (backlog 009): the virtual search entry is
    // on the client roster only, so the server sends the slug as its name and
    // the transcript names it from the roster.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('data: {"type":"turn_agent","agent":{"slug":"__search__","name":"__search__"}}\n\ndata: {"type":"done","response":"ok"}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const agents = [...AGENTS, { slug: '__search__', name: 'Search only', icon: 'search' as const, placeholder: 'Search…' }];

    const { result, act } = await renderHook(() => useChatSession({ agents }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));

    await act(async () => {
      await result.current.sendMessage('/search northwind governance');
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

    expect(body.agent_slug).toBe('__search__');
    expect(body.message).toBe('northwind governance');
    // The conversation stays with the workspace agent.
    expect(result.current.agent.slug).toBe('orchestrator');
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', agentSlug: '__search__', agentName: 'Search only' });
  });

  it('handleNewChat clears the view and persists a null conversation pointer', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 5, updatedAt: new Date(), railWidth: null, railOpen: null });
    sessionStorage.setItem('vocion:chat:session:orchestrator', '5');
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

    vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 5, updatedAt: new Date(), railWidth: null, railOpen: null });
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

  /**
   * "Does this turn produce an artifact" is a contract on the request, not a
   * judgement the model makes mid-turn — and it is armed by a tag the person
   * typed (`@artifact`), not by anything inferred from the draft. The tag
   * rides the composer's existing `@`-mention, so this is the same state the
   * `@team` tag uses; the only new behaviour is how it leaves.
   */
  describe('the deliverable contract (0102)', () => {
    const ARTIFACT_TAG_REF = { type: 'deliverable' as const, id: 'artifact', label: 'Artifact' };

    function sse() {
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"done","response":"ok"}\n\n'));
          controller.close();
        },
      });
    }

    async function booted() {
      vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
      vi.mocked(client.conversations.create).mockResolvedValue({ id: 21 } as never);
      const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, body: sse() }));
      vi.stubGlobal('fetch', fetchMock);
      const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
      await vi.waitFor(() => expect(result.current.booted).toBe(true));
      return { result, act, fetchMock };
    }

    function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
      return JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    }

    it('is `answer` until somebody tags `@artifact` — nothing is inferred from the draft', async () => {
      const { result, act, fetchMock } = await booted();

      await act(async () => {
        // The sentence the old classifier used to arm the chip on.
        await result.current.sendMessage('draft a pipeline report');
      });

      expect(sentBody(fetchMock).deliverable).toBe('answer');
    });

    it('sends `artifact` when the turn carries the `@artifact` tag', async () => {
      const { result, act, fetchMock } = await booted();

      await act(async () => {
        result.current.addContextRef(ARTIFACT_TAG_REF);
      });
      await vi.waitFor(() => expect(result.current.contextRefs).toHaveLength(1));
      await act(async () => {
        await result.current.sendMessage('put the risks somewhere I can keep them');
      });

      expect(sentBody(fetchMock).deliverable).toBe('artifact');
    });

    it('strips the tag out of `context_refs` — it points at no record', async () => {
      const { result, act, fetchMock } = await booted();

      await act(async () => {
        result.current.addContextRef(ARTIFACT_TAG_REF);
        result.current.addContextRef({ type: 'team', id: 'revops', label: 'RevOps' });
      });
      await vi.waitFor(() => expect(result.current.contextRefs).toHaveLength(2));
      await act(async () => {
        await result.current.sendMessage('the three risks, as a memo');
      });

      const body = sentBody(fetchMock);

      expect(body.deliverable).toBe('artifact');
      expect(body.context_refs).toEqual([{ type: 'team', id: 'revops', label: 'RevOps' }]);
    });

    it('is per message: the tag clears with the rest of them when the turn goes out', async () => {
      const { result, act } = await booted();

      await act(async () => {
        result.current.addContextRef(ARTIFACT_TAG_REF);
      });
      await vi.waitFor(() => expect(result.current.contextRefs).toHaveLength(1));
      await act(async () => {
        await result.current.sendMessage('one artifact, please');
      });

      expect(result.current.contextRefs).toEqual([]);
    });
  });

  /**
   * A recommendation with no `actionId` reached the card and fired
   * `review.propose` with `undefined`, which came back 400 twice on
   * 2026-09-15. The payload is checked where it arrives instead.
   */
  it('never turns a malformed recommended_action into a card', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 31 } as never);
    const encoder = new TextEncoder();
    const frames = [
      'data: {"type":"recommended_action","recommendation":{"input":{"to":"someone"},"label":"Send it"}}\n\n',
      'data: {"type":"recommended_action","recommendation":{"actionId":"gmail.send","label":"Send the follow-up","input":{}}}\n\n',
      'data: {"type":"done","response":"ok"}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of frames) {
            controller.enqueue(encoder.encode(f));
          }
          controller.close();
        },
      }),
    }));

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    await result.current.sendMessage('what is owed?');

    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));
    const assistant = result.current.messages[1]!;

    // Only the valid one became a card.
    expect(assistant.recommendations).toHaveLength(1);
    expect(assistant.recommendations![0]).toMatchObject({ actionId: 'gmail.send' });

    // The invalid one is visible as a failed step, with a reason.
    const failed = (assistant.runs ?? []).filter(r => r.type === 'tool' && r.state === 'error');

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: 'recommend_action' });
    expect((failed[0] as { output?: string }).output).toMatch(/named no action/);
  });

  /**
   * A run that dies mid-answer leaves text on screen (#114). The live
   * transcript has to say so there and then, or the same turn reads one way
   * now and another way after a reload, when the persisted row's `incomplete`
   * arrives.
   */
  it('marks the turn incomplete when the stream reports an error mid-answer', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 41 } as never);
    const encoder = new TextEncoder();
    const frames = [
      'data: {"type":"response_delta","delta":"Four deals closed last month, worth"}\n\n',
      'data: {"type":"error","message":"model connection reset"}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of frames) {
            controller.enqueue(encoder.encode(f));
          }
          controller.close();
        },
      }),
    }));

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    await result.current.sendMessage('how many deals closed?');

    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));
    const assistant = result.current.messages[1]!;

    expect(assistant.status).toBe('incomplete');
    expect(assistant.content).toContain('Four deals closed last month, worth');
    expect(assistant.statusReason).toBe('model connection reset');
    // A dropped stream is not a failed tool: no breadcrumb claiming one is,
    // which is what used to light the tool-error badge beside the notice.
    expect((assistant.runs ?? []).filter(r => r.type === 'tool' && r.state === 'error')).toHaveLength(0);
  });

  /**
   * Not every ending is a fault (#114). A turn the workspace declined needs
   * different words from one that broke, and the server says which is which on
   * the error event so the live bubble and the reloaded one agree.
   */
  it('marks a declined turn refused, taking the server at its word', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 43 } as never);
    const encoder = new TextEncoder();
    const frames = [
      'data: {"type":"error","message":"Budget exceeded for \\"revenue-lead\\" (monthly: 5100/5000).","ending":"refused"}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of frames) {
            controller.enqueue(encoder.encode(f));
          }
          controller.close();
        },
      }),
    }));

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    await result.current.sendMessage('how many deals closed?');

    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));

    expect(result.current.messages[1]!.status).toBe('refused');
  });

  /**
   * Stopping is a decision, and the server cannot see it: an aborted fetch is
   * what a locked phone looks like too, and that turn has to keep running. So
   * the client says so out loud, and marks the bubble the same way the stored
   * row will read (#114).
   */
  it('tells the server the turn was stopped, and marks the bubble as stopped', async () => {
    vi.mocked(client.chatWidget.getState).mockResolvedValue(null);
    vi.mocked(client.conversations.create).mockResolvedValue({ id: 44 } as never);
    const encoder = new TextEncoder();
    const held: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null };
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/stop')) {
        return { ok: true, json: async () => ({ marked: true }) };
      }
      return {
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            held.controller = controller;
            controller.enqueue(encoder.encode('data: {"type":"stream_meta","streamId":"stream-42"}\n\n'));
            controller.enqueue(encoder.encode('data: {"type":"response_delta","delta":"Northwind renews in March and"}\n\n'));
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.booted).toBe(true));
    void result.current.sendMessage('summarise the account');
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(2));
    // Wait for the first tokens: stopping before the turn has said anything
    // would be testing a different moment than the one that matters.
    await vi.waitFor(() => expect(result.current.messages[1]!.runs?.length ?? 0).toBeGreaterThan(0));

    result.current.handleStop();
    held.controller?.close();

    await vi.waitFor(() => {
      const stop = fetchMock.mock.calls.find(call => String(call[0]).includes('/rpc/agent/stream/stop'));

      expect(stop).toBeDefined();
      expect(JSON.parse((stop![1] as { body: string }).body)).toEqual({ stream_id: 'stream-42' });
    });
    await vi.waitFor(() => expect(result.current.messages[1]!.status).toBe('stopped'));
  });
});
