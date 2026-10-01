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

// The turn's judge (`agents/turnJudge.ts`) reads meaning with a model; each
// test says what that reading is. Unset, it is "no signal".
const judge = vi.hoisted(() => ({ intent: {} as Record<string, unknown>, readings: [] as Array<Record<string, unknown>> }));
vi.mock('@/services/agents/turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/agents/turnJudge')>();
  return {
    ...real,
    readIntent: vi.fn(async () => ({ ...real.NO_INTENT, ...judge.intent })),
    judgeAnswer: vi.fn(async () => ({ ...real.NO_JUDGEMENT, ...(judge.readings.shift() ?? {}) })),
  };
});

const streamEvents = vi.fn();
const backstop = vi.hoisted(() => ({ on: false, calls: [] as Array<{ name: string; args: Record<string, unknown> }>, delays: [] as number[], onCall: undefined as undefined | ((mark: string) => void) }));

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
  // The card pass is two steps (services/agents/cardBackstop.ts): the
  // classifier lists the decisions (labels only), then one extractor call per
  // card writes it. Each recorded call is one card; `delays` holds a writer
  // back by that many ms so a test can see the cards land out of order.
  buildChatModelForOrg: vi.fn(async (role: string) => (role === 'classifier'
    ? { invoke: async () => ({ content: JSON.stringify(backstop.calls.map(c => ({ label: c.args.label ?? c.args.title, why: 'named in the answer', action: c.args.action_id }))) }) }
    : {
        bindTools: () => ({
          invoke: async (messages: Array<{ content: unknown }>) => {
            const human = String(messages.at(-1)?.content ?? '');
            const index = backstop.calls.findIndex(c => human.startsWith(`CARD FOR: ${String(c.args.label ?? c.args.title)}\n`));
            // Any other pass (the owed-write filing) gets every recorded call.
            if (index === -1) {
              return { tool_calls: backstop.calls };
            }
            const call = backstop.calls[index]!;
            backstop.onCall?.(`model starts card ${index + 1}`);
            await new Promise(r => setTimeout(r, backstop.delays[index] ?? 0));
            backstop.onCall?.(`model finishes card ${index + 1}`);
            return { tool_calls: [{ name: call.name, args: call.args }] };
          },
        }),
      })),
}));
// The agent's tool belt, as the filing pass builds it: empty unless a test puts propose_action on it.
const toolBelt = vi.hoisted(() => ({ tools: [] as Array<{ name: string; invoke: (input: unknown) => Promise<unknown> }> }));
vi.mock('@/services/agents/tools/registry', () => ({ buildDomainTools: () => toolBelt.tools }));

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
const { applyTurnGuarantees, delegationFailureNotice, runAgentDeep } = await import('@/services/AgentService');
const { NO_JUDGEMENT } = await import('@/services/agents/turnJudge');

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
  judge.intent = {};
  judge.readings = [];
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

  it('the judge sees the failed hand-off, and the agent says so when its reply did not', async () => {
    const events: AgentEvent[] = [];
    const seen: Array<{ failed?: string[] }> = [];
    const out = await applyTurnGuarantees({
      orgId: ORG,
      agentSlug: 'lead',
      request: 'draft a pipeline report',
      response: 'Here is the pipeline report.',
      toolCalls: [],
      failures: [],
      failedDelegations: [{ name: 'Pipeline Analyst', message: 'timeout' }],
      judge: async (i) => {
        seen.push(i);
        return { ...NO_JUDGEMENT, hides_failure: true };
      },
      answer: async () => 'Pipeline Analyst did not complete (it timed out), so this report has no pipeline numbers yet.',
      emit: e => events.push(e),
    });

    expect(seen[0]!.failed).toEqual(['the hand-off to Pipeline Analyst did not complete (timeout)']);
    expect(out).toContain('Pipeline Analyst did not complete');
    expect(events.some(e => e.type === 'response_delta' && e.delta.includes('did not complete'))).toBe(true);
  });

  it('says nothing extra when the judge reads the reply as already owning up to it', async () => {
    const answer = 'I could not get a read from Pipeline Analyst, so this is partial.';
    const out = await applyTurnGuarantees({ orgId: ORG, agentSlug: 'lead', request: 'x', response: answer, toolCalls: [], failures: [], failedDelegations: [{ name: 'Pipeline Analyst', message: 'timeout' }], judge: async () => NO_JUDGEMENT, answer: async () => 'should not be used', emit: () => {} });

    expect(out).toBe(answer);
    expect(delegationFailureNotice([])).toBeNull();
  });

  it('names every specialist that failed, once', () => {
    // The crash path's notice: the turn has no answer to judge.
    const notice = delegationFailureNotice([{ name: 'Pipeline Analyst', message: 'timed out' }, { name: 'Proposal Writer', message: 'timed out' }]);

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

  it('a tool\'s name written as the last word re-enters once to make the call; the words stay as written', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    judge.readings = [{ wrote_call_as_text: 'recommend_action' }];
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narratedToolStream());
    const { result } = await run({ message: 'Approve filing it.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Call recommend_action now');
    expect(second.messages.at(-2)?.content).toContain('Filed. The build decision card is below.');
    expect(result.response).toContain('Filed. The build decision card is below.');
  });

  it('a whole call imitated as a fenced block at the end of the message is called too', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    judge.readings = [{ wrote_call_as_text: 'recommend_action' }];
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narratedToolStream('Should I reuse id 124?\n\nCARD\n```\nrecommend_action\nid: clarify-124\nquestion: which one?\n```'));
    const { result } = await run({ message: 'Approve filing it.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Call recommend_action now');
    expect(second.messages.at(-2)?.content).toContain('Should I reuse id 124?');
    expect(result.response).toContain('Should I reuse id 124?');
  });

  it('a call written as a heading over a JSON block — three of them — re-enters the loop to make it (finding 19)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    judge.readings = [{ wrote_call_as_text: 'update_object' }];
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(narratedToolStream('Now writing each update:\n\n**update_object — request 30**\n\n```json\n{"object_type":"request","id":30,"fields":{"title":"add-send-admin-panel"}}\n```\n\n**update_object — request 38**\n\n```json\n{"object_type":"request","id":38}\n```'));
    const { result } = await run({ message: 'Backfill the three requests.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-1)?.content).toContain('Call update_object now');
    expect(second.messages.at(-2)?.content).toContain('Now writing each update:');
    expect(result.response).toContain('Now writing each update:');
  });

  it('a call written out AFTER the continuation re-enters once more, naming the tool (mission run 5067, backlog 006)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    streamEvents.mockClear();
    streamEvents
      // The one continuation is spent on a preamble…
      .mockResolvedValueOnce(narrationStream())
      // …and the pass it buys writes the write out as text.
      .mockResolvedValueOnce(narratedToolStream('Now filing the single update:\n\n**update_object** — request #30\n\n```json\n{"title":"Admin panel so ops can comp orgs"}\n```\n\n*(Calling update_object now.)*'))
      .mockResolvedValueOnce(lookupStream('[{"id":30}]'));
    // The first pass only promised; after the continuation the reply writes the call out.
    judge.readings = [{ answered: false, ends_on_promise: true, promise: 'Let me check the right structure first.' }, { wrote_call_as_text: 'update_object' }];
    await run({ message: 'Backfill request 30.', deliverable: 'answer', conversationId: conv.id });

    expect(streamEvents).toHaveBeenCalledTimes(3);

    const third = streamEvents.mock.calls[2]![0] as { messages: Array<{ role: string; content: string }> };

    expect(third.messages.at(-1)?.content).toContain('Call update_object now');
  });

  it('a continuation that reads and stops on a tool result keeps going instead of handing the write to the answer pass (mission run 5074)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    const readsOnly = (): AsyncIterable<unknown> => ({ async* [Symbol.asyncIterator]() {
      yield { event: 'on_tool_end', name: 'read_object', metadata: { checkpoint_ns: 'tools:read-1' }, data: { input: { id: 30 }, output: { content: '{"id":30}' } } };
    } });
    streamEvents.mockClear();
    streamEvents
      .mockResolvedValueOnce(narrationStream())
      .mockResolvedValueOnce(readsOnly())
      .mockResolvedValueOnce(lookupStream('[{"id":30}]'));
    judge.readings = [{ answered: false, ends_on_promise: true, promise: 'Let me check the right structure first.' }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await run({ message: 'Backfill request 30.', deliverable: 'answer', conversationId: conv.id });

      expect(streamEvents).toHaveBeenCalledTimes(3);

      const third = streamEvents.mock.calls[2]![0] as { messages: Array<{ role: string; content: string }> };

      expect(third.messages.at(-1)?.content).toContain('make the write');
      // …and it can SEE what the reads returned: a fresh graph starts from
      // text, so without this the pass re-reads blind (mission run 5081).
      expect(third.messages.at(-1)?.content).toContain('What your tool calls in this turn returned');
      expect(third.messages.at(-1)?.content).toContain('### read_object');
      expect(warn.mock.calls.some(c => String(c[0]).includes('making progress; going on'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('goes on past three passes while each pass makes a new call, and stops at the first pass that repeats one (Chris, 2026-09-29)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    const read = (id: number): AsyncIterable<unknown> => ({ async* [Symbol.asyncIterator]() {
      yield { event: 'on_tool_end', name: 'read_object', metadata: { checkpoint_ns: `tools:read-${id}` }, data: { input: { id }, output: { content: `{"id":${id}}` } } };
    } });
    judge.readings = [{ answered: false, ends_on_promise: true, promise: 'Let me check the right structure first.' }];
    streamEvents.mockClear();
    streamEvents
      .mockResolvedValueOnce(narrationStream())
      .mockResolvedValueOnce(read(30))
      .mockResolvedValueOnce(read(31))
      .mockResolvedValueOnce(read(32))
      .mockResolvedValueOnce(read(33))
      // The same read again is not progress: the loop stops here.
      .mockResolvedValueOnce(read(33))
      .mockResolvedValue(lookupStream('[{"id":30}]'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await run({ message: 'Backfill requests 30 to 33.', deliverable: 'answer', conversationId: conv.id });

      // first pass, the promise's continuation, then one pass per new read (31, 32, 33), and the repeat of 33 ends it
      expect(streamEvents).toHaveBeenCalledTimes(6);
      expect(warn.mock.calls.filter(c => String(c[0]).includes('making progress; going on'))).toHaveLength(4);
    } finally {
      warn.mockRestore();
    }
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
    judge.readings = [{ answered: false, ends_on_promise: true, promise: 'Let me check the right structure first.' }];
    const { result } = await run({ message: 'what should I do right now?', deliverable: 'answer', conversationId: conv.id });

    expect(await listArtifactsForConversation({ orgId: ORG, conversationId: conv.id })).toHaveLength(0);
    // "Let me check…" with no tool call is a promise, not an answer (production
    // turn 577): the loop re-enters once with the promise as its own last words.
    expect(streamEvents).toHaveBeenCalledTimes(2);

    const second = streamEvents.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };

    expect(second.messages.at(-2)).toEqual({ role: 'assistant', content: 'Let me check the right structure first.' });
    expect(second.messages.at(-1)?.content).toContain('a promise, not an answer');
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

  it('a card whose action is refused is not a dead card, and not a line in the reply either: the log says so (finding 20, conversation 351; Chris, 2026-09-29)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    backstop.on = true;
    backstop.calls.length = 0;
    backstop.calls.push({ name: 'recommend_action', args: { action_id: 'no.such.action', action_input: { x: 1 }, label: 'File this as a request', rationale: 'seven reports' } });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(longAnswerStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { events, result } = await run({ message: 'Seven customers lost uploads.', deliverable: 'answer', conversationId: conv.id });

      expect(events.filter(e => e.type === 'recommended_action')).toHaveLength(0);
      expect(result.response).not.toContain('not a card');
      expect(events.some(e => e.type === 'response_delta' && e.delta.includes('not a card'))).toBe(false);
      expect(warn.mock.calls.some(c => String(c[0]).includes('refused and dropped'))).toBe(true);
      expect(warn.mock.calls.some(c => String(c[0]) === 'card backstop' && String((c[1] as { dropped: string[] }).dropped).includes('no registered action "no.such.action"'))).toBe(true);
      expect(warn.mock.calls.some(c => String(c[0]) === 'card backstop' && (c[1] as { emitted: number; refused: number }).emitted === 0 && (c[1] as { refused: number }).refused === 1)).toBe(true);
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
    backstop.calls.push({ name: 'recommend_action', args: { action_id: 'gmail.send', action_input: { to: 'ops@kestrel.example', subject: 'Uploads', body: 'We are fixing it.', draft: true }, label: 'Tell the requester' } });
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(longAnswerStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { events } = await run({ message: 'Seven customers lost uploads.', deliverable: 'answer', conversationId: conv.id });

      const cards = events.filter(e => e.type === 'recommended_action') as Array<{ recommendation: { label: string } }>;

      if (cards.length !== 2) {
        console.error('WARNS', JSON.stringify(warn.mock.calls.map(c => [String(c[0]), c[1]]).slice(-6)));
      }

      // The refused one is a line under the answer, never a card with nothing to press.
      expect(cards.map(c => c.recommendation.label)).toEqual(['Tell the requester']);
      expect(warn.mock.calls.some(c => String(c[0]) === 'card backstop failed')).toBe(false);
    } finally {
      warn.mockRestore();
      backstop.on = false;
    }
  });
});

