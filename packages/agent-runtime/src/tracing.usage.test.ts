/**
 * What usage the runtime reports back for one model turn.
 *
 * This is the only route by which a BYOA deployment's token counts reach core:
 * `handleLLMEnd` reads the turn's usage, `onTurnEnd` hands it to the loop, and
 * the loop emits it as a `usage` event that core charges the agent's budget
 * from. Anything this reader misses is spend that is never charged and a cache
 * saving nobody can see.
 *
 * The three shapes it has to read, and why each one exists:
 *
 *   - `usage_metadata` on the message. The only shape every provider fills in.
 *     Bedrock returns NO `llmOutput` at all on a non-streamed generation, so a
 *     reader that looks only at `llmOutput` reports nothing on the exact path
 *     this artifact is deployed for. That is the regression these tests guard.
 *   - `llmOutput.tokenUsage`. LangChain's generic shape, no cache fields.
 *   - `llmOutput.usage`. Anthropic's shape, whose `input_tokens` is the
 *     UNCACHED remainder and has to have the cache counts added back.
 *
 * Langfuse is not configured in these tests, so the adapter degrades to
 * usage-extraction only — which is the half being tested. No network.
 */
import type { LLMResult } from '@langchain/core/outputs';
import type { TurnUsage } from './tracing.js';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { createRuntimeTrace } from './tracing.js';

/**
 * Drive one finished model turn through the adapter and hand back what it
 * reported.
 * @param output - The LLMResult the callback would receive.
 */
async function usageReportedFor(output: LLMResult): Promise<TurnUsage | null> {
  let reported: TurnUsage | null = null;
  const trace = createRuntimeTrace({
    agentSlug: 'usage-test',
    input: { message: 'go' },
    onTurnEnd: (turn) => {
      reported = turn;
    },
  });
  await (trace.handler as unknown as { handleLLMEnd: (o: LLMResult, id: string) => Promise<void> })
    .handleLLMEnd(output, 'run-1');
  return reported;
}

/**
 * An LLMResult carrying a message with LangChain's normalised usage on it and
 * no `llmOutput` — the shape Bedrock actually produces.
 * @param usageMetadata - What to hang under `usage_metadata`.
 */
function bedrockShaped(usageMetadata: Record<string, unknown>): LLMResult {
  const message = new AIMessage({ content: 'answer' });
  (message as unknown as { usage_metadata: unknown }).usage_metadata = usageMetadata;
  return { generations: [[{ text: 'answer', message }]] } as unknown as LLMResult;
}

describe('usage read off the normalised shape', () => {
  it('reports cache read and cache write for a Bedrock turn with no llmOutput', async () => {
    const reported = await usageReportedFor(bedrockShaped({
      input_tokens: 3_184,
      output_tokens: 200,
      input_token_details: { cache_read: 3_163, cache_creation: 0 },
    }));

    expect(reported).toMatchObject({
      inputTokens: 3_184,
      outputTokens: 200,
      cacheReadTokens: 3_163,
      cacheWriteTokens: 0,
    });
  });

  it('reports the cache write on the cold first turn', async () => {
    const reported = await usageReportedFor(bedrockShaped({
      input_tokens: 3_183,
      output_tokens: 200,
      input_token_details: { cache_creation: 3_163 },
    }));

    expect(reported?.cacheWriteTokens).toBe(3_163);
  });

  it('does not invent cache counts for a provider that reports none', async () => {
    const reported = await usageReportedFor(bedrockShaped({ input_tokens: 800, output_tokens: 40 }));

    expect(reported?.cacheReadTokens).toBeUndefined();
    expect(reported?.cacheWriteTokens).toBeUndefined();
  });
});

describe('usage read off llmOutput', () => {
  it('adds the cache counts back into inputTokens on the Anthropic shape', async () => {
    // Anthropic's `input_tokens` is the uncached remainder. Reading it straight
    // through would let core's pricing subtract the cache counts a second time,
    // clamp at zero and undercharge every cached turn.
    const reported = await usageReportedFor({
      generations: [[{ text: 'answer' }]],
      llmOutput: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 21, output_tokens: 7, cache_read_input_tokens: 3_163, cache_creation_input_tokens: 0 },
      },
    } as unknown as LLMResult);

    expect(reported).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 3_184,
      cacheReadTokens: 3_163,
      cacheWriteTokens: 0,
    });
  });

  it('still reads the generic LangChain shape, which carries no cache fields', async () => {
    const reported = await usageReportedFor({
      generations: [[{ text: 'answer' }]],
      llmOutput: { model: 'gpt-6-astra', tokenUsage: { promptTokens: 900, completionTokens: 60 } },
    } as unknown as LLMResult);

    expect(reported).toMatchObject({ inputTokens: 900, outputTokens: 60 });
    expect(reported?.cacheReadTokens).toBeUndefined();
  });

  it('prefers the normalised shape when both are present', async () => {
    // A provider that fills in both must not be read twice, and the normalised
    // one is the shape whose meaning is the same across vendors.
    const message = new AIMessage({ content: 'answer' });
    (message as unknown as { usage_metadata: unknown }).usage_metadata = {
      input_tokens: 5_000,
      output_tokens: 300,
      input_token_details: { cache_read: 4_000 },
    };
    const reported = await usageReportedFor({
      generations: [[{ text: 'answer', message }]],
      llmOutput: { model: 'claude-sonnet-4-6', tokenUsage: { promptTokens: 11, completionTokens: 2 } },
    } as unknown as LLMResult);

    expect(reported).toMatchObject({ inputTokens: 5_000, outputTokens: 300, cacheReadTokens: 4_000 });
  });
});
