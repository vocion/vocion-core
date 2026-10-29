/**
 * A LONG TURN SAYS WHERE IT HAS GOT TO (2026-10-29).
 *
 * An SEO turn showed "Checked what Ahrefs can do · 11 steps · 1m 2s" for
 * ninety seconds — a finished step's label, held while the turn went on — and
 * the person switched tabs. Driven here through the real session hook with a
 * fake turn that streams slowly: the line names the step that is running,
 * with the count its tool reports, moves on when a step lands, says what the
 * model is writing before its call arrives, and folds to the step summary
 * when the turn is done.
 */
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(async () => null), setState: vi.fn(async () => ({ agentSlug: 'seo-lead', conversationId: null })), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn(async () => []) },
    artifacts: { get: vi.fn() },
    conversations: { intake: vi.fn(), get: vi.fn(), create: vi.fn(async () => ({ id: 81 })), list: vi.fn(async () => []), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(async () => ({})), feedback: vi.fn(async () => ({})) },
    decisions: { open: vi.fn(async () => []), waiting: vi.fn(async () => []), answer: vi.fn(), build: vi.fn() },
  },
}));

const { useChatSession } = await import('./useChatSession');
const { WorkTimeline } = await import('./WorkTimeline');

const AGENTS = [{ slug: 'seo-lead', name: 'SEO Lead', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const }];
const actor = { id: 'seo-lead', kind: 'lead', name: 'SEO Lead' };

type Session = ReturnType<typeof useChatSession>;
let session: Session | null = null;
const hold = (s: Session) => {
  session = s;
};

/**
 * The turn as the transcript draws it: its group of steps, live while it streams.
 * @param root0 - Props.
 * @param root0.onSession - Hands the session to the test.
 */
function Turn({ onSession }: { onSession: (s: Session) => void }) {
  const s = useChatSession({ agents: AGENTS });
  useEffect(() => onSession(s));
  const turn = s.messages[s.messages.length - 1];
  if (!turn || turn.role !== 'assistant') {
    return null;
  }
  return <WorkTimeline runs={[]} streaming={s.isStreaming} trace={turn.trace ?? []} activity={s.activity} elapsed={25} />;
}

const line = () => page.getByTestId('streaming-indicator');

beforeEach(() => {
  session = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the live line on a long turn', () => {
  it('names the running step with its count, moves on when it lands, and folds when the turn is done', async () => {
    const encoder = new TextEncoder();
    const held: { c: ReadableStreamDefaultController<Uint8Array> | null } = { c: null };
    const send = (event: Record<string, unknown>) => held.c?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          held.c = controller;
        },
      }),
    })));

    await render(<Turn onSession={hold} />);
    await vi.waitFor(() => expect(session?.booted).toBe(true));
    void session!.sendMessage('cluster these 12 keywords');
    await vi.waitFor(() => expect(session!.messages).toHaveLength(2));

    // A step that already landed: its words never hold the line.
    send({ type: 'trace_node', id: 'a', actor, kind: 'tool', tool: 'mcp_list_tools', status: 'start', label: 'Checking what Ahrefs can do…' });
    send({ type: 'trace_node', id: 'a', actor, kind: 'tool', tool: 'mcp_list_tools', status: 'done', label: 'Checked what Ahrefs can do' });
    // The long one: one results page per keyword, the count from the tool.
    send({ type: 'trace_node', id: 'k', actor, kind: 'tool', tool: 'keyword_cluster', status: 'start', label: 'Reading Google\'s results for 12 keywords…' });
    send({ type: 'step_progress', tool: 'keyword_cluster', note: '4 of 12' });

    await expect.element(line()).toHaveTextContent('Reading Google\'s results for 12 keywords (4 of 12)');

    send({ type: 'step_progress', tool: 'keyword_cluster', note: '9 of 12' });

    await expect.element(line()).toHaveTextContent('Reading Google\'s results for 12 keywords (9 of 12)');
    await expect.element(line()).toHaveTextContent('2 steps');

    // It lands: the line does not keep its finished label while the model works on.
    send({ type: 'trace_node', id: 'k', actor, kind: 'tool', tool: 'keyword_cluster', status: 'done', label: 'Read Google\'s results for 12 keywords' });

    await expect.element(line()).not.toHaveTextContent('Read Google\'s results for 12 keywords');
    await expect.element(line()).not.toHaveTextContent('Checked what Ahrefs can do');

    // The model is writing its next call: the line says what that call does.
    send({ type: 'composing', tool: 'keyword_metrics' });

    await expect.element(line()).toHaveTextContent('Looking up search volume for the keywords…');

    send({ type: 'response_delta', delta: 'Three clusters.' });
    send({ type: 'done', response: 'Three clusters.' });
    held.c?.close();

    // Done: the live line is gone and the group is the step summary.
    await vi.waitFor(() => expect(session!.isStreaming).toBe(false));

    await expect.element(line()).not.toBeInTheDocument();
    await expect.element(page.getByTestId('work-group')).toHaveTextContent('2 steps');
  });
});
