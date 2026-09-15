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
 *
 * Table keys are plain model names. Bedrock reports the same model
 * cards under decorated ids (`us.anthropic.claude-sonnet-4-6`), so
 * lookups fall back to `canonicalModelId()`; see it for why the
 * decoration carries no price of its own.
 */

export type PricingTier = {
  /** USD cents per 1M input tokens. */
  inputCentsPerMillion: number;
  /** USD cents per 1M output tokens. */
  outputCentsPerMillion: number;
  /** USD cents per 1M cache-read input tokens (Anthropic discount). */
  cacheReadCentsPerMillion?: number;
};

/**
 * The price list. Exported read-only so callers that need the whole
 * table (`scripts/langfuse-bootstrap.ts` registers every tier with
 * Langfuse) read it here instead of keeping a copy that silently
 * drifts; read-only because this module stays the single source of
 * truth for what a model costs.
 */
export const PRICING: Readonly<Record<string, PricingTier>> = {
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
 * Strip the routing decoration a provider puts around a model id, so a
 * decorated id prices off the plain model card it points at.
 *
 * Bedrock ids are an inference-profile prefix (`us.`, `eu.`, `apac.`,
 * `global.`), a vendor prefix (`anthropic.`) and a version suffix
 * (`-v1:0`) around the model name: `us.anthropic.claude-haiku-4-5-
 * 20251001-v1:0` is the same model card, at the same list price, as
 * `claude-haiku-4-5-20251001`. Ids with none of that decoration come
 * back unchanged (`gpt-4o`, `amazon.titan-embed-text-v1`), so a model
 * that is not in the table stays unpriced rather than being mapped
 * onto someone else's price by accident.
 * @param id - Model id as the provider reports it.
 */
export function canonicalModelId(id: string): string {
  return id
    .replace(/^(?:us|eu|apac|global)\./, '')
    .replace(/^anthropic\./, '')
    .replace(/-v\d+:\d+$/, '');
}

/**
 * Langfuse `matchPattern` for one model id: a case-insensitive exact
 * match. Lives with the table it quotes; `scripts/langfuse-bootstrap.ts`
 * is the caller. The id is regex-escaped because model ids contain `.`
 * (`us.anthropic.claude-sonnet-4-6`) and an unescaped `.` would match
 * any character, so one row could price a neighbouring model too.
 * `(?i)` is Langfuse's own flag syntax, not JavaScript's.
 * @param modelName - A key of `PRICING`.
 */
export function modelMatchPattern(modelName: string): string {
  return `(?i)^${modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * Cost (in USD cents) for one model turn. Returns 0 if pricing is unknown.
 * @param model
 * @param usage
 */
export function tokenCostCents(model: string, usage: TokenUsage): number {
  // Exact id first, so a table entry for a full provider id always wins
  // over the alias it would canonicalise to.
  const tier = PRICING[model] ?? PRICING[canonicalModelId(model)];
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
