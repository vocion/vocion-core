/**
 * Whether an agent's prompt-cache setting survives the trip into the artifact.
 *
 * Core writes `promptCache` on the agent row, sends it in the invocation
 * payload, and the loop has to hand it to `buildChatModel` — which is the only
 * place that decides whether the vendor is asked to cache at all. Every link is
 * silent when it breaks: an agent marked "do not cache" that still gets cached
 * pays the 1.25x write rate on every turn for a cache nothing reads back, and
 * nothing in the logs says so. Only the bill does.
 *
 * Absent has to stay distinguishable from `false`: absent means core said
 * nothing and the artifact's own default (on) applies, so a loop that passed
 * `promptCache: undefined` straight through would be fine, but one that filled
 * in a literal default would freeze today's answer into every request.
 */
import type { InvocationRequest } from './contract.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildChatModel = vi.fn(async (_options: Record<string, unknown>) => ({ _modelType: () => 'fake' }));
vi.mock('./model.js', () => ({ buildChatModel }));

/** An async iterable that yields nothing, for a stream the test does not use. */
async function* nothing(): AsyncGenerator<never> {}

const createDeepAgent = vi.fn(() => ({
  // The loop drains four streams off one run and then awaits its output;
  // all four are empty here, so the turn ends as soon as it has a model.
  streamEvents: () => ({
    messages: nothing(),
    toolCalls: nothing(),
    subagents: nothing(),
    output: Promise.resolve({ messages: [] }),
  }),
}));
// Partial: the memory-digest middleware reaches for other deepagents exports
// at graph-build time, so only the graph factory itself is replaced.
vi.mock('deepagents', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDeepAgent,
}));
vi.mock('./tools.js', () => ({ buildTransportTools: () => [] }));
vi.mock('./memory.js', () => ({
  loadHistory: async () => [],
  memoryEnabled: () => false,
  retrieveLongTerm: async () => [],
  saveTurn: async () => {},
}));

const { runInvocation } = await import('./loop.js');

/**
 * An invocation request whose agent is unique per test, so each one builds a
 * fresh graph rather than hitting the module-level cache a sibling filled.
 * @param slug - The agent slug, which is part of the cache key.
 * @param agent - Extra agent fields, e.g. the prompt-cache switch.
 */
function request(slug: string, agent: Record<string, unknown> = {}): InvocationRequest {
  return {
    version: 1,
    agent: { slug, name: slug, systemPrompt: 'Be helpful.', ...agent },
    message: 'hello',
    tools: { endpoint: 'https://core.example.com/api/internal/agent-tools', catalog: [], claim: 'claim-abc' },
    trace: { orgId: 'org_prompt_cache', userId: 'user_1' },
  } as unknown as InvocationRequest;
}

/**
 * Run one invocation and hand back the options `buildChatModel` was given.
 * @param req - The invocation to run.
 */
async function modelOptionsFor(req: InvocationRequest): Promise<Record<string, unknown>> {
  buildChatModel.mockClear();
  await runInvocation(req, () => {});
  const [call] = buildChatModel.mock.calls;
  if (!call) {
    throw new Error('the loop never built a chat model — the graph was served from cache');
  }
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the loop forwarding promptCache to buildChatModel', () => {
  it('passes an explicit false through, so "do not cache" is honoured', async () => {
    const options = await modelOptionsFor(request('no-cache-agent', { promptCache: false }));

    expect(options.promptCache).toBe(false);
  });

  it('passes an explicit true through', async () => {
    const options = await modelOptionsFor(request('yes-cache-agent', { promptCache: true }));

    expect(options.promptCache).toBe(true);
  });

  it('leaves the option out when the payload carried none', async () => {
    const options = await modelOptionsFor(request('silent-agent'));

    expect('promptCache' in options).toBe(false);
  });
});