describe('a write the answer claims is a write that ran (finding 23)', () => {
  const claimed = 'Scoped the StampSend MCP work against the Send standards and the current connector.\n\n**Filed:** Request recorded for Send. Architecture plan queued.';
  const correction = 'I did not file the request: nothing was saved. Say the word and I will file it now.';
  const base = { orgId: ORG, agentSlug: 'lead', request: 'File it.', failures: [], failedDelegations: [], answer: async () => correction };

  it('the agent corrects itself, live and stored, when the judge finds the claim has no step behind it', async () => {
    const events: AgentEvent[] = [];
    const out = await applyTurnGuarantees({ ...base, judge: async () => ({ ...NO_JUDGEMENT, claims_unrecorded_work: true, claim: 'Request recorded for Send.' }), response: claimed, toolCalls: [{ tool: 'lookup_objects', output: 'request #126' }], emit: e => events.push(e) });

    expect(out).toContain(correction);
    expect(events.some(e => e.type === 'response_delta' && e.delta.includes(correction))).toBe(true);
  });

  it('says nothing to the person when the correction pass finds none owed, and never shows its critique (run 3, 2026-10-01)', async () => {
    const reply = 'I\'ll check what\'s there before filing.\n\nThe uploaded date is not shown yet. Filing it now.';
    const events: AgentEvent[] = [];
    const out = await applyTurnGuarantees({
      ...base,
      judge: async () => ({ ...NO_JUDGEMENT, claims_unrecorded_work: true, claim: 'Filing it now.' }),
      answer: async () => '',
      correct: async () => ({ owed: false, sentence: 'The opening line implied the filing had not happened yet when it had.' }),
      response: reply,
      toolCalls: [{ tool: 'file_request', output: 'objects.propose_candidate is DONE: filed as request #303' }],
      emit: e => events.push(e),
    });

    expect(out).toBe(reply);
    expect(events.some(e => e.type === 'response_delta')).toBe(false);
  });

  it('a correction owed is the agent\'s one sentence about the work', async () => {
    const out = await applyTurnGuarantees({
      ...base,
      judge: async () => ({ ...NO_JUDGEMENT, claims_unrecorded_work: true, claim: 'Request recorded for Send.' }),
      correct: async () => ({ owed: true, sentence: correction }),
      response: claimed,
      toolCalls: [{ tool: 'lookup_objects', output: 'request #126' }],
      emit: () => {},
    });

    expect(out).toBe(`${claimed}\n\n${correction}`);
  });

  it('says nothing when the judge finds the work behind the claim', async () => {
    const out = await applyTurnGuarantees({ ...base, judge: async () => NO_JUDGEMENT, response: claimed, toolCalls: [{ tool: 'update_object', output: '{"ok":true,"id":130}' }], emit: () => {} });

    expect(out).toBe(claimed);
  });
});

