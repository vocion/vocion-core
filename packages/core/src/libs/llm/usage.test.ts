/**
 * Reading usage off a model response.
 *
 * `tokenUsageOf` is the one place a LangChain response turns into the
 * `TokenUsage` that pricing, budgets and Langfuse all read. The two cache
 * counts live in `input_token_details`, under names that do not match ours —
 * `cache_read` and `cache_creation` — so a typo here is silent: the cost is
 * simply wrong, in the direction of too cheap, on every turn.
 */
import { describe, expect, it } from 'vitest';
import { tokenUsageOf } from './usage';

/**
 * A model response shaped the way LangChain normalises one.
 * @param usageMetadata - What to put under `usage_metadata`.
 */
function responseWith(usageMetadata: unknown): unknown {
  return { usage_metadata: usageMetadata };
}

describe('tokenUsageOf', () => {
  it('reads the cache read and cache write counts', () => {
    const usage = tokenUsageOf(responseWith({
      input_tokens: 5_000,
      output_tokens: 300,
      input_token_details: { cache_read: 3_163, cache_creation: 1_024 },
    }));

    expect(usage).toEqual({
      inputTokens: 5_000,
      outputTokens: 300,
      cacheReadTokens: 3_163,
      cacheWriteTokens: 1_024,
    });
  });

  it('leaves the cache counts undefined for a provider that does not cache', () => {
    const usage = tokenUsageOf(responseWith({ input_tokens: 800, output_tokens: 40 }));

    expect(usage).toEqual({
      inputTokens: 800,
      outputTokens: 40,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    });
  });

  it('reads a cold turn — a write with no read — rather than dropping it', () => {
    // The first turn of every run looks like this, and it is the turn that was
    // undercharged while `cache_creation` was not read.
    const usage = tokenUsageOf(responseWith({
      input_tokens: 3_183,
      output_tokens: 200,
      input_token_details: { cache_creation: 3_163 },
    }));

    expect(usage?.cacheWriteTokens).toBe(3_163);
    expect(usage?.cacheReadTokens).toBeUndefined();
  });

  it('is null for a response carrying no usage at all', () => {
    expect(tokenUsageOf({})).toBeNull();
    expect(tokenUsageOf(null)).toBeNull();
  });
});
