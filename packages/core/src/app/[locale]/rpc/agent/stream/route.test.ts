/**
 * What the SSE route writes down when a turn does not finish (#114).
 *
 * The route persists the assistant turn from a `finally` block, so a run that
 * threw half way through still leaves a row behind — by design, because the
 * person watched that text arrive and should not lose it. What went wrong was
 * that the row looked exactly like a completed answer: the transcript replayed
 * a fragment as the whole reply, and the next turn handed that cut-off
 * sentence back to the model as established context.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The retry waits before its second attempt; nothing here is timing-sensitive
// and a real 750ms per failing turn would be paid on every run of this file.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/AgentService', () => ({ listAgents: vi.fn(async () => []), runAgentDeep: vi.fn() }));
vi.mock('@/services/SourceAccessService', () => ({ allowedSourceSlugsForUser: vi.fn(async () => []) }));

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { runAgentDeep } = await import('@/services/AgentService');
const { createConversation, listMessages, toHistoryTurns } = await import('@/services/ConversationService');
const { POST } = await import('./route');

type RunOpts = Parameters<typeof runAgentDeep>[0];
type RunResult = Awaited<ReturnType<typeof runAgentDeep>>;

/** What a finished run hands back; only the events matter to this route. */
const finishedRun: RunResult = { response: '', traceId: 'trace-114', toolCalls: [] };

const ORG = 'org_stream_114';
const USER = 'usr-stream-114';

const signedIn = {
  userId: USER,
  orgId: ORG,
  accountId: null,
  projectId: ORG,
  role: 'admin' as const,
  has: () => true,
};

/**
 * A run that streams the start of an answer and then throws.
 * @param opts - What the route hands the runtime; only `onEvent` is used here.
 */
async function diesPartWay(opts: RunOpts): Promise<RunResult> {
  opts.onEvent?.({ type: 'response_delta', delta: 'Four deals closed last month, worth' });
  throw new Error('model connection reset');
}

/**
 * A run that throws before it says anything at all.
 * @param _opts - What the route hands the runtime; unused, nothing is spoken.
 */
async function diesBeforeSpeaking(_opts: RunOpts): Promise<RunResult> {
  throw new Error('the model refused the request');
}

/**
 * A run that streams a whole answer and returns.
 * @param opts - What the route hands the runtime; only `onEvent` is used here.
 */
async function finishes(opts: RunOpts): Promise<RunResult> {
  opts.onEvent?.({ type: 'response_delta', delta: 'Four deals closed last month.' });
  return finishedRun;
}

/**
 * Drain the SSE body — the route writes its row in the finally block, so the
 * read has to finish before anything is asserted — and hand back the parsed
 * events, in order.
 * @param res - The streaming response the route returned.
 */
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const body = await new Response(res.body).text();
  return body
    .split('\n\n')
    .map(block => block.replace(/^data: /, '').trim())
    .filter(line => line.length > 0 && line.startsWith('{'))
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

/**
 * A run that dies the same transient way every time it is called.
 * @param opts - What the route hands the runtime; only `onEvent` is used here.
 */
async function alwaysLosesTheConnection(opts: RunOpts): Promise<RunResult> {
  opts.onEvent?.({ type: 'response_delta', delta: 'Four deals closed' });
  throw new Error('socket hang up');
}

/**
 * A run that calls a tool and only then loses its connection.
 * @param opts - What the route hands the runtime; only `onEvent` is used here.
 */
async function losesTheConnectionAfterATool(opts: RunOpts): Promise<RunResult> {
  opts.onEvent?.({ type: 'tool_start', tool: 'send_email', input: { to: 'pat@northwind.test' } });
  opts.onEvent?.({ type: 'tool_end', tool: 'send_email', input: { to: 'pat@northwind.test' }, output: 'sent' });
  throw new Error('socket hang up');
}

async function postTurn(conversationId: number, message: string) {
  const res = await POST(new Request('http://localhost/rpc/agent/stream', {
    method: 'POST',
    body: JSON.stringify({ message, agent_slug: 'revenue-lead', conversation_id: conversationId }),
  }));
  return readEvents(res);
}

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
});

