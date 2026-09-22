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

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/AgentService', () => ({ listAgents: vi.fn(async () => []), runAgentDeep: vi.fn() }));
vi.mock('@/services/SourceAccessService', () => ({ allowedSourceSlugsForUser: vi.fn(async () => []) }));

const { markStopped } = await import('@/libs/streams/buffer');
const { TurnRefusedError } = await import('@/services/agents/turnRefusal');

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
 * Drain the SSE body so the route's finally block — where the row is written — has run.
 * @param res - The streaming response the route returned.
 */
async function drain(res: Response) {
  const reader = res.body!.getReader();
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
  }
}

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

async function postTurn(conversationId: number, message: string) {
  const res = await POST(new Request('http://localhost/rpc/agent/stream', {
    method: 'POST',
    body: JSON.stringify({ message, agent_slug: 'revenue-lead', conversation_id: conversationId }),
  }));
  await drain(res);
  return res;
}

/**
 * Send a turn and hand back the events the client would have seen, in order.
 * @param conversationId - The thread this turn belongs to.
 * @param message - What the person typed.
 */
async function eventsFromTurn(conversationId: number, message: string): Promise<Array<Record<string, unknown>>> {
  const res = await POST(new Request('http://localhost/rpc/agent/stream', {
    method: 'POST',
    body: JSON.stringify({ message, agent_slug: 'revenue-lead', conversation_id: conversationId }),
  }));
  const body = await new Response(res.body).text();
  return body
    .split('\n\n')
    .map(block => block.replace(/^data: /, '').trim())
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as Record<string, unknown>);
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

  it('marks a turn that finishes `complete`, so a healthy answer is not a row nobody can read', async () => {
    vi.mocked(runAgentDeep).mockImplementation(finishes);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await postTurn(conv.id, 'how many deals closed?');

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant?.content).toBe('Four deals closed last month.');
    expect(assistant?.status).toBe('complete');
    expect(assistant?.statusReason).toBeNull();
  });

  it('marks a turn that threw before speaking `failed`, and still writes the row so it does not vanish on reload', async () => {
    vi.mocked(runAgentDeep).mockImplementation(diesBeforeSpeaking);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await postTurn(conv.id, 'how many deals closed?');

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('');
    // `failed`, not `incomplete`: there is no half-answer above the notice, so
    // "this stopped partway through" would be describing nothing.
    expect(assistant?.status).toBe('failed');
    // The thrown message is a provider's, not ours: it can carry hostnames and
    // request ids, and the row outlives the moment. It goes to the log instead.
    expect(assistant?.statusReason).toBeNull();
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
 * Every other way a turn can end (#114).
 *
 * `incomplete` used to be the only thing the column ever said, with NULL for
 * all the rest — so a spent budget, a person pressing Stop and a healthy
 * answer were stored identically and replayed to the model identically. Each
 * test here pins one ending against the two things that read it: what the
 * person is told, and whether the text comes back as history.
 */
/**
 * The stream id the route will use for these turns.
 *
 * A real client learns it from the first `stream_meta` frame and sends it back
 * when the person hits Stop. A test cannot read that frame while the turn is
 * still running, so the id is pinned instead — the point under test is what
 * the route does with a stop, not how the id is generated.
 */
const STOPPED_STREAM_ID = '11111111-2222-4333-8444-555555555555';

describe('agent stream route — the ending it writes down', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(STOPPED_STREAM_ID);
  });

  it('marks a turn the workspace declined `refused`, not failed, because nothing broke', async () => {
    vi.mocked(runAgentDeep).mockImplementation(async () => {
      throw new TurnRefusedError('Budget exceeded for "revenue-lead" (monthly: 5100/5000). Raise the cap under Budgets or wait for the next period.');
    });
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    const events = await eventsFromTurn(conv.id, 'how many deals closed?');

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant?.status).toBe('refused');
    expect(assistant?.statusReason).toMatch(/Budget exceeded/);
    // The live surface is told the same word the row is stored with, so the
    // bubble does not change its story on reload.
    expect(events.find(e => e.type === 'error')?.ending).toBe('refused');
  });

  it('marks a turn the person stopped `stopped`, so a short answer reads as a choice', async () => {
    vi.mocked(runAgentDeep).mockImplementation(async (opts) => {
      opts.onEvent?.({ type: 'response_delta', delta: 'Four deals closed' });
      // The person hits Stop while the turn is still running: the browser
      // aborts its fetch AND says so, which is what this marks.
      markStopped(STOPPED_STREAM_ID, { orgId: ORG, userId: USER });
      return finishedRun;
    });
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await postTurn(conv.id, 'how many deals closed?');

    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant?.status).toBe('stopped');
    expect(assistant?.content).toBe('Four deals closed');
  });

  it('keeps a stopped turn in the history — the person read it and decided that was enough', async () => {
    vi.mocked(runAgentDeep).mockImplementation(async (opts) => {
      opts.onEvent?.({ type: 'response_delta', delta: 'Four deals closed' });
      markStopped(STOPPED_STREAM_ID, { orgId: ORG, userId: USER });
      return finishedRun;
    });
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
    await postTurn(conv.id, 'how many deals closed?');

    const replayed = toHistoryTurns(await listMessages({ orgId: ORG, conversationId: conv.id }));

    expect(replayed.map(t => t.content)).toEqual(['how many deals closed?', 'Four deals closed']);
  });

  it('keeps a refused turn out of the history, because there is no answer in it', async () => {
    vi.mocked(runAgentDeep).mockImplementation(async () => {
      throw new TurnRefusedError('Budget exceeded for "revenue-lead" (monthly: 5100/5000). Raise the cap under Budgets or wait for the next period.');
    });
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
    await postTurn(conv.id, 'how many deals closed?');

    const replayed = toHistoryTurns(await listMessages({ orgId: ORG, conversationId: conv.id }));

    expect(replayed.map(t => t.content)).toEqual(['how many deals closed?']);
  });
});
