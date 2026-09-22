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

      // The system prompt is the part that repeats between calls, so it is
      // sent as a block carrying `cache_control` rather than as a plain
      // string. A prompt below the model's minimum cacheable length is simply
      // not cached — the call succeeds either way — so this is safe to send on
      // every request. See `./promptCache.ts` for the per-model minimums.
      const systemText = system.trim();
      const cachePrompt = opts.promptCache ?? true;
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature,
        system: systemText
          ? (cachePrompt
              ? [{ type: 'text' as const, text: systemText, cache_control: { type: 'ephemeral' as const } }]
              : systemText)
          : undefined,
        messages: chatMsgs,
      });

      // Anthropic returns a union of content blocks (text, thinking, tool_use, etc.).
      // Flatten just the text blocks to a single string.
      const content = response.content
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('');

      // Anthropic reports `input_tokens` as the uncached remainder, with the
      // cached counts alongside it, so they are added back to make
      // `inputTokens` mean the whole input side as it does elsewhere here.
      const cacheReadTokens = response.usage.cache_read_input_tokens ?? undefined;
      const cacheWriteTokens = response.usage.cache_creation_input_tokens ?? undefined;
      return {
        content,
        finishReason: response.stop_reason ?? undefined,
        usage: {
          inputTokens: response.usage.input_tokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
          outputTokens: response.usage.output_tokens,
          cacheReadTokens,
          cacheWriteTokens,
        },
      };
    },
  };
}
