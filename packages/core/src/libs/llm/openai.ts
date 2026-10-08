import type { LLMClient, LLMOptions, LLMProviderName, LLMResponse } from '@vocion/sdk';
import type OpenAI from 'openai';

/**
 * OpenAI adapter. Wraps the existing `OpenAI` client so plugins can reach
 * the chat.completions API through the generic `LLMClient` shape. The same
 * adapter serves every provider reached through OpenAI's wire format
 * (`./openaiCompatible.ts`); only OpenAI itself takes `max_completion_tokens`,
 * the rest take the older `max_tokens`.
 * @param client - An OpenAI SDK client, pointed at the provider's base URL.
 * @param provider - Which provider it is, for `LLMClient.provider`.
 */
export function openaiClient(client: OpenAI, provider: LLMProviderName = 'openai'): LLMClient {
  return {
    provider,
    async generate(opts: LLMOptions): Promise<LLMResponse> {
      const completion = await client.chat.completions.create({
        model: opts.model,
        messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: opts.temperature,
        ...(provider === 'openai' ? { max_completion_tokens: opts.maxTokens } : { max_tokens: opts.maxTokens }),
        ...(opts.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      });

      const choice = completion.choices[0];
      return {
        content: choice?.message?.content ?? '',
        finishReason: choice?.finish_reason,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
      };
    },
  };
}