describe('the answer pass streams (2026-09-25: "the response just pops in")', () => {
  it('sends the answer as it is written, and the stored text is what was sent', async () => {
    const events: AgentEvent[] = [];
    const out = await applyTurnGuarantees({
      orgId: ORG,
      agentSlug: 'lead',
      request: 'What should I do right now?',
      response: 'I\'ll read the records before answering.',
      toolCalls: [{ tool: 'lookup_objects', output: 'request #126 Retry uploads — state new' }],
      endedOnTool: true,
      failures: [],
      failedDelegations: [],
      emit: e => events.push(e),
      answer: async ({ onDelta }) => {
        for (const piece of ['  Approve', ' request #126', ' first.']) {
          onDelta?.(piece);
        }
        return 'Approve request #126 first.';
      },
    });

    const deltas = events.filter(e => e.type === 'response_delta').map(e => (e as { delta: string }).delta);

    expect(deltas).toEqual(['\n\nApprove', ' request #126', ' first.']);
    expect(out).toBe('I\'ll read the records before answering.\n\nApprove request #126 first.');
  });
});

describe('the card pass writes every card at once (2026-09-25/28: "waiting like 40 seconds for the cards")', () => {
  it('starts every card call before any returns, and puts each up the moment its own call does', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    backstop.on = true;
    backstop.calls.length = 0;
    backstop.calls.push(
      { name: 'recommend_action', args: { action_id: 'gmail.send', action_input: { to: 'ops@kestrel.example', subject: 'P1 fix', body: 'Approving the upload fix today.', draft: true }, label: 'Approve the P1 upload fix', rationale: 'seven reports' } },
      { name: 'recommend_action', args: { action_id: 'gmail.send', action_input: { to: 'pm@kestrel.example', subject: 'Admin panel', body: 'Deferring the admin panel.', draft: true }, label: 'Defer the admin panel', rationale: 'no demand yet' } },
    );
    const order: string[] = [];
    backstop.onCall = mark => order.push(mark);
    // Card 1 is the slow one: card 2 must not wait for it.
    backstop.delays = [60, 5];
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(longAnswerStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runAgentDeep({
        orgId: ORG,
        agentSlug: 'lead',
        message: 'What should I do right now?',
        deliverable: 'answer',
        conversationId: conv.id,
        onEvent: (e) => {
          if (e.type === 'recommended_action') {
            order.push(`on screen: ${(e as { recommendation: { label: string } }).recommendation.label}`);
          }
        },
      });

      // Both calls in flight before either returns; each card on screen right
      // after ITS call, so the fast one lands first.
      expect(order).toEqual([
        'model starts card 1',
        'model starts card 2',
        'model finishes card 2',
        'on screen: Defer the admin panel',
        'model finishes card 1',
        'on screen: Approve the P1 upload fix',
      ]);
    } finally {
      warn.mockRestore();
      backstop.on = false;
      backstop.onCall = undefined;
      backstop.delays = [];
    }
  });
});

