/**
 * What `createLangfuseCallback` reports for one finished model turn.
 *
 * `onTurnEnd` is how a turn's tokens reach `chargeUsage`, so this reader is
 * the difference between a run that is charged and one that is free. It has
 * three shapes to read and they do not agree with each other:
 *
 *   - The message's own `usage_metadata`. The only shape every provider fills
 *     in, and the one whose `input_tokens` already includes both cache counts.
 *     Bedrock returns NO `llmOutput` on a non-streamed generation, so a reader
 *     that looks only at `llmOutput` left every Bedrock turn untraced and
 *     uncharged — that is the regression this file exists for.
 *   - `llmOutput.tokenUsage`, LangChain's generic shape, no cache fields.
 *   - `llmOutput.usage`, Anthropic's shape, whose `input_tokens` is the
 *     UNCACHED remainder and needs the cache counts added back. Reading it raw
 *     while also reporting `cacheReadTokens` makes `tokenCostMicroCents`
 *     subtract the cached tokens a second time, clamp at zero, and undercharge.
 *
 * Langfuse is not configured here, so the callback degrades to the usage half.
 * Nothing is sent anywhere.
 */
import type { LLMResult } from '@langchain/core/outputs';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { createLangfuseCallback } from './Langfuse';
import { tokenCostMicroCents } from './pricing';

type ReportedUsage = {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/**
 * Drive one finished model turn through the callback and hand back what it
 * reported to `onTurnEnd`.
 * @param output - The LLMResult the callback would receive.
 */
async function usageReportedFor(output: LLMResult): Promise<ReportedUsage | null> {
  let reported: ReportedUsage | null = null;
  const { handler } = createLangfuseCallback({
    feature: 'agent.chat',
    slug: 'usage-test',
    orgId: 'org_usage_test',
    userId: 'user_usage_test',
    onTurnEnd: (turn) => {
      reported = turn;
    },
  });
  // The turn has to be started before it can end: `handleLLMEnd` reports usage
  // for a generation it opened, and a stray end with no start is not a turn.
  const adapter = handler as unknown as {
    handleChatModelStart: (llm: unknown, messages: unknown, id: string) => Promise<void>;
    handleLLMEnd: (o: LLMResult, id: string) => Promise<void>;
  };
  await adapter.handleChatModelStart({ id: ['ChatBedrockConverse'] }, [[new AIMessage({ content: 'go' })]], 'run-1');
  await adapter.handleLLMEnd(output, 'run-1');
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

describe('onTurnEnd on the normalised shape', () => {
  it('reports a Bedrock turn that carries no llmOutput at all', async () => {
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

  it('reports the cache write on a cold first turn', async () => {
    const reported = await usageReportedFor(bedrockShaped({
      input_tokens: 3_183,
      output_tokens: 200,
      input_token_details: { cache_creation: 3_163 },
    }));

    expect(reported?.cacheWriteTokens).toBe(3_163);
  });
});

describe('onTurnEnd on the llmOutput fallbacks', () => {
  it('adds the cache counts back into inputTokens on the Anthropic shape', async () => {
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
    });
  });

  it('never reports an inputTokens smaller than the cached tokens it also reports', async () => {
    // The shape of the bug: `inputTokens` below `cacheReadTokens` means the
    // number is the uncached remainder, and pricing will subtract the cache a
    // second time.
    const reported = await usageReportedFor({
      generations: [[{ text: 'answer' }]],
      llmOutput: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 21, output_tokens: 7, cache_read_input_tokens: 3_163 },
      },
    } as unknown as LLMResult);

    expect(reported!.inputTokens!).toBeGreaterThanOrEqual(reported!.cacheReadTokens!);
  });

  it('still reads the generic LangChain shape, which has no cache fields', async () => {
    const reported = await usageReportedFor({
      generations: [[{ text: 'answer' }]],
      llmOutput: { model: 'gpt-6-astra', tokenUsage: { promptTokens: 900, completionTokens: 60 } },
    } as unknown as LLMResult);

    expect(reported).toMatchObject({ inputTokens: 900, outputTokens: 60 });
    expect(reported?.cacheReadTokens).toBeUndefined();
  });

  it('prefers the normalised shape when both are present', async () => {
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

describe('onTurnEnd names the model a Bedrock turn ran on', () => {
  // Bedrock names its model only in the run metadata when the call starts and
  // sends no `llmOutput` at the end. Reported as "unknown", the turn priced at
  // zero, so no Bedrock agent's spend ever counted against its budget (#272).
  it('carries the model id from the start of the call to the usage it reports', async () => {
    const BEDROCK_HAIKU = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    let reported: ReportedUsage | null = null;
    const { handler } = createLangfuseCallback({
      feature: 'agent.chat',
      slug: 'usage-test',
      orgId: 'org_usage_test',
      userId: 'user_usage_test',
      onTurnEnd: (turn) => {
        reported = turn;
      },
    });
    const adapter = handler as unknown as {
      handleChatModelStart: (llm: unknown, messages: unknown, id: string, parent?: string, extra?: unknown, tags?: string[], metadata?: Record<string, unknown>) => Promise<void>;
      handleLLMEnd: (o: LLMResult, id: string) => Promise<void>;
    };

    await adapter.handleChatModelStart({ id: ['ChatBedrockConverse'] }, [[new AIMessage({ content: 'go' })]], 'run-b', undefined, { invocation_params: {} }, [], { ls_model_name: BEDROCK_HAIKU });
    await adapter.handleLLMEnd(bedrockShaped({ input_tokens: 10_000, output_tokens: 1_000 }), 'run-b');

    expect(reported).toMatchObject({ model: BEDROCK_HAIKU });
    // $1/M in + $5/M out on Haiku 4.5: 1¢ + 0.5¢.
    expect(tokenCostMicroCents(reported!.model, { inputTokens: 10_000, outputTokens: 1_000 })).toBe(1_500_000);
  });
});
