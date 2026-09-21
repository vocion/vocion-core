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
 * Usage as LangChain normalises it onto a model response.
 *
 * `input_token_details.cache_read` is the prompt-cache hit count; providers
 * that do not cache simply omit it.
 */
export type LangChainUsageMetadata = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number };
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
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.input_token_details?.cache_read,
  };
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