describe('the live line says what is happening (2026-09-25: "Working is such a lazy progress label")', () => {
  it('ends the turn before the cards, which land after it with no status line (conversation 392)', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
    backstop.on = true;
    backstop.calls.length = 0;
    backstop.calls.push(
      { name: 'recommend_action', args: { action_id: 'gmail.send', action_input: { to: 'ops@kestrel.example', subject: 'P1 fix', body: 'Approving the upload fix today.', draft: true }, label: 'Approve the Kestrel upload fix', rationale: 'seven reports' } },
      { name: 'recommend_action', args: { action_id: 'gmail.send', action_input: { to: 'pm@kestrel.example', subject: 'Admin panel', body: 'Deferring the admin panel.', draft: true }, label: 'Defer the admin panel', rationale: 'no demand yet' } },
    );
    streamEvents.mockClear();
    streamEvents.mockResolvedValue(longAnswerStream());
    const order: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runAgentDeep({
        orgId: ORG,
        agentSlug: 'lead',
        message: 'What should I do right now?',
        deliverable: 'answer',
        conversationId: conv.id,
        onEvent: (e) => {
          if (e.type === 'done') {
            order.push('done');
          }
          if (e.type === 'recommended_action') {
            order.push(`card: ${e.recommendation.label}`);
          }
          if (e.type === 'status' && /decision/.test(e.label)) {
            order.push(`status: ${e.label}`);
          }
        },
      });

      // The composer is free the moment the answer is; the cards follow on the
      // same stream, and nothing says "Writing…" under a finished answer.
      expect(order[0]).toBe('done');
      expect(order.slice(1).sort()).toEqual(['card: Approve the Kestrel upload fix', 'card: Defer the admin panel']);
    } finally {
      warn.mockRestore();
      backstop.on = false;
    }
  });
});

