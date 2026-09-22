/**
 * LLM provider interface — part of the plugin contract so skills can type
 * against `ctx.llm` without depending on core. Core ships concrete
 * implementations (OpenAI, Anthropic, …) that satisfy this shape.
 *
 * Scope: chat completion, optional structured-output. Tool-calling is
 * provider-specific enough that we keep it off the cross-provider surface
 * for now — plugins that need it reach for `ctx.openai` directly.
 */

/**
 * Every model provider a call site may ask for.
 *
 * `bedrock` is Amazon Bedrock. It is the one entry that is not authenticated by
 * a single pasted API key: the credential is an AWS access key pair (or, on a
 * deployed host, the instance's own IAM role), which is why the `aws` platform
 * in `libs/platforms/registry.ts` carries two fields rather than one.
 */
export type LLMProviderName = 'openai' | 'anthropic' | 'bedrock' | 'vertex' | 'azure-openai';

export type LLMMessage
  = | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string };

export type LLMOptions = {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  /**
   * Ask the provider to cache the system prompt so repeated calls that share
   * it are billed at the cache-read rate instead of the full input rate. On by
   * default where the provider supports it; pass `false` for a prompt that
   * must never sit in a provider's cache.
   *
   * A system prompt below the model's minimum cacheable length is simply not
   * cached — the call still succeeds, and the usage numbers come back zero.
   */
  promptCache?: boolean;
};

export type LLMResponse = {
  content: string;
  usage?: {
    /** Every input token billed, including any served from or written to cache. */
    inputTokens?: number;
    outputTokens?: number;
    /** Input tokens served from the provider's prompt cache, billed at 0.1x. */
    cacheReadTokens?: number;
    /** Input tokens written to the provider's prompt cache, billed at 1.25x. */
    cacheWriteTokens?: number;
  };
  finishReason?: string;
};

export type LLMClient = {
  readonly provider: LLMProviderName;
  generate: (opts: LLMOptions) => Promise<LLMResponse>;
};