describe('agent stream route — a turn that dies part-way', () => {
  it('marks the persisted assistant row incomplete when the run throws mid-stream', async () => {
    vi.mocked(runAgentDeep).mockImplementation(diesPartWay);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await postTurn(conv.id, 'how many deals closed?');

    const rows = await listMessages({ orgId: ORG, conversationId: conv.id });
    const assistant = rows.find(r => r.role === 'assistant');

    expect(assistant?.content).toBe('Four deals closed last month, worth');
    expect(assistant?.status).toBe('incomplete');
  });

  it('leaves the status unset on a turn that finishes, so a healthy answer is still a plain row', async () => {
    vi.mocked(runAgentDeep).mockImplementation(finishes);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await postTurn(conv.id, 'how many deals closed?');

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant?.content).toBe('Four deals closed last month.');
    expect(assistant?.status).toBeNull();
  });

  it('still writes a row when the run throws before it speaks, so the turn does not vanish on reload', async () => {
    vi.mocked(runAgentDeep).mockImplementation(diesBeforeSpeaking);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await postTurn(conv.id, 'how many deals closed?');

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('');
    expect(assistant?.status).toBe('incomplete');
  });

  it('keeps the fragment out of the history the next turn replays to the model', async () => {
    vi.mocked(runAgentDeep).mockImplementation(diesPartWay);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
    await postTurn(conv.id, 'how many deals closed?');

    const replayed = toHistoryTurns(await listMessages({ orgId: ORG, conversationId: conv.id }));

    expect(replayed.map(t => t.content)).toEqual(['how many deals closed?']);
  });
});

/**
 * One retry, and only when a second attempt could work (#114).
 *
 * A dropped socket is the common way a chat turn dies, and the same request
 * sent a second later usually lands. What must never happen is the turn being
 * replayed after it has already done something — a sent email, a filed
 * recommendation — or a refused request being paid for twice.
 */
describe('agent stream route — one retry when the model drops', () => {
  it('runs the turn again when the connection drops, and saves only the attempt that finished', async () => {
    vi.mocked(runAgentDeep)
      .mockImplementationOnce(alwaysLosesTheConnection)
      .mockImplementationOnce(finishes);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    const events = await postTurn(conv.id, 'how many deals closed?');

    expect(vi.mocked(runAgentDeep)).toHaveBeenCalledTimes(2);
    expect(events.some(e => e.type === 'turn_retry')).toBe(true);
    expect(events.some(e => e.type === 'error')).toBe(false);

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    // The fragment from the abandoned attempt is gone — not spliced in front
    // of the real answer, which is what a shared collector would have done.
    expect(assistant?.content).toBe('Four deals closed last month.');
    expect(assistant?.status).toBeNull();
  });

  it('never runs the turn again once a tool has run, because nothing says whether that tool wrote anything', async () => {
    vi.mocked(runAgentDeep).mockImplementation(losesTheConnectionAfterATool);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    const events = await postTurn(conv.id, 'email pat the numbers');

    expect(vi.mocked(runAgentDeep)).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.type === 'turn_retry')).toBe(false);

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant?.status).toBe('incomplete');
  });

  it('does not retry a request the provider refused, which would fail the same way and bill twice', async () => {
    vi.mocked(runAgentDeep).mockImplementation(diesBeforeSpeaking);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    const events = await postTurn(conv.id, 'how many deals closed?');

    expect(vi.mocked(runAgentDeep)).toHaveBeenCalledTimes(1);
    expect(events.some(e => e.type === 'turn_retry')).toBe(false);
  });

  it('gives up after the second attempt and marks the turn incomplete once', async () => {
    vi.mocked(runAgentDeep).mockImplementation(alwaysLosesTheConnection);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    const events = await postTurn(conv.id, 'how many deals closed?');

    expect(vi.mocked(runAgentDeep)).toHaveBeenCalledTimes(2);
    expect(events.filter(e => e.type === 'error')).toHaveLength(1);

    const rows = (await listMessages({ orgId: ORG, conversationId: conv.id })).filter(r => r.role === 'assistant');

    // One row for one turn, whatever it took to get there.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('incomplete');
  });

  it('keeps a retried turn out of the next turn history when it never recovered', async () => {
    vi.mocked(runAgentDeep).mockImplementation(alwaysLosesTheConnection);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
    await postTurn(conv.id, 'how many deals closed?');

    const replayed = toHistoryTurns(await listMessages({ orgId: ORG, conversationId: conv.id }));

    expect(replayed.map(t => t.content)).toEqual(['how many deals closed?']);
  });
});