describe('a reply cut off mid-sentence is finished by the agent, as it writes it', () => {
  it('leaves a continuation that simply finishes the word alone', async () => {
    const said = 'Two corrections to what I said last turn, now that I have checked the table:\n\n**The';
    judge.readings = [{ cut_off: true }];
    const next = 're is still no request record on file for this.**';
    streamEvents
      .mockResolvedValueOnce({ async* [Symbol.asyncIterator]() {
        yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(said) } };
      } })
      .mockResolvedValueOnce({ async* [Symbol.asyncIterator]() {
        yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(next) } };
      } })
      .mockResolvedValue(emptyStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = await run({ message: 'What changed since last turn?' });

      expect(result.response).toContain('**There is still no request record on file for this.**');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('"Filed." with nothing behind it is corrected (conversation 349, second turn)', () => {
  const base = { orgId: ORG, agentSlug: 'lead', request: 'Please file it now.', failures: [], failedDelegations: [], answer: async () => '' };

  it('the judge is handed the reply, the steps and the cards shown, and a claim it finds is corrected', async () => {
    const seen: Array<{ reply: string; steps: string[]; cards: number }> = [];
    const out = await applyTurnGuarantees({
      ...base,
      answer: async () => 'Nothing was filed yet; I will file it when you say so.',
      judge: async (i) => {
        seen.push(i);
        return { ...NO_JUDGEMENT, claims_unrecorded_work: true, claim: 'Filed.' };
      },
      response: 'Filed. The request card is on your screen — approving it is what writes the record.',
      toolCalls: [{ tool: 'lookup_objects', output: 'No request record matched' }],
      cardsShown: 0,
      emit: () => {},
    });

    expect(seen[0]).toMatchObject({ cards: 0, steps: ['lookup_objects → No request record matched'] });
    expect(out).toContain('Nothing was filed yet');
  });

  it('says nothing when the judge finds nothing claimed', async () => {
    const out = await applyTurnGuarantees({ ...base, judge: async () => NO_JUDGEMENT, response: 'Here is what I found. The request card is on your screen.', toolCalls: [], cardsShown: 1, emit: () => {} });

    expect(out).toBe('Here is what I found. The request card is on your screen.');
  });
});

describe('the person asked for a record and the turn wrote nothing (conversation 349)', () => {
  it('files it in one pass with propose_action chosen, links it, and the claim check stays quiet', async () => {
    const received: unknown[] = [];
    toolBelt.tools = [{
      name: 'propose_action',
      invoke: async (input) => {
        received.push(input);
        return 'objects.propose_candidate is DONE: filed as request #131 (run #7, confidence 0.8), open at /w/northwind/dashboard/p/feature/131. Title: Export the viewer list.';
      },
    }];
    backstop.calls.length = 0;
    backstop.calls.push({ name: 'propose_action', args: { action_id: 'objects.propose_candidate', action_input: { objectType: 'request', title: 'Export the viewer list' }, confidence: 0.8, rationale: 'Asked for in chat.', suggested_decision: 'approve', suggested_decision_reason: 'Asked for directly.' } });
    judge.intent = { files_new_record: true, wants_action: true };
    streamEvents.mockResolvedValueOnce({ async* [Symbol.asyncIterator]() {
      yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text('Filed. The request card is on your screen — approving it is what writes the record.') } };
    } }).mockResolvedValue(emptyStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result, events } = await run({ message: 'You said nothing was saved. Please file it now.' });

      expect(received).toHaveLength(1);
      expect(result.response).toContain('Filed from this conversation: [request #131](/w/northwind/dashboard/p/feature/131).');
      expect(result.response).not.toContain('Nothing was saved in this turn');
      expect(result.toolCalls.map(c => c.tool)).toContain('propose_action');
      expect(events.some(e => e.type === 'status' && e.label === 'Filing what you asked for')).toBe(true);
    } finally {
      warn.mockRestore();
      toolBelt.tools = [];
      backstop.calls.length = 0;
    }
  });

  it('does not run when the person asked for nothing to be filed', async () => {
    const received: unknown[] = [];
    toolBelt.tools = [{ name: 'propose_action', invoke: async (input) => {
      received.push(input);
      return '';
    } }];
    streamEvents.mockResolvedValue(longFormStream());
    try {
      await run({ message: 'What changed since last turn?' });

      expect(received).toHaveLength(0);
    } finally {
      toolBelt.tools = [];
    }
  });
});

