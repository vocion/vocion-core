/**
 * The step limit on the deepagents loops, run against a real deepagents graph.
 *
 * The rule worth pinning is that a `recursionLimit` passed on the stream call
 * actually wins. `createDeepAgent` binds its own `recursionLimit: 1e4` onto the
 * graph with `withConfig`, so if the bound value took precedence over the call
 * config, `harness.maxSteps` would be silently ignored on the in-process and
 * runtime loops. Only a real graph can show which one wins, so the model is
 * the only thing faked here.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentManifestSchema } from '@/libs/workspace/schemas';
import { isStepLimitError, stepLimitMessage, stepLimitStreamConfig } from './stepLimit';

/**
 * A chat model that asks for `next_lead` a set number of times, then answers.
 *
 * `toolCallsBeforeAnswer: Infinity` is the runaway loop: a queue that never
 * drains. `bindTools` returns the same instance so the count survives the
 * graph binding tools onto it.
 */
class ScriptedLeadModel extends BaseChatModel {
  callsSoFar = 0;
  toolCallsBeforeAnswer: number;

  constructor(toolCallsBeforeAnswer: number) {
    super({});
    this.toolCallsBeforeAnswer = toolCallsBeforeAnswer;
  }

  _llmType(): string {
    return 'scripted-lead-model';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    this.callsSoFar += 1;
    const message = this.callsSoFar <= this.toolCallsBeforeAnswer
      ? new AIMessage({
          content: '',
          tool_calls: [{ id: `call_${this.callsSoFar}`, name: 'next_lead', args: {} }],
        })
      : new AIMessage({ content: 'All leads briefed.' });
    return { generations: [{ text: '', message }] };
  }
}

/** The queue tool the model keeps calling; always has another lead. */
const nextLeadTool = tool(
  async () => 'lead: Acme Co',
  { name: 'next_lead', description: 'Return the next lead to brief.', schema: z.object({}) },
);

/**
 * Run one turn of a real deepagents graph to the end and report how it ended.
 * @param model - The scripted model driving the turn.
 * @param maxSteps - The agent's `harness.maxSteps`, or undefined for none.
 */
async function runGraphTurn(model: ScriptedLeadModel, maxSteps: number | undefined): Promise<unknown> {
  const graph = createDeepAgent({ model, tools: [nextLeadTool] });
  try {
    const stream = await graph.streamEvents(
      { messages: [{ role: 'user', content: 'Brief every lead.' }] } as never,
      { version: 'v2', ...stepLimitStreamConfig(maxSteps) } as never,
    );
    for await (const _event of stream as AsyncIterable<unknown>) {
      // Drained only to drive the graph; the events themselves are not under test.
    }
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('harness.maxSteps on a real deepagents graph', () => {
  it('stops a model that never stops calling tools at the agent\'s limit', async () => {
    const model = new ScriptedLeadModel(Number.POSITIVE_INFINITY);

    const error = await runGraphTurn(model, 6);

    expect(isStepLimitError(error)).toBe(true);
    // Six graph steps is about three model calls. A loop the limit did not
    // reach would run to deepagents' 10,000 and make hundreds of calls.
    expect(model.callsSoFar).toBeGreaterThan(0);
    expect(model.callsSoFar).toBeLessThanOrEqual(3);
  });

  it('lets a normal three-tool-call turn finish under a modest limit', async () => {
    const model = new ScriptedLeadModel(3);

    const error = await runGraphTurn(model, 50);

    expect(error).toBeUndefined();
    expect(model.callsSoFar).toBe(4);
  });

  it('adds no limit of its own when the agent sets none', async () => {
    // Twenty tool rounds is past LangGraph's own default of 25 steps, so this
    // finishing proves deepagents' 10,000 is still the one in charge.
    const model = new ScriptedLeadModel(20);

    const error = await runGraphTurn(model, undefined);

    expect(error).toBeUndefined();
    expect(model.callsSoFar).toBe(21);
  });
});

describe('stepLimitMessage', () => {
  it('names the limit and the setting the author can change', () => {
    const message = stepLimitMessage(200, 'steps');

    expect(message).toContain('200 steps');
    expect(message).toContain('maxSteps');
    expect(message).not.toContain('Recursion limit');
  });
});

describe('harness.maxSteps in workspace YAML', () => {
  const baseAgent = { slug: 'lead-briefer', name: 'Lead Briefer', systemPrompt: 'x' };

  it('keeps a positive whole number through parsing', () => {
    const parsed = AgentManifestSchema.parse({ ...baseAgent, harness: { maxSteps: 200 } });

    expect(parsed.harness.maxSteps).toBe(200);
  });

  it('leaves maxSteps absent when the author wrote none', () => {
    const parsed = AgentManifestSchema.parse(baseAgent);

    expect(parsed.harness).not.toHaveProperty('maxSteps');
  });

  it.each([0, -5, 12.5])('rejects %s', (maxSteps) => {
    const result = AgentManifestSchema.safeParse({ ...baseAgent, harness: { maxSteps } });

    expect(result.success).toBe(false);
  });
});
