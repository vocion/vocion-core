/**
 * Which harness an agent gets when its author named none.
 *
 * Choosing Bedrock as the model vendor now also chooses where the loop runs:
 * `modelProvider: bedrock` defaults to `agentcore-container` — our own loop, in
 * our container, hosted on AgentCore Runtime. Before this, the two settings
 * were unrelated: an installation could be entirely on Bedrock and still run
 * every agent in this process, and every agent had to name the target by hand
 * to reach AWS at all.
 *
 * These tests pin the precedence, because the escape hatches are the part that
 * matters in practice: an explicit target on the agent, the fleet-wide
 * environment override, and the dev-machine kill switch all still win. Both
 * spellings of the target are covered — rows written before the rename carry
 * `provider: local` / `runtime` / `agentcore` and must keep resolving.
 */
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const runAgentOnRuntime = vi.fn(async () => ({ response: 'from the artifact', traceId: 't', toolCalls: [] }));
const runAgentOnAgentCoreHarness = vi.fn(async () => ({ response: 'from the managed harness', traceId: 't', toolCalls: [] }));

vi.mock('@/services/agents/providers/runtime', () => ({ runAgentOnRuntime }));
vi.mock('@/services/agents/providers/agentcore', () => ({ runAgentOnAgentCoreHarness }));
vi.mock('@/services/agents/providers/externalWorker', () => ({
  queueExternalWorkerTurn: vi.fn(async () => ({ response: 'queued for the worker', traceId: '', toolCalls: [] })),
}));

// The in-process loop is the "neither provider ran" signal. Stubbing the
// harness keeps the test off deepagents and off a live model.
vi.mock('@/services/agents/harness', () => ({
  // The turn says which model answers it (`run_meta`); the mock keeps the agent's defaults.
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: (_h: unknown, o?: { model: string; provider?: string; thinking?: string }) => (o ? { ...o } : {}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async () => {
    throw new Error('in-process loop reached');
  }),
}));

vi.mock('@/libs/Langfuse', () => ({ createLangfuseCallback: vi.fn(() => undefined) }));
vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');

const ORG = 'org_harness_default';

type HarnessConfig = Record<string, unknown>;

async function insertAgent(slug: string, harnessConfig: HarnessConfig): Promise<void> {
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    systemPrompt: 'Be helpful.',
    harnessConfig,
  } as never);
}

async function run(slug: string): Promise<string> {
  const result = await runAgentDeep({ orgId: ORG, agentSlug: slug, message: 'hello' });
  return result.response;
}

beforeEach(async () => {
  await db.delete(agentSchema);
  runAgentOnRuntime.mockClear();
  runAgentOnAgentCoreHarness.mockClear();
  delete process.env.VOCION_AGENT_PROVIDER;
  delete process.env.VOCION_DISABLE_RUNTIME;
  delete process.env.VOCION_DISABLE_AGENTCORE;
});

afterEach(async () => {
  await db.delete(agentSchema);
});

