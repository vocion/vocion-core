/**
 * Model-card pricing (Phase 7 — agent budgets).
 *
 * USD cents per million tokens. Numbers reflect publicly-advertised
 * list prices as of 2026-05; refresh when providers change theirs.
 * Caller multiplies by `usage.input_tokens` / `usage.output_tokens`
 * and divides by 1e6 to get the cost of one model turn in cents.
 *
 * Cache reads (`cache_read_input_tokens`) are charged at the input
 * rate's cache-hit discount. Anthropic ships a 10x discount on cache
 * reads for prompt-cache-enabled prompts (see `withPromptCache` in
 * libs/llm/langchain.ts).
 */

export type PricingTier = {
  /** USD cents per 1M input tokens. */
  inputCentsPerMillion: number;
  /** USD cents per 1M output tokens. */
  outputCentsPerMillion: number;
  /** USD cents per 1M cache-read input tokens (Anthropic discount). */
  cacheReadCentsPerMillion?: number;
};

const PRICING: Record<string, PricingTier> = {
  // Anthropic
  'claude-opus-4-7': { inputCentsPerMillion: 1500, outputCentsPerMillion: 7500, cacheReadCentsPerMillion: 150 },
  'claude-sonnet-4-6': { inputCentsPerMillion: 300, outputCentsPerMillion: 1500, cacheReadCentsPerMillion: 30 },
  'claude-haiku-4-5-20251001': { inputCentsPerMillion: 100, outputCentsPerMillion: 500, cacheReadCentsPerMillion: 10 },

  // OpenAI
  'gpt-4o': { inputCentsPerMillion: 250, outputCentsPerMillion: 1000 },
  'gpt-4o-mini': { inputCentsPerMillion: 15, outputCentsPerMillion: 60 },
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

/**
 * Cost (in USD cents) for one model turn. Returns 0 if pricing is unknown.
 * @param model
 * @param usage
 */
export function tokenCostCents(model: string, usage: TokenUsage): number {
  const tier = PRICING[model];
  if (!tier) {
    return 0;
  }
  const cacheRead = usage.cacheReadTokens ?? 0;
  const inputBilledAtFullRate = Math.max(0, (usage.inputTokens ?? 0) - cacheRead);
  const input = (inputBilledAtFullRate * tier.inputCentsPerMillion) / 1_000_000;
  const cache = (cacheRead * (tier.cacheReadCentsPerMillion ?? tier.inputCentsPerMillion)) / 1_000_000;
  const output = ((usage.outputTokens ?? 0) * tier.outputCentsPerMillion) / 1_000_000;
  return input + cache + output;
}

/**
 * Sum of input+output tokens (used for the simpler token cap).
 * @param usage
 */
export function totalTokens(usage: TokenUsage): number {
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

export function knownModels(): string[] {
  return Object.keys(PRICING);
}
