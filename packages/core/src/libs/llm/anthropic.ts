import type Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMOptions, LLMResponse } from '@vocion/sdk';

/**
 * What Anthropic accepts as a request's `system`: nothing, a plain string, or
 * a list of content blocks. Only the block form can carry `cache_control`.
 */
type SystemField
  = | string
    | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
    | undefined;

/**
 * Build the `system` field for one request.
 *
 * Three outcomes, which is why this is not an expression: no system prompt at
 * all sends nothing; caching off sends the plain string the API has always
 * taken; caching on sends the same text as a single block carrying the cache
 * instruction, because a bare string has nowhere to put one.
 *
 * Sending the block form on every request is safe. A prompt below the model's
 * minimum cacheable length is simply not cached and the call succeeds either
 * way — see `./promptCache.ts` for the per-model minimums.
 * @param systemText - The joined system prompt, already trimmed. Empty means there is none.
 * @param cachePrompt - Whether to ask the vendor to cache this prefix.
 */
function systemFieldFor(systemText: string, cachePrompt: boolean): SystemField {
  if (!systemText) {
    return undefined;
  }
  if (!cachePrompt) {
    return systemText;
  }
  return [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
}

/**
 * Anthropic adapter. Maps our generic `messages` array onto Anthropic's
 * separate `system` + `messages` shape, forwards token limits, flattens
 * the response back to our `{content, usage, finishReason}` contract.
 *
 * JSON-format hint: Anthropic doesn't have a `response_format` parameter,
 * so we append a system instruction when the caller asks for `json_object`.
 * Plugins that need strict JSON should still validate with Zod on the way out.
 * @param client - A configured Anthropic SDK client.
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

      // The system prompt is the part that repeats between calls, so it is the
      // prefix worth caching. Caching is on unless the caller said otherwise.
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature,
        system: systemFieldFor(system.trim(), opts.promptCache ?? true),
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
