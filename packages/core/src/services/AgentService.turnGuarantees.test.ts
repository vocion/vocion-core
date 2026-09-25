/**
 * What a finished turn OWES the person, proved against a mocked loop.
 *
 * Two guarantees, both structural rather than prompted (CLAUDE.md —
 * Structural over prompting*):
 *
 *   1. A delegation that failed reaches the answer and the persisted trace.
 *      The turn that prompted this work delegated, the hand-off blew up, and
 *      what the person got was a "Tool error" badge, one "Delegating to …"
 *      line, and a paragraph of narration. The stored trace held exactly one
 *      node: `{ kind: 'delegate', status: 'start' }`.
 *   2. A turn sent with `deliverable: 'artifact'` ends with an artifact —
 *      wrapped from a long-form answer, or an explicit stub when the work did
 *      not happen.
 *
 * The loop is mocked with a recorded `streamEvents(v2)` shape, so these assert
 * the harness's behaviour with no model and no network.
 */
import type { AgentEvent } from './agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const streamEvents = vi.fn();
const backstop = vi.hoisted(() => ({ on: false, calls: [] as Array<{ name: string; args: Record<string, unknown> }> }));

vi.mock('@/services/agents/harness', () => ({
  // The turn says which model answers it (`run_meta`); the mock keeps the agent's defaults.
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: (_h: unknown, o?: { model: string; provider?: string; thinking?: string }) => (o ? { ...o } : {}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async (_org: string, _slug: string, req: { emit: (e: unknown) => void }) => ({
    graph: { streamEvents },
    agentRow: { id: 1, slug: 'lead', name: 'Revenue Lead', systemPrompt: 'Be useful.', harnessConfig: backstop.on ? { recommendActionBackstop: true } : {} },
    ctx: { delegations: new Map(), emit: req.emit, agentSlug: 'lead' },
  })),
}));

vi.mock('@/libs/llm', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/llm')>()),
  buildChatModelForOrg: vi.fn(async () => ({ bindTools: () => ({ invoke: async () => ({ tool_calls: backstop.calls }) }) })),
}));
vi.mock('@/libs/Langfuse', () => ({
  createLangfuseCallback: vi.fn(() => ({ handler: {}, trace: { id: 'trace-1', update: vi.fn() } })),
  flushTraces: vi.fn(async () => {}),
}));

vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));

// The gated pass must never reach a model here. Returning null is the
// "the model could not produce a document" branch — the stub.
vi.mock('@/services/agents/deliverableBackstop', async importOriginal => ({
  ...(await importOriginal<typeof import('./agents/deliverableBackstop')>()),
  composeArtifactWithModel: vi.fn(async () => null),
}));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { createConversation } = await import('@/services/ConversationService');
const { listArtifactsForConversation } = await import('@/services/ArtifactService');
const { delegationFailureNotice, runAgentDeep } = await import('@/services/AgentService');

const ORG = 'org_turn_guarantees';
const TASK_ID = 'task-abc';

/**
 * `AIMessageChunk` content shape the answer streamer reads.
 * @param t
 */
function text(t: string): unknown {
  return { content: [{ type: 'text', text: t }] };
}

/**
 * A turn that narrates, delegates, and never hears back — the recorded shape
 * of the failure this work was opened for.
 * @param failure - How the hand-off ends.
 */
function failingDelegationStream(failure: 'uncaught' | 'caught'): AsyncIterable<unknown> {
  const events: unknown[] = [
    { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text('I will pull the picture first. Handing this to the analyst.') } },
    {
      event: 'on_tool_start',
      name: 'task',
      metadata: { checkpoint_ns: `tools:${TASK_ID}` },
      data: { input: { input: JSON.stringify({ subagent_type: 'pipeline-analyst', description: 'Full pipeline read for today' }) } },
    },
    failure === 'uncaught'
      ? { event: 'on_tool_error', name: 'task', metadata: { checkpoint_ns: `tools:${TASK_ID}` }, data: { error: new Error('the specialist could not be reached') } }
      : { event: 'on_tool_end', name: 'task', metadata: { checkpoint_ns: `tools:${TASK_ID}` }, data: { output: { status: 'error', content: 'Error: the specialist could not be reached\n Please fix your mistakes.' } } },
  ];
  return { async* [Symbol.asyncIterator]() {
    for (const e of events) {
      yield e;
    }
  } };
}

/** A turn whose whole answer is a document, and which renders nothing. */
function longFormStream(): AsyncIterable<unknown> {
  const body = `## Open pipeline\n\n${Array.from({ length: 130 }, (_, i) => `word${i}`).join(' ')}`;
  return { async* [Symbol.asyncIterator]() {
    yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(body) } };
  } };
}

