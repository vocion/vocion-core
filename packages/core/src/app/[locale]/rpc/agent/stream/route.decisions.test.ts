/**
 * ANSWERS FIRST, at the route: a turn in a conversation with an open Decision
 * is judged against it BEFORE it is routed or intent-read, and a card's
 * answer never becomes words the person did not type.
 *
 * The runtime is mocked (only what the route hands it matters here), and so
 * is the composer's model read — the route routes on its typed field.
 * Fixtures are fictional (Northwind).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/AgentService', () => ({
  listAgents: vi.fn(async () => [
    { slug: 'revenue-lead', name: 'Revenue lead' },
    { slug: 'product-manager', name: 'Product manager' },
  ]),
  runAgentDeep: vi.fn(),
}));
vi.mock('@/services/SourceAccessService', () => ({ allowedSourceSlugsForUser: vi.fn(async () => []) }));
vi.mock('@/services/chat/conversationTitle', () => ({ scheduleConversationTitle: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));
const routeRead = vi.fn(async () => {
  throw new Error('no model in this test');
});
vi.mock('@/services/agents/routeRead', () => ({ readRoute: (...a: unknown[]) => (routeRead as (...x: unknown[]) => unknown)(...a) }));
// The composer's read against the open Decision — what the model would say.
const decisionRead = vi.fn();
vi.mock('@/services/agents/turnJudge', async orig => ({ ...(await orig<object>()), readDecisionAnswer: (...a: unknown[]) => decisionRead(...a) }));

const { db } = await import('@/libs/DB');
const { askSchema, conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { runAgentDeep } = await import('@/services/AgentService');
const { createConversation, listMessages } = await import('@/services/ConversationService');
const { openDecisions, raiseDecision } = await import('@/services/decisions/DecisionService');
const { POST } = await import('./route');

const ORG = 'org_stream_decisions';
const USER = 'usr-dana';
const signedIn = { userId: USER, orgId: ORG, accountId: null, projectId: ORG, role: 'admin' as const, workspaceRole: 'admin' as const, has: () => true };

type RunOpts = Parameters<typeof runAgentDeep>[0];

async function turn(body: Record<string, unknown>): Promise<{ status: number; events: Array<Record<string, unknown>> }> {
  const res = await POST(new Request('http://localhost/rpc/agent/stream', { method: 'POST', body: JSON.stringify(body) }));
  const text = await new Response(res.body).text();
  const events = text.split('\n\n').map(b => b.replace(/^data: /, '').trim()).filter(l => l.startsWith('{')).map(l => JSON.parse(l) as Record<string, unknown>);
  return { status: res.status, events };
}

/** The thread with the revenue lead, and a question the product manager docked in it. */
async function threadWithAQuestion() {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
  const { view } = await raiseDecision({
    orgId: ORG,
    conversationId: conv.id,
    ownerUserId: USER,
    agentSlug: 'product-manager',
    kind: 'ruling',
    question: 'Which area should the factory start on?',
    options: [{ id: 'uploads', label: 'Uploads', recommended: true }, { id: 'exports', label: 'Exports' }, { id: 'billing', label: 'Billing' }],
  });
  return { conv, view };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(askSchema);
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
  vi.mocked(runAgentDeep).mockImplementation(async (opts: RunOpts) => {
    opts.onEvent?.({ type: 'response_delta', delta: 'Starting on it.' });
    return { response: 'Starting on it.', traceId: 't', toolCalls: [] };
  });
});

describe('a card\'s answer — typed, never words', () => {
  it('runs the agent that ASKED with the typed record, not the thread\'s agent, and is not read again', async () => {
    const { conv, view } = await threadWithAQuestion();
    const { status, events } = await turn({ conversation_id: conv.id, agent_slug: 'revenue-lead', decision_answer: { id: view.id, option_ids: ['exports'] } });

    expect(status).toBe(200);

    const opts = vi.mocked(runAgentDeep).mock.calls[0]![0];

    expect(opts.agentSlug).toBe('product-manager');
    expect(opts.intent).toMatchObject({ asks: 'decide' });
    // The decision already landed: no "you were asked to … do it now" pass.
    expect(opts.landedWrites).toBe(1);
    expect(opts.message).toContain(`[decision #${view.id} answered] Which area should the factory start on?`);
    expect(opts.message).toContain('Chosen: Exports (option exports)');
    expect(decisionRead).not.toHaveBeenCalled();
    expect(routeRead).not.toHaveBeenCalled();
    expect(events.find(e => e.type === 'decision')).toMatchObject({ decision: { id: view.id, state: 'answered', answer: { optionIds: ['exports'], via: 'card' } } });
  });

  it('a click never becomes user text: the row is a `decision` row carrying the typed answer', async () => {
    const { conv, view } = await threadWithAQuestion();
    await turn({ conversation_id: conv.id, agent_slug: 'revenue-lead', decision_answer: { id: view.id, skip: true } });
    const rows = await listMessages({ orgId: ORG, conversationId: conv.id });

    expect(rows.filter(r => r.role === 'user')).toHaveLength(0);

    const answer = rows.find(r => r.role === 'decision');

    expect(answer?.runsJson).toEqual([{ type: 'decision_answer', id: view.id, question: 'Which area should the factory start on?', answer: { kind: 'skip' }, line: 'Skipped', via: 'card' }]);
    expect(answer?.content).toContain('Skipped: the person chose not to answer');
    expect(await openDecisions(ORG, conv.id)).toHaveLength(0);
  });

  it('refuses an answer to a Decision already decided — 409, and nothing is written or run', async () => {
    const { conv, view } = await threadWithAQuestion();
    await turn({ conversation_id: conv.id, agent_slug: 'revenue-lead', decision_answer: { id: view.id, option_ids: ['uploads'] } });
    vi.mocked(runAgentDeep).mockClear();
    const before = (await listMessages({ orgId: ORG, conversationId: conv.id })).length;
    const { status } = await turn({ conversation_id: conv.id, agent_slug: 'revenue-lead', decision_answer: { id: view.id, option_ids: ['exports'] } });

    expect(status).toBe(409);
    expect(runAgentDeep).not.toHaveBeenCalled();
    expect(await listMessages({ orgId: ORG, conversationId: conv.id })).toHaveLength(before);
  });

  it('refuses an answer to a Decision in another workspace\'s conversation', async () => {
    const { conv, view } = await threadWithAQuestion();
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: 'org_someone_else', projectId: 'org_someone_else' });
    const { status } = await turn({ conversation_id: conv.id, agent_slug: 'revenue-lead', decision_answer: { id: view.id, skip: true } });

    expect(status).toBe(404);
    expect(runAgentDeep).not.toHaveBeenCalled();
  });
});

