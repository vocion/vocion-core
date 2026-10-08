import type { DecisionView } from '@/libs/decisions/decision';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

/**
 * A DECISION IN THE CHAT SESSION: what the thread waits on is read with it,
 * docks above the composer ("Or reply directly…"), and an answer from the
 * card travels TYPED to the agent that asked — a click never becomes words in
 * the person's mouth, and the composer keeps what they were typing.
 * Fixtures are fictional (Northwind).
 */

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn(), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn(async () => []) },
    artifacts: { get: vi.fn() },
    decisions: { open: vi.fn(async () => []) },
    conversations: { intake: vi.fn(), get: vi.fn(), create: vi.fn(), list: vi.fn(async () => []), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(async () => ({})), feedback: vi.fn(async () => ({})) },
  },
}));

const { client } = await import('@/libs/Orpc');
const { useChatSession } = await import('./useChatSession');

const AGENTS = [
  { slug: 'orchestrator', name: 'Workspace', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'product-manager', name: 'Product manager', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

const repo: DecisionView = {
  id: 41,
  kind: 'choice',
  question: 'Which repo should the factory build in?',
  options: [{ id: 'api', label: 'Northwind API', recommended: true }, { id: 'portal', label: 'Northwind Portal' }],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: 'product-manager',
  ownerUserId: 'usr-dana',
  conversationId: 9,
};

/** Resume thread 9: one question asked, an earlier one answered on its card. */
function resumeThread() {
  vi.mocked(client.chatWidget.getState).mockResolvedValue({ agentSlug: 'orchestrator', conversationId: 9, updatedAt: new Date(), railWidth: null, railOpen: null });
  sessionStorage.setItem('vocion:chat:session:orchestrator', '9');
  vi.mocked(client.conversations.get).mockResolvedValue({
    id: 9,
    orgId: 'org_1',
    agentSlug: 'orchestrator',
    title: 'Northwind uploads',
    messageCount: 3,
    messages: [
      { id: 1, conversationId: 9, role: 'assistant', content: 'Should it run behind a flag?', runsJson: [{ type: 'text', text: 'Should it run behind a flag?' }, { type: 'decision', id: 40, question: 'Ship it behind a flag?', state: 'open' }], createdAt: new Date() },
      { id: 2, conversationId: 9, role: 'decision', content: '[decision #40 answered] Ship it behind a flag?\nChosen: Yes (option yes)', runsJson: [{ type: 'decision_answer', id: 40, question: 'Ship it behind a flag?', answer: { kind: 'option', optionIds: ['yes'] }, line: 'Yes', via: 'card' }], createdAt: new Date() },
      { id: 3, conversationId: 9, role: 'assistant', content: 'Flag added.', runsJson: [{ type: 'text', text: 'Flag added.' }, { type: 'receipt', receipt: { runId: 77, actionId: 'objects.update_meta', label: 'Set the flag on Northwind uploads', undoable: true } }], createdAt: new Date() },
    ],
  } as never);
}

/** An SSE body that says the Decision was answered on its card, then ends. */
function answeredStream(): Response {
  const events = [
    { type: 'turn_agent', agent: { slug: 'product-manager', name: 'Product manager' } },
    { type: 'decision', decision: { ...repo, state: 'answered', answer: { kind: 'option', optionIds: ['portal'], labels: ['Northwind Portal'], freeText: null, by: 'usr-dana', at: null, via: 'card' } } },
    { type: 'response_delta', delta: 'Building in the portal.' },
    { type: 'done', response: 'Building in the portal.' },
  ];
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(client.decisions.open).mockReset().mockResolvedValue([repo] as never);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('a Decision in the chat session', () => {
  it('docks what the thread waits on when it opens, and the composer offers the other way to answer', async () => {
    resumeThread();
    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));

    await vi.waitFor(() => expect(result.current.openDecisions.map(d => d.id)).toEqual([41]));

    expect(client.decisions.open).toHaveBeenCalledWith({ conversationId: 9 });
    expect(result.current.composerPlaceholder).toBe('Or reply directly…');
  });

  it('replays a card\'s answer as a receipt with no words, and the Done line with its Undo', async () => {
    resumeThread();
    const { result } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(3));

    expect(result.current.messages[1]).toMatchObject({ role: 'user', content: '', decisionAnswer: { id: 40, line: 'Yes', kind: 'option', via: 'card' } });
    expect(result.current.messages[2]!.receipts).toEqual([{ runId: 77, actionId: 'objects.update_meta', label: 'Set the flag on Northwind uploads', undoable: true }]);
  });

  it('a click never becomes user text: the answer goes typed to the agent that asked, and the composer keeps its words', async () => {
    resumeThread();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answeredStream());
    vi.stubGlobal('fetch', fetchMock);
    const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.openDecisions).toHaveLength(1));
    await act(() => result.current.setComposerValue('half a thought about billing'));

    vi.mocked(client.decisions.open).mockResolvedValue([] as never);
    await act(async () => {
      result.current.answerDecision(repo, { kind: 'option', optionIds: ['portal'] });
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

    expect(body.message).toBe('');
    expect(body.decision_answer).toEqual({ id: 41, option_ids: ['portal'] });
    expect(body.agent_slug).toBe('product-manager');
    expect(body.route).toBeUndefined();

    await vi.waitFor(() => expect(result.current.openDecisions).toEqual([]));
    const said = result.current.messages.at(-2)!;

    expect(said).toMatchObject({ role: 'user', content: '', decisionAnswer: { id: 41, line: 'Northwind Portal', via: 'card' } });
    expect(result.current.messages.some(m => m.role === 'user' && m.content.includes('Northwind Portal'))).toBe(false);
    expect(result.current.composerValue).toBe('half a thought about billing');
  });

  it('an answer that did not land takes its receipt back and says why on the card', async () => {
    resumeThread();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Decision 41 was already answered' }), { status: 409 })));
    const { result, act } = await renderHook(() => useChatSession({ agents: AGENTS }));
    await vi.waitFor(() => expect(result.current.messages).toHaveLength(3));

    await act(async () => {
      result.current.answerDecision(repo, { kind: 'skip' });
    });
    await vi.waitFor(() => expect(result.current.decisionError).toBe('Decision 41 was already answered'));

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.answeringDecisionId).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });
});
