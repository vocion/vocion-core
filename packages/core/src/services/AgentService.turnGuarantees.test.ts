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
const judge = vi.hoisted(() => ({ intent: {} as Record<string, unknown> }));
vi.mock('@/services/agents/turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/agents/turnJudge')>();
  return {
    ...real,
    readIntent: vi.fn(async () => ({ ...real.NO_INTENT, ...judge.intent })),
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

  it('says a hand-off that did not complete, from the typed failure', async () => {
    const out = await applyTurnGuarantees({ orgId: ORG, agentSlug: 'lead', request: 'draft a pipeline report', response: 'Here is the pipeline report.', toolCalls: [], failures: [], failedDelegations: [{ name: 'Pipeline Analyst', message: 'timeout' }], answer: async () => 'should not be used', emit: () => {} });

    expect(out).toBe('Here is the pipeline report.\n\nThe hand-off to Pipeline Analyst did not complete (timeout), so nothing from that step is in this answer.');
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
});

/**
 * A turn that makes one lookup_objects call returning this text.
 * @param output - What the tool returned.
 */
/**
 * A turn that answers in prose.
 * @param body - The answer.
 */
function answerStream(body: string): AsyncIterable<unknown> {
  return { async* [Symbol.asyncIterator]() {
    yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: text(body) } };
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
      .mockResolvedValueOnce(answerStream('Four deals closed last month, worth $216K.'));
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
