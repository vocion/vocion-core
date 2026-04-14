/**
 * Pluggable LLM provider interface.
 *
 * Plugin skills declare a `provider` (`openai` | `anthropic` | `vertex` |
 * `azure-openai`); the executor looks up the matching `LLMClient` and
 * injects it into `ctx.llm`. This keeps the plugin API stable regardless
 * of which model host the org picks.
 *
 * Scope for v1: chat completion, optional structured-output. No tool calling
 * yet — tool schemas diverge across providers enough that we want more
 * design before committing to a cross-provider shape. Plugins that need
 * tool calling can still reach for `ctx.openai` directly (kept for
 * back-compat).
 */

export type LLMProviderName = 'openai' | 'anthropic' | 'vertex' | 'azure-openai';

export type LLMMessage
  = | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string };

export type LLMOptions = {
  /** Model id — interpretation is provider-specific (`gpt-4o`, `claude-sonnet-4-5`, etc.). */
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** `text` (default) or `json_object` — hints the provider to emit valid JSON. */
  responseFormat?: 'text' | 'json_object';
};

export type LLMResponse = {
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  finishReason?: string;
};

export type LLMClient = {
  readonly provider: LLMProviderName;
  generate: (opts: LLMOptions) => Promise<LLMResponse>;
};