describe('harness provider defaults', () => {
  it('sends a bedrock agent to the runtime artifact without an explicit provider', async () => {
    await insertAgent('bedrock-agent', { modelProvider: 'bedrock' });

    await expect(run('bedrock-agent')).resolves.toBe('from the artifact');
    expect(runAgentOnRuntime).toHaveBeenCalledTimes(1);
  });

  it('leaves an anthropic agent in this process', async () => {
    await insertAgent('anthropic-agent', { modelProvider: 'anthropic' });

    await expect(run('anthropic-agent')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('leaves an openai agent in this process', async () => {
    await insertAgent('openai-agent', { modelProvider: 'openai' });

    await expect(run('openai-agent')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('leaves an agent that names no model vendor in this process', async () => {
    await insertAgent('plain-agent', {});

    await expect(run('plain-agent')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('leaves an agent with no harness block at all in this process', async () => {
    await db.insert(agentSchema).values({
      orgId: ORG,
      slug: 'bare-agent',
      name: 'bare-agent',
      systemPrompt: 'Be helpful.',
    } as never);

    await expect(run('bare-agent')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('lets an explicit target on the agent override the default', async () => {
    await insertAgent('pinned-local', { modelProvider: 'bedrock', runsOn: 'in-process' });

    await expect(run('pinned-local')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('lets an explicit managed-harness target on a bedrock agent win', async () => {
    await insertAgent('pinned-managed', { modelProvider: 'bedrock', runsOn: 'aws-managed-harness' });

    await expect(run('pinned-managed')).resolves.toBe('from the managed harness');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('lets the fleet-wide environment override win over the default', async () => {
    process.env.VOCION_AGENT_PROVIDER = 'agentcore';
    await insertAgent('bedrock-agent', { modelProvider: 'bedrock' });

    await expect(run('bedrock-agent')).resolves.toBe('from the managed harness');
  });

  it('honours the dev kill switch, so a bedrock agent still chats with no artifact running', async () => {
    process.env.VOCION_DISABLE_RUNTIME = '1';
    await insertAgent('bedrock-agent', { modelProvider: 'bedrock' });

    await expect(run('bedrock-agent')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('still honours a pre-rename row that named the in-process loop', async () => {
    await insertAgent('legacy-local', { modelProvider: 'bedrock', provider: 'local' });

    await expect(run('legacy-local')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('still honours a pre-rename row that named the container', async () => {
    await insertAgent('legacy-runtime', { provider: 'runtime' });

    await expect(run('legacy-runtime')).resolves.toBe('from the artifact');
  });

  it('still honours a pre-rename row that named the managed harness', async () => {
    await insertAgent('legacy-managed', { provider: 'agentcore' });

    await expect(run('legacy-managed')).resolves.toBe('from the managed harness');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('still honours a pre-rename value in the fleet-wide override', async () => {
    process.env.VOCION_AGENT_PROVIDER = 'runtime';
    await insertAgent('plain-agent', {});

    await expect(run('plain-agent')).resolves.toBe('from the artifact');
  });

  it('accepts a canonical value in the fleet-wide override', async () => {
    process.env.VOCION_AGENT_PROVIDER = 'agentcore-container';
    await insertAgent('plain-agent', {});

    await expect(run('plain-agent')).resolves.toBe('from the artifact');
  });

  it('ignores an unrecognised fleet-wide override rather than failing the turn', async () => {
    process.env.VOCION_AGENT_PROVIDER = 'lambda';
    await insertAgent('plain-agent', {});

    await expect(run('plain-agent')).rejects.toThrow('in-process loop reached');
  });
});

/**
 * `VOCION_DEFAULT_RUNS_ON` moves the agents that said nothing, and only them.
 * The override above moves every agent, including the ones that must stay: an
 * `external-worker` engineer and an agent pinned to AWS's managed harness.
 */
describe('the fleet default', () => {
  afterEach(() => {
    delete process.env.VOCION_DEFAULT_RUNS_ON;
  });

  it('sends an agent that named no target to the container', async () => {
    process.env.VOCION_DEFAULT_RUNS_ON = 'agentcore-container';
    await insertAgent('plain-agent', { modelProvider: 'anthropic', model: 'claude-opus-5' });

    await expect(run('plain-agent')).resolves.toBe('from the artifact');
  });

  it('leaves an external worker where its author put it', async () => {
    process.env.VOCION_DEFAULT_RUNS_ON = 'agentcore-container';
    await insertAgent('task-engineer', { runsOn: 'external-worker' });

    await expect(run('task-engineer')).resolves.toBe('queued for the worker');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('leaves an agent pinned to the managed harness, or to this process, alone', async () => {
    process.env.VOCION_DEFAULT_RUNS_ON = 'agentcore-container';
    await insertAgent('managed', { provider: 'agentcore' });
    await insertAgent('pinned-local', { runsOn: 'in-process' });

    await expect(run('managed')).resolves.toBe('from the managed harness');
    await expect(run('pinned-local')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('is still overridden by the kill switch', async () => {
    process.env.VOCION_DEFAULT_RUNS_ON = 'agentcore-container';
    process.env.VOCION_DISABLE_RUNTIME = '1';
    await insertAgent('plain-agent', {});

    await expect(run('plain-agent')).rejects.toThrow('in-process loop reached');
    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });

  it('refuses to make an external worker or the managed harness the default', async () => {
    await insertAgent('plain-agent', {});
    process.env.VOCION_DEFAULT_RUNS_ON = 'external-worker';

    await expect(run('plain-agent')).rejects.toThrow('in-process loop reached');

    process.env.VOCION_DEFAULT_RUNS_ON = 'aws-managed-harness';

    await expect(run('plain-agent')).rejects.toThrow('in-process loop reached');
  });
});
