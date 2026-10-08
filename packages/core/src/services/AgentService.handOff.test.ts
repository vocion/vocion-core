/**
 * A person's turn ends at the card it put in front of them (`agents/handOff.ts`).
 *
 * The loop is the budget-stop test's stand-in: each model call streams a word,
 * every callback hears the call start, and the stream gives up once the signal
 * it was given is aborted. Between calls a tool puts a card up through the
 * turn's emit, the way `offer_connection` and `recommend_action` do. Under
 * test is the wiring in `runAgentDeep`: the card is noticed, the next model
 * call is where the turn stops, the words before the card are the answer, and
 * the stop is not a failure. A mission run is not stopped: nobody is waiting.
 */
import type { AgentEvent } from '@/services/agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/agents/turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/agents/turnJudge')>();
  return { ...real, readIntent: vi.fn(async () => ({ asks: 'answer', changed_record_type: null, record_type: null, summary: '' })) };
});

const streamEvents = vi.fn();
/** The turn's emit, as `compileAgentForRequest` was handed it — what a tool emits through. */
const turnEmit = vi.hoisted(() => ({ fn: null as null | ((e: unknown) => void) }));

vi.mock('@/services/agents/harness', () => ({
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: (_h: unknown, o?: { model: string }) => (o ? { ...o } : {}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async (_org: string, _slug: string, deps: { emit: (e: unknown) => void }) => {
    turnEmit.fn = deps.emit;
    return {
      graph: { streamEvents },
      agentRow: { id: 1, slug: 'product-manager', name: 'Product manager', systemPrompt: 'Be useful.', harnessConfig: {} },
      ctx: { delegations: new Map() },
    };
  }),
}));

vi.mock('@/libs/Langfuse', () => ({
  createLangfuseCallback: vi.fn(() => ({ handler: {}, trace: { id: 'trace-1', update: vi.fn() } })),
  flushTraces: vi.fn(async () => {}),
}));

vi.mock('@/services/BudgetService', () => ({ preflightCheck: vi.fn(async () => ({ ok: true })), chargeUsage: vi.fn(async () => {}) }));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');

const ORG = 'org_hand_off';

type StreamConfig = { signal?: AbortSignal; callbacks?: Array<{ handleChatModelStart?: () => Promise<void> }> };

let modelCallsStarted = 0;

const CONNECT_CARD = { type: 'card', card: { id: 'card-1', kind: 'link', title: 'Connect GitHub', rationale: 'Read the repositories.', actions: [], source: {}, href: '/dashboard/connectors?add=github', hrefLabel: 'Connect GitHub', state: 'proposed' } };
const RECOMMENDATION = { type: 'recommended_action', recommendation: { id: 'rec-1', label: 'Approve the build', actionId: 'factory.dispatch_task', input: {} } };
const PENDING_CARD = { type: 'card', card: { id: 'card-2', kind: 'action', title: 'Propose candidate: northwind/send-api', actions: [{ label: 'Approve', actionId: 'objects.propose_candidate', input: {}, style: 'primary' }], source: {}, runId: 77, state: 'filed' } };

/**
 * Three model calls; after the call numbered `cardAfter`, a tool puts `card` up.
 * @param cardAfter - The call after which the card is emitted.
 * @param card - The event the tool emits.
 * @param config - The stream config `runAgentDeep` passed.
 */
function stream(cardAfter: number, card: unknown, config: StreamConfig): AsyncIterable<unknown> {
  return { async* [Symbol.asyncIterator]() {
    for (let call = 1; call <= 3; call += 1) {
      for (const callback of config.callbacks ?? []) {
        await callback.handleChatModelStart?.();
      }
      if (config.signal?.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }
      modelCallsStarted += 1;
      yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: `model_request:m${call}` }, data: { chunk: { content: [{ type: 'text', text: `part${call} ` }] } } };
      if (call === cardAfter) {
        // The card tool runs as the step's tool: its end event is what the
        // loop logs as a tool call, and it emits the card through the turn.
        yield { event: 'on_tool_start', name: 'offer_connection', run_id: 'run-offer', metadata: { checkpoint_ns: 'tools:t1' }, data: { input: { connector: 'github' } } };
        turnEmit.fn!(card);
        yield { event: 'on_tool_end', name: 'offer_connection', run_id: 'run-offer', metadata: { checkpoint_ns: 'tools:t1' }, data: { input: { connector: 'github' }, output: { content: 'Card up.', status: 'success' } } };
      }
    }
  } };
}