/** A turn that produces nothing at all — the model thought and stopped. */
function emptyStream(): AsyncIterable<unknown> {
  return { async* [Symbol.asyncIterator]() { /* nothing */ } };
}

/** A long, card-worthy answer with no card in it — what the backstop exists for. */
function longAnswerStream(): AsyncIterable<unknown> {
  const body = `Seven customers lost uploads on cellular this week. ${'This is a data-loss bug on Send and it needs a fix now. '.repeat(8)}Filing the request now.`;
  return { async* [Symbol.asyncIterator]() {
    yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(body) } };
  } };
}

/** A turn that answers with one short sentence and renders nothing. */
function narrationStream(): AsyncIterable<unknown> {
  return { async* [Symbol.asyncIterator]() {
    yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text('Let me check the right structure first.') } };
  } };
}

async function run(opts: { message: string; deliverable?: 'artifact' | 'answer'; conversationId?: number }) {
  const events: AgentEvent[] = [];
  const result = await runAgentDeep({
    orgId: ORG,
    agentSlug: 'lead',
    message: opts.message,
    ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
    ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    onEvent: e => void events.push(e),
  });
  return { result, events };
}

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'lead', name: 'Revenue Lead', systemPrompt: 'Be useful.', harnessConfig: {} } as never);
  streamEvents.mockReset();
});

describe('a failed delegation reaches the person', () => {
  it.each(['uncaught', 'caught'] as const)('emits a terminal delegate node and a tool_error (%s)', async (mode) => {
    streamEvents.mockResolvedValue(failingDelegationStream(mode));
    const { events } = await run({ message: 'draft a pipeline report' });

    const delegateNodes = events.filter((e): e is Extract<AgentEvent, { type: 'trace_node' }> => e.type === 'trace_node' && e.kind === 'delegate');

    expect(delegateNodes.map(n => n.status)).toEqual(['start', 'error']);
    expect(delegateNodes[1]?.label).toBe('Pipeline Analyst could not finish');

    const toolErrors = events.filter(e => e.type === 'tool_error');

    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toMatchObject({ tool: 'task' });
  });

  it('says so in the answer even though the model did not', async () => {
    streamEvents.mockResolvedValue(failingDelegationStream('caught'));
    const { result, events } = await run({ message: 'draft a pipeline report' });

    expect(result.response).toContain('Pipeline Analyst');
    expect(result.response).toMatch(/did not complete/);

    // And the person sees it arrive, not just the persisted copy.
    const deltas = events.filter((e): e is Extract<AgentEvent, { type: 'response_delta' }> => e.type === 'response_delta');

    expect(deltas.some(d => d.delta.includes('did not complete'))).toBe(true);
  });

  it('says nothing extra when the answer already owned up to it', () => {
    const answer = 'I could not get a read from Pipeline Analyst, so this is partial.';

    expect(delegationFailureNotice([{ name: 'Pipeline Analyst', message: 'timeout' }], answer)).toBeNull();
    expect(delegationFailureNotice([], 'all good')).toBeNull();
  });

  it('names every specialist that failed, once', () => {
    const notice = delegationFailureNotice(
      [{ name: 'Pipeline Analyst', message: 'timed out' }, { name: 'Proposal Writer', message: 'timed out' }],
      'Here is what I have.',
    );

    expect(notice).toContain('Pipeline Analyst and Proposal Writer');
  });
});

