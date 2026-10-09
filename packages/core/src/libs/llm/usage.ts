/**
 * Read the token usage off a LangChain model response.
 *
 * Every provider reports usage differently — Anthropic on
 * `response_metadata.usage`, OpenAI on `response.usage` — and the LangChain
 * wrapper normalises all of them onto `usage_metadata` on the message. Nine
 * call sites had each written their own cast of that shape, which was fine
 * while usage only fed a trace and became a problem the moment it also fed a
 * budget: a site that spelled the cast slightly differently charged nothing and
 * said nothing.
 *
 * Both shapes come out of one read here — the Langfuse `usageDetails` spelling
 * and the `TokenUsage` that `libs/pricing` prices — so a call site records the
 * trace and charges the budget from the same numbers.
 */

import type { TokenUsage } from '@/libs/pricing';

/**
 * Where a turn's one-hour cache writes are reported on the response.
 *
 * A one-hour write is priced at 2x input and a five-minute one at 1.25x, and
 * LangChain's usage snapshot folds the two into one `cache_creation` count.
 * Anthropic's own `message_start` event splits them
 * (`usage.cache_creation.ephemeral_1h_input_tokens`); the caching model
 * (`libs/llm/promptCache.ts`) taps the raw stream for that number and stamps it on the finished message's
 * `response_metadata` under this key, which `oneHourCacheWritesOf` below reads
 * so the budget charges the write at its real price.
 */
export const ONE_HOUR_CACHE_WRITE_KEY = 'cache_creation_1h_input_tokens';

/**
 * Usage as LangChain normalises it onto a model response.
 *
 * `input_token_details.cache_read` is the prompt-cache hit count and
 * `cache_creation` the write count; providers that do not cache simply omit
 * them. `input_tokens` is the whole input side with both of those already
 * inside it — LangChain's Bedrock adapter adds them back onto the uncached
 * remainder Converse reports, so the number here means the same thing on both
 * vendors.
 */
export type LangChainUsageMetadata = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number; cache_creation?: number };
};

/**
 * The usage a model response reports, or null when it reported none.
 *
 * Null rather than zeroes, because "the provider told us nothing" and "the call
 * cost nothing" are different facts and only the second one should ever charge
 * a budget zero and mean it.
 * @param response - Whatever `model.invoke()` returned.
 */
export function usageMetadataOf(response: unknown): LangChainUsageMetadata | null {
  const carrier = response as { usage_metadata?: LangChainUsageMetadata } | null | undefined;
  return carrier?.usage_metadata ?? null;
}

/**
 * The same usage in the shape `libs/pricing` and `BudgetService` take.
 * @param response - Whatever `model.invoke()` returned.
 */
export function tokenUsageOf(response: unknown): TokenUsage | null {
  const usage = usageMetadataOf(response);
  if (!usage) {
    return null;
  }
  const oneHour = oneHourCacheWritesOf(response);
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.input_token_details?.cache_read,
    cacheWriteTokens: usage.input_token_details?.cache_creation,
    ...(oneHour > 0 ? { cacheWrite1hTokens: oneHour } : {}),
  };
}

/**
 * How many of a response's cache writes were one-hour writes, priced at 2x
 * input rather than 1.25x. Zero when the response says nothing.
 *
 * Two places carry it. The agent's streaming path (`_streamChatModelEvents`)
 * gets it stamped under `ONE_HOUR_CACHE_WRITE_KEY` by the caching model,
 * because LangChain's own usage snapshot folds both TTLs into one count. The
 * older chunk path and a non-streamed call keep Anthropic's raw usage on
 * `response_metadata.usage`, with the split under `cache_creation`.
 * @param response - Whatever `model.invoke()` or a stream returned.
 */
export function oneHourCacheWritesOf(response: unknown): number {
  const metadata = (response as { response_metadata?: Record<string, unknown> } | null | undefined)?.response_metadata;
  if (!metadata) {
    return 0;
  }
  const stamped = metadata[ONE_HOUR_CACHE_WRITE_KEY];
  if (typeof stamped === 'number' && stamped > 0) {
    return stamped;
  }
  const raw = (metadata.usage as { cache_creation?: { ephemeral_1h_input_tokens?: unknown } | null } | undefined)?.cache_creation?.ephemeral_1h_input_tokens;
  return typeof raw === 'number' && raw > 0 ? raw : 0;
}

/**
 * The model id a response says it came from, or null when it did not say.
 *
 * Providers stamp this on `response_metadata` under their own key — Anthropic
 * and OpenAI both use `model_name` through the LangChain wrapper, Bedrock
 * reports `model_id`. Worth reading rather than assuming the role's configured
 * default, because a model can be injected for one call (the model-upgrade
 * test hands the judge a candidate model) or pinned per org, and pricing the
 * call as the default would charge the wrong rate without anything saying so.
 * @param response - Whatever `model.invoke()` returned.
 */
export function modelIdOf(response: unknown): string | null {
  const metadata = (response as { response_metadata?: Record<string, unknown> } | null | undefined)?.response_metadata;
  if (!metadata) {
    return null;
  }
  for (const key of ['model_name', 'model', 'model_id'] as const) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}