async function run(opts: { userId?: string; missionRunId?: number } = {}) {
  const events: AgentEvent[] = [];
  const outcome = await runAgentDeep({
    orgId: ORG,
    agentSlug: 'product-manager',
    message: 'Set up my software factory',
    conversationId: 91,
    onEvent: e => void events.push(e),
    ...opts,
  }).then(result => ({ result, error: null }), (error: unknown) => ({ result: null, error }));
  return { ...outcome, events };
}

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'product-manager', name: 'Product manager', systemPrompt: 'Be useful.', harnessConfig: {} } as never);
  modelCallsStarted = 0;
  turnEmit.fn = null;
});

describe('a turn that puts a card in front of a person', () => {
  it('ends before the next model call, keeps the words before the card, and is not a failure', async () => {
    streamEvents.mockReset().mockImplementation(async (_input: unknown, config: StreamConfig) => stream(1, CONNECT_CARD, config));

    const { result, error, events } = await run({ userId: 'usr-jamie' });

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(1);
    expect(result?.response).toContain('part1');
    expect(result?.response).not.toContain('part2');
    expect(result?.toolCalls.map(c => c.tool)).toEqual(['offer_connection']);
    expect(events.some(e => e.type === 'card')).toBe(true);
    expect(events.some(e => e.type === 'error' || e.type === 'tool_error')).toBe(false);
    // The turn ended on a tool, which usually owes an answer; behind a card
    // nothing composes one, so no second model writes under it.
    expect(events.some(e => e.type === 'status' && /Writing the answer/.test(e.label))).toBe(false);

    const done = events.find(e => e.type === 'done') as { response: string } | undefined;

    expect(done?.response).toBe(result?.response);
  });

  it('is not armed for a person\'s turn outside a conversation (a briefing, an eval, a workflow)', async () => {
    streamEvents.mockReset().mockImplementation(async (_input: unknown, config: StreamConfig) => stream(1, CONNECT_CARD, config));

    const { error } = await runAgentDeep({ orgId: ORG, agentSlug: 'product-manager', message: 'Set up my software factory', userId: 'eval-runner', onEvent: () => {} }).then(() => ({ error: null }), (e: unknown) => ({ error: e }));

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(3);
  });

  it('treats a proposal filed for approval (a card in state filed) the same way', async () => {
    streamEvents.mockReset().mockImplementation(async (_input: unknown, config: StreamConfig) => stream(1, PENDING_CARD, config));

    const { result, error } = await run({ userId: 'usr-jamie' });

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(1);
    expect(result?.response).not.toContain('part2');
  });

  it('treats a recommended action the same way', async () => {
    streamEvents.mockReset().mockImplementation(async (_input: unknown, config: StreamConfig) => stream(2, RECOMMENDATION, config));

    const { result, error } = await run({ userId: 'usr-jamie' });

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(2);
    expect(result?.response).toContain('part2');
    expect(result?.response).not.toContain('part3');
  });

  it('lets a mission run carry on past its cards: nobody is waiting on them', async () => {
    streamEvents.mockReset().mockImplementation(async (_input: unknown, config: StreamConfig) => stream(1, CONNECT_CARD, config));

    const { result, error } = await run({ missionRunId: 7 });

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(3);
    expect(result?.response).toContain('part3');
  });

  it('runs to the end when no card goes up', async () => {
    streamEvents.mockReset().mockImplementation(async (_input: unknown, config: StreamConfig) => stream(0, CONNECT_CARD, config));

    const { result, error } = await run({ userId: 'usr-jamie' });

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(3);
    expect(result?.response).toContain('part3');
  });
});
