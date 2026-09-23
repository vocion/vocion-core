/**
 * An in-process agent turn that spends through its cap partway stops at the
 * next model call instead of running to the end (#272).
 *
 * The loop is a stand-in that behaves like LangGraph where it matters: each
 * model call finishes by reporting usage through the Langfuse callback's
 * `onTurnEnd` (which is where the charge and the re-check happen), and the
 * stream throws once the `signal` it was given is aborted. What is under test
 * is the wiring in `runAgentDeep` — that the re-check runs after every call,
 * that its abort reaches the stream, and that the turn ends as a refusal
 * naming the cap rather than as an unexplained failure.
 */
import type { AgentEvent } from '@/services/agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const streamEvents = vi.fn();
const turnEndHooks: Array<(turn: { model: string; inputTokens?: number; outputTokens?: number }) => Promise<void>> = [];

vi.mock('@/services/agents/harness', () => ({
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: (_h: unknown, o?: { model: string }) => (o ? { ...o } : {}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async () => ({
    graph: { streamEvents },
    agentRow: { id: 1, slug: 'lead', name: 'Revenue Lead', systemPrompt: 'Be useful.', harnessConfig: {} },
    ctx: { delegations: new Map() },
  })),
}));

vi.mock('@/libs/Langfuse', () => ({
  createLangfuseCallback: vi.fn((opts: { onTurnEnd: (typeof turnEndHooks)[number] }) => {
    turnEndHooks.push(opts.onTurnEnd);
    return { handler: {}, trace: { id: 'trace-1', update: vi.fn() } };
  }),
  flushTraces: vi.fn(async () => {}),
}));

const preflightCheck = vi.fn();
const chargeUsage = vi.fn(async () => {});
vi.mock('@/services/BudgetService', () => ({ preflightCheck, chargeUsage }));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');

const ORG = 'org_agent_budget_stop';

const BREACH = {
  ok: false,
  reason: 'hard_cents_exceeded',
  scope: 'agent',
  agentSlug: 'lead',
  limit: 10_000,
  current: 10_050,
  limitFrom: 'built_in_agent_default',
} as const;

/**
 * `AIMessageChunk` content shape the answer streamer reads.
 * @param t - The text.
 */
function text(t: string): unknown {
  return { content: [{ type: 'text', text: t }] };
}

/** How many model calls the stand-in loop actually started. */
let modelCallsStarted = 0;
/** What the usage hook threw, kept the way the real adapter drops it. */
const hookErrors: unknown[] = [];

/**
 * A loop that makes `calls` model calls, each streaming a word and then
 * reporting its usage, and that gives up the way LangGraph does once its
 * signal is aborted.
 * @param calls - Model calls the loop would make if nothing stopped it.
 * @param signal - The abort signal `runAgentDeep` passed in the stream config.
 */
function modelCallsStream(calls: number, signal: AbortSignal | undefined): AsyncIterable<unknown> {
  return { async* [Symbol.asyncIterator]() {
    for (let call = 1; call <= calls; call += 1) {
      if (signal?.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }
      modelCallsStarted += 1;
      yield { event: 'on_chat_model_stream', metadata: { checkpoint_ns: `model_request:m${call}` }, data: { chunk: text(`part${call} `) } };
      // The real adapter (`libs/Langfuse.ts`) swallows whatever the hook
      // throws, so a failed charge never reaches the stream — only the abort does.
      await turnEndHooks.at(-1)!({ model: 'claude-haiku-4-5-20251001', inputTokens: 1_000, outputTokens: 100 })
        .catch((hookError: unknown) => hookErrors.push(hookError));
    }
  } };
}

async function run() {
  const events: AgentEvent[] = [];
  const outcome = await runAgentDeep({
    orgId: ORG,
    agentSlug: 'lead',
    message: 'work the whole queue',
    onEvent: e => void events.push(e),
  }).then(result => ({ result, error: null }), (error: unknown) => ({ result: null, error }));
  return { ...outcome, events };
}

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'lead', name: 'Revenue Lead', systemPrompt: 'Be useful.', harnessConfig: {} } as never);
  streamEvents.mockReset().mockImplementation(async (_input: unknown, config: { signal?: AbortSignal }) => modelCallsStream(3, config.signal));
  preflightCheck.mockReset();
  chargeUsage.mockClear();
  turnEndHooks.length = 0;
  modelCallsStarted = 0;
  hookErrors.length = 0;
});

describe('a turn that crosses its budget partway', () => {
  it('stops before the next model call and ends as a refusal naming the cap', async () => {
    // Preflight, then the re-check after each call: under, under, over.
    preflightCheck
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(BREACH);

    const { error, events } = await run();

    expect(modelCallsStarted).toBe(2);
    expect(chargeUsage).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ name: 'TurnRefusedError', message: expect.stringContaining('stopped partway') });
    expect((error as Error).message).toContain('$100.50 of a $100.00 cap');
    expect(events).toContainEqual({ type: 'error', message: (error as Error).message });
  });

  it('still re-checks after a model call whose charge could not be written', async () => {
    chargeUsage.mockRejectedValueOnce(new Error('database unavailable'));
    preflightCheck
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(BREACH);

    const { error } = await run();

    expect(modelCallsStarted).toBe(1);
    expect(error).toMatchObject({ name: 'TurnRefusedError' });
    expect(hookErrors).toEqual([expect.objectContaining({ message: 'database unavailable' })]);
  });

  it('runs every model call and answers when the agent stays under its cap', async () => {
    preflightCheck.mockResolvedValue({ ok: true });

    const { result, error } = await run();

    expect(error).toBeNull();
    expect(modelCallsStarted).toBe(3);
    expect(result?.response).toContain('part3');
  });
});
