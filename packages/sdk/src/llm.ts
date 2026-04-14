/**
 * LLM provider interface — part of the plugin contract so skills can type
 * against `ctx.llm` without depending on core. Core ships concrete
 * implementations (OpenAI, Anthropic, …) that satisfy this shape.
 *
 * Scope: chat completion, optional structured-output. Tool-calling is
 * provider-specific enough that we keep it off the cross-provider surface
 * for now — plugins that need it reach for `ctx.openai` directly.
 */

export type LLMProviderName = 'openai' | 'anthropic' | 'vertex' | 'azure-openai';

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