describe('typed words are judged against the open Decision before routing', () => {
  it('"the second one" answers it: the asker runs, the router never reads it, their words keep their row', async () => {
    const { conv, view } = await threadWithAQuestion();
    decisionRead.mockResolvedValueOnce({ kind: 'option', option_ids: ['exports'], free_text: null });
    const { events } = await turn({ conversation_id: conv.id, message: 'the second one', agent_slug: 'revenue-lead', route: true });
    const opts = vi.mocked(runAgentDeep).mock.calls[0]![0];

    expect(opts.agentSlug).toBe('product-manager');
    expect(opts.intent).toMatchObject({ asks: 'decide' });
    expect(opts.message).toContain('the second one');
    expect(opts.message).toContain(`[decision #${view.id} answered]`);
    expect(routeRead).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'routed')).toBe(false);

    const user = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'user');

    expect(user?.content).toBe('the second one');
    expect(user?.runsJson).toEqual([expect.objectContaining({ type: 'decision_answer', id: view.id, answer: { kind: 'option', optionIds: ['exports'] }, via: 'composer' })]);
  });

  it('"1 and 3" on a Decision that takes one goes to the asker as their words', async () => {
    const { conv } = await threadWithAQuestion();
    decisionRead.mockResolvedValueOnce({ kind: 'option', option_ids: ['uploads', 'billing'], free_text: null });
    await turn({ conversation_id: conv.id, message: '1 and 3', agent_slug: 'revenue-lead' });
    const opts = vi.mocked(runAgentDeep).mock.calls[0]![0];

    expect(opts.agentSlug).toBe('product-manager');
    expect(opts.message).toContain('Answered in their own words: 1 and 3');
  });

  it('a genuinely new topic routes as usual, is read for intent as usual, and is told the Decision still waits', async () => {
    const { conv, view } = await threadWithAQuestion();
    decisionRead.mockResolvedValueOnce({ kind: 'none', option_ids: [], free_text: null });
    await turn({ conversation_id: conv.id, message: 'what did Northwind say yesterday?', agent_slug: 'revenue-lead' });
    const opts = vi.mocked(runAgentDeep).mock.calls[0]![0];

    expect(opts.agentSlug).toBe('revenue-lead');
    expect(opts.intent).toBeUndefined();
    expect(opts.message).toContain('what did Northwind say yesterday?');
    expect(opts.message).toContain(`Decision #${view.id} ("Which area should the factory start on?") is still docked`);
    expect((await openDecisions(ORG, conv.id)).map(d => d.id)).toEqual([view.id]);
  });

  it('a conversation with nothing open is never read against anything', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
    await turn({ conversation_id: conv.id, message: 'hello', agent_slug: 'revenue-lead' });

    expect(decisionRead).not.toHaveBeenCalled();
    expect(vi.mocked(runAgentDeep).mock.calls[0]![0].message).not.toContain('waiting on them');
  });
});

describe('a turn that ends at a Decision', () => {
  it('is complete — the docked question is its answer — and keeps the Decision on the turn that raised it', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'product-manager', createdBy: USER });
    vi.mocked(runAgentDeep).mockImplementation(async (opts: RunOpts) => {
      opts.onEvent?.({ type: 'tool_start', tool: 'file_ask', input: { title: 'Which repo?' } });
      opts.onEvent?.({ type: 'decision', decision: { id: 77, kind: 'choice', question: 'Which repo?', options: [], allowOther: true, multiple: false, state: 'open', agentSlug: 'product-manager', ownerUserId: USER, conversationId: conv.id } });
      opts.onEvent?.({ type: 'tool_end', tool: 'file_ask', input: { title: 'Which repo?' }, output: 'Asked Dana here: decision #77 is docked above their composer.' });
      return { response: '', traceId: 't', toolCalls: [], handedOff: true } as never;
    });
    await turn({ conversation_id: conv.id, message: 'build the export', agent_slug: 'product-manager' });
    const assistant = (await listMessages({ orgId: ORG, conversationId: conv.id })).find(r => r.role === 'assistant');

    expect(assistant?.status).toBe('complete');
    expect(assistant?.runsJson).toContainEqual({ type: 'decision', id: 77, question: 'Which repo?', state: 'open' });
  });
});
