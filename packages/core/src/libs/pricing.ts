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
  // Anthropic, Claude 5 generation — first-party list prices as of 2026-06-24.
  // These are the models the Vocion workforce actually runs on
  // (`claude-fable-5-1` board, `claude-opus-5` / `claude-sonnet-5` CEO and
  // workers); until they were listed, every one of those turns priced at 0
  // and budgets never moved. Cache read is 10% of input, except Fable, whose
  // cached-input rate is published separately at $0.25/MTok.
  'claude-fable-5-1': { inputCentsPerMillion: 1000, outputCentsPerMillion: 5000, cacheReadCentsPerMillion: 25 },
  'claude-fable-5': { inputCentsPerMillion: 1000, outputCentsPerMillion: 5000, cacheReadCentsPerMillion: 25 },
  'claude-opus-5': { inputCentsPerMillion: 500, outputCentsPerMillion: 2500, cacheReadCentsPerMillion: 50 },
  'claude-opus-4-8': { inputCentsPerMillion: 500, outputCentsPerMillion: 2500, cacheReadCentsPerMillion: 50 },
  'claude-sonnet-5': { inputCentsPerMillion: 200, outputCentsPerMillion: 1000, cacheReadCentsPerMillion: 20 },
  // Undated alias of the dated Haiku row above — providers report both.
  'claude-haiku-4-5': { inputCentsPerMillion: 100, outputCentsPerMillion: 500, cacheReadCentsPerMillion: 10 },

  // OpenAI
  'gpt-4o': { inputCentsPerMillion: 250, outputCentsPerMillion: 1000 },
  'gpt-4o-mini': { inputCentsPerMillion: 15, outputCentsPerMillion: 60 },
  // OpenAI, GPT-6 / GPT-5.6 generation — list prices from the OpenAI pricing
  // page (standard tier, short context) as of 2026-09-15. OpenAI's "cached
  // input" rate rides in `cacheReadCentsPerMillion`: the field is named for
  // Anthropic's discount, but it is the same slot — a prompt-cache hit billed
  // below the full input rate — and `tokenCostCents` treats it identically.
  // `gpt-5.4-mini` (the workspace-scaffold default) is deliberately NOT here:
  // its price was not on the page we priced from, and an unpriced model costs
  // 0 rather than being guessed.
  'gpt-6-astra': { inputCentsPerMillion: 1000, outputCentsPerMillion: 5000, cacheReadCentsPerMillion: 100 },
  'gpt-5.6-sol': { inputCentsPerMillion: 400, outputCentsPerMillion: 2000, cacheReadCentsPerMillion: 40 },
  'gpt-5.6-terra': { inputCentsPerMillion: 200, outputCentsPerMillion: 1200, cacheReadCentsPerMillion: 20 },
  'gpt-5.6-luna': { inputCentsPerMillion: 20, outputCentsPerMillion: 120, cacheReadCentsPerMillion: 2 },
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
