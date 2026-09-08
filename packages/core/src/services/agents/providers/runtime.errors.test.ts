/**
 * Failure-path behavior of the runtime provider: three findings from a
 * review of this file, each pinned by its own describe block.
 *
 * 1. Memory actor scoping — the AgentCore Memory actor id must fold in
 *    orgId, exactly like the sessionId next to it does, or two orgs
 *    sharing a userId (or every org's unauthenticated run) share one
 *    long-term memory namespace.
 * 2. Transport failure — a thrown error from either transport (SigV4 or
 *    plain fetch) must surface as a typed `{ type: 'error' }` event on the
 *    stream, in addition to rejecting the returned promise, so a caller
 *    consuming events sees a typed failure instead of a stream that just
 *    stops.
 * 3. Budget-charge failures must be logged, not swallowed, and must not
 *    abort the turn — the model's response still comes back.
 * 4. A malformed SSE frame must be logged and skipped, not silently
 *    dropped and not treated as a reason to end the stream.
 */
import type { AgentEvent } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const mintBedrockSessionForRuntime = vi.fn(async () => null);
const chargeUsage = vi.fn(async () => {});
vi.mock('@/libs/llm/bedrockCredentials', () => ({ mintBedrockSessionForRuntime }));
vi.mock('@/services/agents/harness', () => ({ buildInitialFiles: vi.fn(async () => ({})) }));
vi.mock('@/services/agents/tools/registry', () => ({ buildToolCatalog: vi.fn(() => []) }));
vi.mock('@/services/agents/claims', () => ({ signClaim: vi.fn(() => 'signed-claim') }));
vi.mock('@/services/BudgetService', () => ({ chargeUsage }));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentOnRuntime } = await import('./runtime');

const ORG_A = 'org_a_runtime_errors';
const ORG_B = 'org_b_runtime_errors';

/**
 * One SSE frame, formatted the way the artifact actually sends them.
 * @param data
 */
function sseFrame(data: string): string {
  return `data: ${data}\n\n`;
}

/**
 * A response body that streams the given raw SSE text in one chunk.
 * @param raw
 */
function bodyOf(raw: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(raw);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function seedAgent(orgId: string): Promise<void> {
  await db.insert(agentSchema).values({
    orgId,
    slug: 'sales-assistant',
    name: 'Sales Assistant',
    systemPrompt: 'Be helpful.',
    harnessConfig: {},
  } as never);
}

const savedEnv = { ...process.env };

beforeEach(async () => {
  await db.delete(agentSchema);
  mintBedrockSessionForRuntime.mockReset().mockResolvedValue(null);
  chargeUsage.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await db.delete(agentSchema);
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe('AgentCore Memory actor scoping', () => {
  beforeEach(() => {
    process.env.VOCION_AGENTCORE_MEMORY_ID = 'mem-test';
  });

  /** Captures the `memory` field of the single POST the provider makes. */
  function captureMemoryField(): { memory: () => { sessionId: string; actorId: string } | undefined } {
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      seen.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, body: bodyOf(sseFrame(JSON.stringify({ type: 'done', response: 'ok' }))) };
    }));
    return { memory: () => seen[0]?.memory as { sessionId: string; actorId: string } | undefined };
  }

  it('folds orgId into the actor id, the same way sessionId already does', async () => {
    await seedAgent(ORG_A);
    const captured = captureMemoryField();

    await runAgentOnRuntime({ orgId: ORG_A, agentSlug: 'sales-assistant', message: 'hi', userId: 'user_1', conversationId: 1 });

    expect(captured.memory()?.actorId).toBe('org_a_runtime_errors-user_1');
  });

  it('gives the same user a different actor id in a different org, so their long-term memory cannot collide', async () => {
    await seedAgent(ORG_A);
    await seedAgent(ORG_B);

    const capturedA = captureMemoryField();
    await runAgentOnRuntime({ orgId: ORG_A, agentSlug: 'sales-assistant', message: 'hi', userId: 'user_1', conversationId: 1 });
    const actorForOrgA = capturedA.memory()?.actorId;

    const capturedB = captureMemoryField();
    await runAgentOnRuntime({ orgId: ORG_B, agentSlug: 'sales-assistant', message: 'hi', userId: 'user_1', conversationId: 2 });
    const actorForOrgB = capturedB.memory()?.actorId;

    expect(actorForOrgA).not.toBe(actorForOrgB);
  });

  it('still scopes by org when there is no userId, so unauthenticated runs from different orgs do not collapse onto one shared "system" actor', async () => {
    await seedAgent(ORG_A);
    await seedAgent(ORG_B);

    const capturedA = captureMemoryField();
    await runAgentOnRuntime({ orgId: ORG_A, agentSlug: 'sales-assistant', message: 'hi', conversationId: 1 });
    const actorForOrgA = capturedA.memory()?.actorId;

    const capturedB = captureMemoryField();
    await runAgentOnRuntime({ orgId: ORG_B, agentSlug: 'sales-assistant', message: 'hi', conversationId: 2 });
    const actorForOrgB = capturedB.memory()?.actorId;

    expect(actorForOrgA).toBe('org_a_runtime_errors-system');
    expect(actorForOrgB).toBe('org_b_runtime_errors-system');
  });
});

describe('transport failure', () => {
  it('emits a typed error event AND still rejects, for a network-level fetch failure', async () => {
    await seedAgent(ORG_A);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED: connect failed');
    }));
    const events: AgentEvent[] = [];

    await expect(runAgentOnRuntime({
      orgId: ORG_A,
      agentSlug: 'sales-assistant',
      message: 'hi',
      onEvent: e => events.push(e),
    })).rejects.toThrow(/ECONNREFUSED/);

    expect(events).toContainEqual({ type: 'error', message: expect.stringContaining('ECONNREFUSED') });
  });

  it('emits a typed error event AND still rejects, for a non-2xx response from the artifact', async () => {
    await seedAgent(ORG_A);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      body: null,
      text: async () => 'internal error',
    })));
    const events: AgentEvent[] = [];

    await expect(runAgentOnRuntime({
      orgId: ORG_A,
      agentSlug: 'sales-assistant',
      message: 'hi',
      onEvent: e => events.push(e),
    })).rejects.toThrow(/agent runtime returned 500/);

    expect(events).toContainEqual({ type: 'error', message: expect.stringContaining('500') });
  });
});

describe('budget-charge failure', () => {
  it('is logged, and does not break the turn — the response still comes back', async () => {
    await seedAgent(ORG_A);
    chargeUsage.mockRejectedValue(new Error('budget service unavailable'));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: bodyOf(
        sseFrame(JSON.stringify({ type: 'usage', model: 'claude', inputTokens: 10, outputTokens: 5 }))
        + sseFrame(JSON.stringify({ type: 'done', response: 'here is your answer' })),
      ),
    })));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runAgentOnRuntime({ orgId: ORG_A, agentSlug: 'sales-assistant', message: 'hi' });

    expect(result.response).toBe('here is your answer');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('budget service unavailable'));

    errorSpy.mockRestore();
  });
});

describe('malformed SSE frame', () => {
  it('is logged and skipped, without ending the stream — later frames still land', async () => {
    await seedAgent(ORG_A);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: bodyOf(
        sseFrame('{not valid json')
        + sseFrame(JSON.stringify({ type: 'done', response: 'recovered fine' })),
      ),
    })));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runAgentOnRuntime({ orgId: ORG_A, agentSlug: 'sales-assistant', message: 'hi' });

    expect(result.response).toBe('recovered fine');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed SSE frame'));

    warnSpy.mockRestore();
  });
});