describe('a tool call written as text is the call (conversation 355)', () => {
  it('never streams the block, runs it as the real tool, and stores the answer without it', async () => {
    const received: unknown[] = [];
    toolBelt.tools = [{
      name: 'recommend_action',
      invoke: async (input) => {
        received.push(input);
        return 'Surfaced a one-tap recommendation to the user: "Write the narrowed scope onto 124".';
      },
    }];
    const block = '<recommend_action>\n{"action_id":"objects.update_meta","action_input":{"objectType":"request","id":124,"set":{"outcome":"Email only."}},"label":"Write the narrowed scope onto 124","confidence":0.55}\n</recommend_action>';
    streamEvents.mockResolvedValueOnce({ async* [Symbol.asyncIterator]() {
      for (const piece of ['Scope change taken.\n\n', block.slice(0, 40), block.slice(40), '\n\nWant a sketch first?']) {
        yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(piece) } };
      }
    } }).mockResolvedValue(emptyStream());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result, events } = await run({ message: 'What is left in scope?' });
      const streamed = events.filter(e => e.type === 'response_delta').map(e => (e as { delta: string }).delta).join('');

      expect(streamed).not.toContain('recommend_action');
      expect(result.response).not.toContain('action_id');
      expect(result.response).toContain('Scope change taken.');
      expect(result.response).toContain('Want a sketch first?');
      expect(received).toEqual([expect.objectContaining({ action_id: 'objects.update_meta', label: 'Write the narrowed scope onto 124', action_input: { objectType: 'request', id: 124, set: { outcome: 'Email only.' } } })]);
      expect(result.toolCalls.map(c => c.tool)).toContain('recommend_action');
    } finally {
      warn.mockRestore();
      toolBelt.tools = [];
    }
  });
});