describe('the deliverable contract', () => {
  it('wraps a long-form answer into an artifact when one was asked for', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockResolvedValue(longFormStream());
    const { result, events } = await run({ message: 'draft a pipeline report', deliverable: 'artifact', conversationId: conv.id });

    const artifacts = await listArtifactsForConversation({ orgId: ORG, conversationId: conv.id });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe('Open pipeline');
    expect(events.some(e => e.type === 'artifact')).toBe(true);
    expect(result.response).toContain('Open pipeline');
  });

  it('files an explicit stub when the turn produced only narration', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockResolvedValue(narrationStream());
    const { result } = await run({ message: 'draft a pipeline report', deliverable: 'artifact', conversationId: conv.id });

    const artifacts = await listArtifactsForConversation({ orgId: ORG, conversationId: conv.id });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe('Pipeline report — not completed');
    expect(result.response).toMatch(/could not produce one/);
  });

  it('a tool\'s name written as the last word is stripped, and the loop re-enters once to make the call', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narratedToolStream());
    const { result } = await run({ message: 'Approve filing it.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Call recommend_action now');
    expect(second.messages.at(-2)?.content).toBe('Filed. The build decision card is below.');
    expect(result.response).not.toMatch(/recommend_action\s*$/);
  });

  it('a whole call imitated as a fenced block at the end of the message is stripped and called too', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narratedToolStream('Should I reuse id 124?\n\nCARD\n```\nrecommend_action\nid: clarify-124\nquestion: which one?\n```'));
    const { result } = await run({ message: 'Approve filing it.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Call recommend_action now');
    expect(second.messages.at(-2)?.content).toBe('Should I reuse id 124?');
    expect(result.response).not.toContain('```');
  });

  it('a call written as a heading over a JSON block — three of them — is stripped and the loop re-enters to make it (finding 19)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narratedToolStream('Now writing each update:\n\n**update_object — request 30**\n\n```json\n{"object_type":"request","id":30,"fields":{"title":"add-send-admin-panel"}}\n```\n\n**update_object — request 38**\n\n```json\n{"object_type":"request","id":38}\n```'));
    const { result } = await run({ message: 'Backfill the three requests.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Call update_object now');
    expect(second.messages.at(-2)?.content).toBe('Now writing each update:');
    expect(result.response).not.toContain('```json');
  });

  it('a malformed tool call does not end the turn: the error goes back once and the answer still lands', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents
      .mockRejectedValueOnce(new Error('Error invoking tool \'read_file\' with kwargs {} with error: Error: Received tool input did not match expected schema'))
      .mockResolvedValueOnce(lookupStream('[{"id":41,"title":"Retry uploads"}]'));
    const { result } = await run({ message: 'Approve filing it.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Your last tool call was rejected');
    expect(result.response).toContain('Found the cards.');
  });

  it('an empty turn — no words, no tool call — continues once instead of being accepted', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents
      .mockResolvedValueOnce({ async* [Symbol.asyncIterator]() { /* nothing at all */ } })
      .mockResolvedValueOnce(lookupStream('[{"id":41}]'));
    const { result } = await run({ message: 'Is the credentials E2E flaky?', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('You returned nothing');
    expect(second.messages.at(-2)?.role).toBe('user');
    expect(result.response).toContain('Found the cards.');
  });

  it('makes no artifact when the turn owed an answer — and continues ONCE when the turn ended on a promise', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narrationStream());
    const { result } = await run({ message: 'what should I do right now?', deliverable: 'answer', conversationId: conv.id });

    expect(await listArtifactsForConversation({ orgId: ORG, conversationId: conv.id })).toHaveLength(0);
    // "Let me check…" with no tool call is a promise, not an answer (production
    // turn 577): the loop re-enters once with the promise as its own last words.
    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-2)).toEqual({ role: 'assistant', content: 'Let me check the right structure first.' });
    expect(second.messages.at(-1)?.content).toContain('That is a promise, not an answer');
    expect(result.response.startsWith('Let me check the right structure first.')).toBe(true);
  });
});

/**
 * A turn that makes one lookup_objects call returning this text.
 * @param output - What the tool returned.
 */
/**
 * A turn that answers in prose and ends with a tool's NAME as its last word.
 * @param body
 */
function narratedToolStream(body = 'Filed. The build decision card is below.\n\nrecommend_action'): AsyncIterable<unknown> {
  const events = [
    { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(body) } },
  ];
  return { async* [Symbol.asyncIterator]() {
    for (const e of events) {
      yield e;
    }
  } };
}

function lookupStream(output: string): AsyncIterable<unknown> {
  const events = [
    { event: 'on_tool_end', name: 'lookup_objects', metadata: { checkpoint_ns: 'tools:lookup-1' }, data: { input: { type_slug: 'event-candidate' }, output: { content: output } } },
    { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text('Found the cards.') } },
  ];
  return { async* [Symbol.asyncIterator]() {
    for (const e of events) {
      yield e;
    }
  } };
}

