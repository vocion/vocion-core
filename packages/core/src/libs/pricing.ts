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
export const PRICING: Readonly<Record<string, Readonly<PricingTier>>> = {
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

  // OpenAI embeddings — list prices from developers.openai.com/api/docs/pricing,
  // read 2026-09-21. Embeddings return no completion, so the output rate is 0
  // and every cent comes off the input side. `text-embedding-3-small` is the
  // default an ingest run uses (see DEFAULT_MODELS in
  // libs/retrieval/embeddingBackend.ts), and ingest is the largest single
  // source of embedding spend, so an unpriced row here is what let a sync run
  // up a four-figure bill under a $50 cap (#279).
  'text-embedding-3-small': { inputCentsPerMillion: 2, outputCentsPerMillion: 0 },
  'text-embedding-3-large': { inputCentsPerMillion: 13, outputCentsPerMillion: 0 },

  // OpenAI image generation. `gpt-image-1` bills per TOKEN, not per image:
  // $5/MTok text input, $10/MTok image input, $40/MTok output, same page and
  // date as above. Only the text-input rate is carried here, because the
  // generate_image tool sends a text prompt and no reference image; an
  // image-to-image call would under-charge by the difference and needs its own
  // row before that path ships.
  'gpt-image-1': { inputCentsPerMillion: 500, outputCentsPerMillion: 4000 },

  // Deliberately NOT priced: `amazon.titan-embed-text-v1`, the Bedrock
  // embedding default. AWS publishes Titan embedding pricing behind a
  // region-and-model picker we could not read a single figure off on
  // 2026-09-21, and a guessed rate is worse than none — an unpriced model
  // charges 0 cents while still charging its tokens, so a token cap keeps
  // working and a cents cap visibly does not. Add the row, with the page and
  // the date, once someone has the number in front of them.
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
 * Cost for one model turn, in MICRO-CENTS — a millionth of a cent. Returns 0
 * if pricing is unknown.
 *
 * This is the exact one, and the one anything that accumulates should use.
 * There is no division in it, by construction: a rate is cents per 1,000,000
 * tokens and a micro-cent is a cent divided by 1,000,000, so the cost of
 * `n` tokens is `n * rate` and nothing else. Every value involved is a whole
 * number, so every step is exact.
 *
 * That matters because the alternative — computing cents by dividing by a
 * million — is a floating-point division whose result usually is not
 * representable, and a budget counter adds one of those up per embedding batch
 * for the life of a period. The error per call is tiny; the reason not to
 * accept it is that nothing here needs to.
 *
 * `Math.round` guards a rate somebody later writes as a fraction. Every rate in
 * the table above is a whole number today, which makes the round a no-op; if
 * one stops being whole, the cost rounds to the nearest micro-cent instead of
 * silently carrying a fraction into an integer column.
 *
 * Ceiling: a turn of 1e9 tokens at the dearest rate here is 7.5e12 micro-cents,
 * comfortably inside the range a JavaScript number holds exactly (9e15). A
 * model priced above roughly 9,000,000 cents per million tokens would need a
 * bigger type — say so here if that ever happens.
 * @param model - Model id as the provider reports it.
 * @param usage - Tokens the provider billed.
 */
export function tokenCostMicroCents(model: string, usage: TokenUsage): number {
  // Exact id first, so a table entry for a full provider id always wins
  // over the alias it would canonicalise to.
  const tier = PRICING[model] ?? PRICING[canonicalModelId(model)];
  if (!tier) {
    return 0;
  }
  const cacheRead = usage.cacheReadTokens ?? 0;
  const inputBilledAtFullRate = Math.max(0, (usage.inputTokens ?? 0) - cacheRead);
  const input = inputBilledAtFullRate * tier.inputCentsPerMillion;
  const cache = cacheRead * (tier.cacheReadCentsPerMillion ?? tier.inputCentsPerMillion);
  const output = (usage.outputTokens ?? 0) * tier.outputCentsPerMillion;
  return Math.round(input + cache + output);
}

/**
 * Cost (in USD cents) for one model turn. Returns 0 if pricing is unknown.
 *
 * A fractional number of cents, for reading and for reporting one run's total.
 * The division to get here is the only floating-point step in pricing, and it
 * is deliberately at the edge: anything that ADDS costs up over time should
 * take {@link tokenCostMicroCents} and stay in whole numbers.
 * @param model - Model id as the provider reports it.
 * @param usage - Tokens the provider billed.
 */
export function tokenCostCents(model: string, usage: TokenUsage): number {
  return tokenCostMicroCents(model, usage) / 1_000_000;
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
