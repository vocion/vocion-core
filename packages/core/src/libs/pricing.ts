/**
 * Model-card pricing (Phase 7 — agent budgets).
 *
 * USD cents per million tokens. Numbers reflect publicly-advertised
 * list prices as of 2026-05; refresh when providers change theirs.
 * Caller multiplies by `usage.input_tokens` / `usage.output_tokens`
 * and divides by 1e6 to get the cost of one model turn in cents.
 *
 * Prompt caching splits the input side three ways. A cache read is
 * charged at 0.1x the input rate (0.025x on Fable 5.1 and Mythos 5.1);
 * a cache write at 1.25x for the five-minute TTL we send, and 2x for
 * the one-hour one. Figures from Anthropic's prompt-caching page, read
 * 2026-09-22:
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 * See `libs/llm/promptCache.ts` for how the cache is asked for.
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
  /**
   * USD cents per 1M cache-WRITE input tokens. Unset means the vendor's
   * standard five-minute multiplier, 1.25x input — set it only for a model
   * that departs from that.
   */
  cacheWriteCentsPerMillion?: number;
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
  /**
   * Every input token the call was billed for, cached ones included. That is
   * the LangChain convention (`usage_metadata.input_tokens`), and it is NOT
   * what a raw Bedrock Converse response means by `inputTokens` — Bedrock
   * reports only the uncached remainder and expects the caller to add the two
   * cache counts back. Anything reading a raw Converse response has to do that
   * sum before filling this in.
   */
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens served from the vendor's prompt cache, billed at 0.1x. */
  cacheReadTokens?: number;
  /**
   * Input tokens written into the vendor's prompt cache, billed at 1.25x on
   * the five-minute TTL. Counted separately because a cache write costs MORE
   * than a plain input token, so folding it into `inputTokens` would quietly
   * undercharge every first turn of every run.
   */
  cacheWriteTokens?: number;
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
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // `inputTokens` is the whole input side, cached tokens included, so the two
  // cache counts come off it before the rest is charged at the plain rate.
  // Clamped at zero because a provider that reports the three numbers some
  // other way should charge too little rather than a negative amount.
  const inputBilledAtFullRate = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  const input = inputBilledAtFullRate * tier.inputCentsPerMillion;
  const cache = cacheRead * (tier.cacheReadCentsPerMillion ?? tier.inputCentsPerMillion);
  // 1.25x is the published five-minute cache-write multiplier, and five
  // minutes is the TTL `libs/llm/promptCache.ts` asks for. A one-hour TTL
  // would be 2x and needs its own rate before it is used anywhere.
  //
  // It is an Anthropic and Bedrock figure, and it is applied here to any tier
  // that does not name its own rate — OpenAI rows included. That is harmless
  // today only because no OpenAI path fills in `cacheWriteTokens`: OpenAI
  // caches automatically and bills no write premium. A provider that starts
  // reporting writes and does not charge 1.25x for them needs its own
  // `cacheWriteCentsPerMillion` before it is priced through here.
  const write = cacheWrite * (tier.cacheWriteCentsPerMillion ?? tier.inputCentsPerMillion * 1.25);
  const output = (usage.outputTokens ?? 0) * tier.outputCentsPerMillion;
  return Math.round(input + cache + write + output);
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
