import type OpenAI from 'openai';
import type { LLMClient, LLMOptions, LLMResponse } from './provider';

/**
 * OpenAI adapter. Wraps the existing `OpenAI` client so plugins can reach
 * the chat.completions API through the generic `LLMClient` shape.
 * @param client
 */
export function openaiClient(client: OpenAI): LLMClient {
  return {
    provider: 'openai',
    async generate(opts: LLMOptions): Promise<LLMResponse> {
      const completion = await client.chat.completions.create({
        model: opts.model,
        messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: opts.temperature,
        max_completion_tokens: opts.maxTokens,
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
