import type Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMOptions, LLMResponse } from '@vocion/sdk';

/**
 * Anthropic adapter. Maps our generic `messages` array onto Anthropic's
 * separate `system` + `messages` shape, forwards token limits, flattens
 * the response back to our `{content, usage, finishReason}` contract.
 *
 * JSON-format hint: Anthropic doesn't have a `response_format` parameter,
 * so we append a system instruction when the caller asks for `json_object`.
 * Plugins that need strict JSON should still validate with Zod on the way out.
 * @param client
 */
export function anthropicClient(client: Anthropic): LLMClient {
  return {
    provider: 'anthropic',
    async generate(opts: LLMOptions): Promise<LLMResponse> {
      const systemMsgs = opts.messages.filter((m): m is { role: 'system'; content: string } => m.role === 'system');
      const chatMsgs = opts.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const jsonHint = opts.responseFormat === 'json_object'
        ? '\n\nRespond with a single valid JSON object. No prose before or after.'
        : '';
      const system = systemMsgs.map(m => m.content).join('\n\n') + jsonHint;

      const response = await client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature,
        system: system.trim() || undefined,
        messages: chatMsgs,
      });

      // Anthropic returns a union of content blocks (text, thinking, tool_use, etc.).
      // Flatten just the text blocks to a single string.
      const content = response.content
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('');

      return {
        content,
        finishReason: response.stop_reason ?? undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
