/**
 * What core puts in the invocation payload for the runtime artifact.
 *
 * One field is the subject: `aws`. The artifact has no database and no KMS
 * grant, so a Bedrock call it makes is billed to whoever's credential it can
 * reach — the platform's own execution role, unless core hands it a session
 * minted from the org's stored key. These tests pin that the session is sent
 * when the org has one and genuinely absent when it does not, because the
 * absent case is what makes the artifact fall through to the platform.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const mintBedrockSessionForRuntime = vi.fn();
vi.mock('@/libs/llm/bedrockCredentials', () => ({ mintBedrockSessionForRuntime }));
vi.mock('@/services/agents/harness', () => ({ buildInitialFiles: vi.fn(async () => ({})) }));
vi.mock('@/services/agents/tools/registry', () => ({ buildToolCatalog: vi.fn(() => []) }));
vi.mock('@/services/agents/claims', () => ({ signClaim: vi.fn(() => 'signed-claim') }));
vi.mock('@/services/BudgetService', () => ({ chargeUsage: vi.fn(async () => {}), preflightCheck: vi.fn(async () => ({ ok: true })) }));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentOnRuntime } = await import('./runtime');

const ORG = 'org_runtime_payload';
const SESSION = {
  accessKeyId: 'ASIADDDDDDDDDDDDDDDD',
  secretAccessKey: 'session-secret',
  sessionToken: 'session-token',
  expiresAt: '2026-09-04T18:00:00.000Z',
};

/** Captures the body of the single POST the provider makes. */
function captureInvocation(): { payload: () => Record<string, unknown> } {
  const seen: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    seen.push(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    };
  }));
  return { payload: () => seen[0]! };
}

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: 'sales-assistant',
    name: 'Sales Assistant',
    systemPrompt: 'Be helpful.',
    harnessConfig: { modelProvider: 'bedrock' },
  } as never);
  mintBedrockSessionForRuntime.mockReset();
});

afterEach(async () => {
  await db.delete(agentSchema);
  vi.unstubAllGlobals();
});

describe('runAgentOnRuntime payload', () => {
  it('sends the org\'s minted session so the customer\'s account is billed', async () => {
    mintBedrockSessionForRuntime.mockResolvedValue(SESSION);
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    expect(mintBedrockSessionForRuntime).toHaveBeenCalledWith(ORG);
    expect(captured.payload().aws).toEqual(SESSION);
  });

  it('omits the field entirely when the org stored no key', async () => {
    mintBedrockSessionForRuntime.mockResolvedValue(null);
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    // Absent, not null — the artifact treats "no field" as "use your own chain".
    expect('aws' in captured.payload()).toBe(false);
  });

  it('lets a credential failure surface instead of running on the platform\'s account', async () => {
    mintBedrockSessionForRuntime.mockRejectedValue(new Error('sts:GetSessionToken denied'));
    captureInvocation();

    await expect(runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' }))
      .rejects
      .toThrow(/GetSessionToken/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

/**
 * Re-seed the one agent row with a particular harness block.
 * @param harnessConfig - What to store under `harness_config`.
 */
async function seedHarness(harnessConfig: Record<string, unknown>): Promise<void> {
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: 'sales-assistant',
    name: 'Sales Assistant',
    systemPrompt: 'Be helpful.',
    harnessConfig,
  } as never);
}

describe('runAgentOnRuntime and the prompt-cache switch', () => {
  beforeEach(() => {
    mintBedrockSessionForRuntime.mockResolvedValue(null);
  });

  it('carries an author\'s "do not cache this agent" across to the artifact', async () => {
    // The artifact caches by default, so an agent whose prefix must not be
    // cached is only honoured if this field actually travels. Dropped here,
    // the agent keeps paying the 1.25x write rate on every turn and nothing
    // says so.
    await seedHarness({ modelProvider: 'bedrock', promptCache: false });
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    expect((captured.payload().agent as Record<string, unknown>).promptCache).toBe(false);
  });

  it('leaves the field out when the author said nothing', async () => {
    // Absent means "whatever the artifact's default is", which is on. Sending
    // an explicit value here would freeze today's default into every payload.
    await seedHarness({ modelProvider: 'bedrock' });
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    expect('promptCache' in (captured.payload().agent as Record<string, unknown>)).toBe(false);
  });

  it('carries an explicit "yes, cache this one" too', async () => {
    await seedHarness({ modelProvider: 'bedrock', promptCache: true });
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    expect((captured.payload().agent as Record<string, unknown>).promptCache).toBe(true);
  });
});

describe('runAgentOnRuntime and the step limit', () => {
  beforeEach(() => {
    mintBedrockSessionForRuntime.mockResolvedValue(null);
  });

  it('carries the agent\'s maxSteps to the artifact', async () => {
    // Dropped here, a runtime-hosted agent runs to deepagents' 10,000 steps
    // no matter what its author wrote.
    await seedHarness({ modelProvider: 'bedrock', maxSteps: 200 });
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    expect((captured.payload().agent as Record<string, unknown>).maxSteps).toBe(200);
  });

  it('leaves the field out when the author set none', async () => {
    await seedHarness({ modelProvider: 'bedrock' });
    const captured = captureInvocation();

    await runAgentOnRuntime({ orgId: ORG, agentSlug: 'sales-assistant', message: 'hello' });

    expect('maxSteps' in (captured.payload().agent as Record<string, unknown>)).toBe(false);
  });
});
