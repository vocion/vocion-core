/**
 * Chat models that ask the vendor to cache the prompt prefix.
 *
 * The agent loop re-sends the whole conversation on every turn, and a turn
 * that fetched a web page carries that page again in each later turn. Without
 * a cache the vendor charges full input price for the same bytes over and
 * over: one measured eval case on a 240 KB listing spent 912,786 input tokens
 * across 13 turns, roughly fifteen times the page itself, and two such cases
 * were enough to take an AWS account past its daily Bedrock token quota.
 *
 * Both vendors already accept a cache instruction — `cache_control` as a call
 * option on ChatAnthropic and on ChatBedrockConverse, which turns it into
 * Converse `cachePoint` blocks on the system prompt, the tool list and the
 * last message. Neither one can be set when the model is constructed, and the
 * agent graph, not us, makes the call. So the default is injected here, by a
 * subclass that fills the option in when the caller left it out.
 *
 * A caller that passes its own `cache_control` still wins, including one that
 * passes `undefined` deliberately — see `mergeCacheControl`.
 */

import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatBedrockConverse } from '@langchain/aws';

/**
 * How long the vendor should hold the cached prefix.
 *
 * Five minutes is the default on both vendors and the right one for an agent
 * turn: the next turn of the same run follows within seconds, and a cache
 * entry nobody reads back is a write premium paid for nothing.
 */
export const DEFAULT_CACHE_CONTROL = { type: 'ephemeral', ttl: '5m' } as const;

/**
 * Call options with a cache instruction, unless the caller already said.
 *
 * `'cache_control' in options` rather than a truthiness check, so a caller
 * that explicitly passes `cache_control: undefined` — "no caching on this
 * call" — is obeyed rather than quietly overridden.
 * @param options - The call options the graph handed the model.
 */
function mergeCacheControl<T extends object>(options: T): T {
  if (options && 'cache_control' in options) {
    return options;
  }
  return { ...options, cache_control: DEFAULT_CACHE_CONTROL };
}

/** ChatAnthropic that caches the prompt prefix by default. */
export class CachingChatAnthropic extends ChatAnthropic {
  override _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    return super._generate(messages, mergeCacheControl(options), runManager);
  }

  override async* _streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* super._streamResponseChunks(messages, mergeCacheControl(options), runManager);
  }
}

/** ChatBedrockConverse that caches the prompt prefix by default. */
export class CachingChatBedrockConverse extends ChatBedrockConverse {
  override _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    return super._generate(messages, mergeCacheControl(options), runManager);
  }

  override async* _streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* super._streamResponseChunks(messages, mergeCacheControl(options), runManager);
  }
}