describe('the tool-call log an eval reads', () => {
  it('keeps a long return whole in the log while the live event stays short', async () => {
    // An eval check parses this JSON. Cut at 2,000 characters, as the live
    // event is, a lookup of a few dozen cards stopped parsing and every rule
    // about its records failed for the cut.
    const cards = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ id: index, title: `Card ${index}`, startDate: '2026-10-06' })));
    streamEvents.mockResolvedValue(lookupStream(cards));
    const { result, events } = await run({ message: 'look up the event cards' });

    const logged = result.toolCalls.find(call => call.tool === 'lookup_objects');
    const streamed = events.find((e): e is Extract<AgentEvent, { type: 'tool_end' }> => e.type === 'tool_end' && e.tool === 'lookup_objects');

    expect(cards.length).toBeGreaterThan(2000);
    expect(logged?.output).toBe(cards);
    expect(streamed?.output.length).toBe(2000);
  });

  it('keeps a page-sized return whole, with no cap of its own', async () => {
    // fetch_url hands back a page's full text, and a 75 KB listing is an
    // ordinary source. Any cap here would cut it for the checks while the
    // agent read it whole.
    const page = 'x'.repeat(200_000);
    streamEvents.mockResolvedValue(lookupStream(page));
    const { result } = await run({ message: 'look up the event cards' });

    const logged = result.toolCalls.find(call => call.tool === 'lookup_objects');

    expect(logged?.output).toBe(page);
  });

  it('the card backstop counts only cards that were put up: a refused action is re-put without it, and the log says so (finding 20)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    backstop.on = true;
    backstop.calls.length = 0;
    backstop.calls.push({ name: 'recommend_action', args: { action_id: 'no.such.action', action_input: { x: 1 }, label: 'File this as a request', rationale: 'seven reports' } });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(longAnswerStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { events } = await run({ message: 'Seven customers lost uploads.', deliverable: 'answer', conversationId: conv.id });

      const cards = events.filter(e => e.type === 'recommended_action') as Array<{ recommendation: { label: string; actionId: string } }>;

      expect(cards).toHaveLength(1);
      expect(cards[0]?.recommendation.label).toBe('File this as a request');
      expect(cards[0]?.recommendation.actionId).toBeFalsy();
      expect(warn.mock.calls.some(c => String(c[0]).includes('refused and re-put'))).toBe(true);
      expect(warn.mock.calls.some(c => String(c[0]) === 'card backstop' && (c[1] as { emitted: number; refused: number }).emitted === 1 && (c[1] as { refused: number }).refused === 1)).toBe(true);
    } finally {
      warn.mockRestore();
      backstop.on = false;
    }
  });

  it('a turn that thinks and says nothing twice runs once more with thinking off, and answers', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    const { compileAgentForRequest } = await import('@/services/agents/harness');
    vi.mocked(compileAgentForRequest).mockClear();
    streamEvents.mockClear();
    streamEvents
      .mockResolvedValueOnce(emptyStream())
      .mockResolvedValueOnce(emptyStream())
      .mockResolvedValueOnce(narratedToolStream('Four deals closed last month, worth $216K.'));
    const { result } = await run({ message: 'how many deals closed?', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(3);
    expect(vi.mocked(compileAgentForRequest)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(compileAgentForRequest).mock.calls[1]?.[3]).toMatchObject({ modelOverride: { thinking: 'off' } });
    // …and it names a model: without one the provider lookup crashed the turn (finding 25).
    expect(typeof (vi.mocked(compileAgentForRequest).mock.calls[1]?.[3] as { modelOverride: { model?: string } }).modelOverride.model).toBe('string');
    expect((vi.mocked(compileAgentForRequest).mock.calls[1]?.[3] as { modelOverride: { model?: string } }).modelOverride.model?.length).toBeGreaterThan(0);
    expect(result.response).toContain('Four deals closed');
  });

  it('a turn that never returns is stopped at the deadline, incomplete, with a reason (finding 22)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    process.env.VOCION_TURN_DEADLINE_MS = '300';
    streamEvents.mockClear();
    streamEvents.mockImplementation(async (_input: unknown, config: { signal?: AbortSignal }) => ({
      async* [Symbol.asyncIterator]() {
        yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text('Reading the request') } };
        await new Promise((_resolve, reject) => {
          config.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    }));
    try {
      await expect(run({ message: 'Approve filing it.', deliverable: 'answer', conversationId: conv.id })).rejects.toThrow(/ran past the 0-minute limit/);
    } finally {
      delete process.env.VOCION_TURN_DEADLINE_MS;
      streamEvents.mockReset();
    }
  });

  it('a backstop call that misses the tool\'s own schema is one refusal, not the end of the pass', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    backstop.on = true;
    backstop.calls.length = 0;
    // No action_input at all, and the label under `title` — the shape the model produced on walk 16.
    backstop.calls.push({ name: 'recommend_action', args: { action_id: 'no.such.action', title: 'Approve P1 fix: mobile upload lost on cellular' } });
    backstop.calls.push({ name: 'recommend_action', args: { action_id: '', action_input: {}, label: 'Tell the requester' } });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(longAnswerStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { events } = await run({ message: 'Seven customers lost uploads.', deliverable: 'answer', conversationId: conv.id });

      const cards = events.filter(e => e.type === 'recommended_action') as Array<{ recommendation: { label: string } }>;

      if (cards.length !== 2) {
        console.error('WARNS', JSON.stringify(warn.mock.calls.map(c => [String(c[0]), c[1]]).slice(-6)));
      }

      expect(cards.map(c => c.recommendation.label)).toEqual(['Approve P1 fix: mobile upload lost on cellular', 'Tell the requester']);
      expect(warn.mock.calls.some(c => String(c[0]) === 'card backstop failed')).toBe(false);
    } finally {
      warn.mockRestore();
      backstop.on = false;
    }
  });
});
