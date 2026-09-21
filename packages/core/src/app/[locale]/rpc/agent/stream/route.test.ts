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

  it('keeps the fragment out of the history the next turn replays to the model', async () => {
    vi.mocked(runAgentDeep).mockImplementation(diesPartWay);
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
    await postTurn(conv.id, 'how many deals closed?');

    const replayed = toHistoryTurns(await listMessages({ orgId: ORG, conversationId: conv.id }));

    expect(replayed.map(t => t.content)).toEqual(['how many deals closed?']);
  });
});
