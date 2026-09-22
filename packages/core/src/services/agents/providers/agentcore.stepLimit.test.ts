/**
 * Where an AWS-managed-harness turn stops when the model keeps calling tools.
 *
 * The rule pinned here is vocion-core#271: the round limit is 12 unless the
 * agent's `harness.maxSteps` says otherwise, then half of it, and running out
 * of rounds with a tool call still pending ends the turn as an error. Before
 * this, the loop fell through to `done` with whatever partial text it had, so
 * a cut-off turn read as a finished answer.
 *
 * The AgentCore data client is replaced with one that streams canned harness
 * events; the agent row lives in the per-file test database.
 */
import type { AgentEvent } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeHarness = vi.fn();

vi.mock('@aws-sdk/client-bedrock-agentcore', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-bedrock-agentcore')>(
    '@aws-sdk/client-bedrock-agentcore',
  );
  return {
    ...actual,
    BedrockAgentCoreClient: class {
      send = invokeHarness;
    },
  };
});

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentOnAgentCoreHarness } = await import('./agentcore');

const ORG = 'org_step_limit';
const HARNESS_ARN = 'arn:aws:bedrock-agentcore:us-east-1:1234:harness/vocion_looper-abc';

/**
 * One harness response in which the model asks for a tool and stops there.
 *
 * The tool name is one this provider does not implement, so the call is
 * answered with "not available" and never reaches search or the database.
 */
async function* toolRequestStream(): AsyncGenerator<Record<string, unknown>> {
  yield { contentBlockStart: { start: { toolUse: { toolUseId: 'tu_1', name: 'lookup_lead' } } } };
  yield { contentBlockDelta: { delta: { toolUse: { input: '{}' } } } };
  yield { contentBlockStop: {} };
  yield { messageStop: { stopReason: 'tool_use' } };
}

/** One harness response in which the model answers and ends its turn. */
async function* answerStream(): AsyncGenerator<Record<string, unknown>> {
  yield { contentBlockDelta: { delta: { text: 'All leads briefed.' } } };
  yield { contentBlockStop: {} };
  yield { messageStop: { stopReason: 'end_turn' } };
}

/** A harness that asks for a tool on every call — the runaway loop. */
function toolRequestResponse(): { stream: AsyncGenerator<Record<string, unknown>> } {
  return { stream: toolRequestStream() };
}

/** A harness call that answers. */
function answerResponse(): { stream: AsyncGenerator<Record<string, unknown>> } {
  return { stream: answerStream() };
}

/**
 * Insert the agent under test with the given harness block.
 * @param harnessConfig - The agent's stored `harness_config`.
 */
async function insertAgent(harnessConfig: Record<string, unknown>): Promise<void> {
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: 'looper',
    name: 'Looper',
    systemPrompt: 'x',
    harnessConfig,
    harnessArn: HARNESS_ARN,
  });
}

/**
 * Run one turn and collect what it emitted, whether it finished or threw.
 */
async function runTurn(): Promise<{ events: AgentEvent[]; error: Error | undefined }> {
  const events: AgentEvent[] = [];
  let error: Error | undefined;
  try {
    await runAgentOnAgentCoreHarness({
      orgId: ORG,
      agentSlug: 'looper',
      message: 'Brief every lead in the queue.',
      onEvent: event => events.push(event),
    });
  } catch (caught) {
    error = caught as Error;
  }
  return { events, error };
}

describe('runAgentOnAgentCoreHarness step limit', () => {
  beforeEach(() => {
    invokeHarness.mockReset();
  });

  afterEach(async () => {
    await db.delete(agentSchema);
  });

  it('stops at 12 rounds and fails the turn when the agent sets no maxSteps', async () => {
    await insertAgent({});
    invokeHarness.mockImplementation(toolRequestResponse);

    const { events, error } = await runTurn();

    expect(invokeHarness).toHaveBeenCalledTimes(12);
    expect(error?.message).toContain('stopped after 12 tool rounds');
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('stops at half of maxSteps when the agent sets one', async () => {
    await insertAgent({ maxSteps: 6 });
    invokeHarness.mockImplementation(toolRequestResponse);

    const { error } = await runTurn();

    expect(invokeHarness).toHaveBeenCalledTimes(3);
    expect(error?.message).toContain('stopped after 3 tool rounds');
    expect(error?.message).toContain('maxSteps');
  });

  it('still allows one round when maxSteps is below two', async () => {
    await insertAgent({ maxSteps: 1 });
    invokeHarness.mockImplementationOnce(answerResponse);

    const { events, error } = await runTurn();

    expect(error).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', response: 'All leads briefed.' }));
  });

  it('finishes normally when the model answers inside the limit', async () => {
    await insertAgent({ maxSteps: 6 });
    invokeHarness
      .mockImplementationOnce(toolRequestResponse)
      .mockImplementationOnce(toolRequestResponse)
      .mockImplementationOnce(answerResponse);

    const { events, error } = await runTurn();

    expect(error).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', response: 'All leads briefed.' }));
    expect(events.some(e => e.type === 'error')).toBe(false);
  });
});
