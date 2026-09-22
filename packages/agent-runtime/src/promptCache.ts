/**
 * Chat models that ask the vendor to cache the prompt prefix.
 *
 * The runtime artifact's copy of core's `libs/llm/promptCache.ts`. It is a copy
 * rather than an import because this artifact is bundled and deployed on its
 * own and cannot reach into core — the same reason `anthropicOmitsSampling` is
 * duplicated in `model.ts`. Keep the two in step.
 *
 * ## Why
 *
 * The agent loop re-sends the whole conversation on every turn, so a run that
 * fetched a page on turn 2 pays for that page again on every turn after.
 * Measured on a customer ingestion agent (dev mission run 24, 2026-09-09, from
 * CloudWatch AWS/Bedrock metrics): 44 model calls in six minutes, 3.26M input
 * tokens against 20k output tokens, with the fixed prefix — system prompt,
 * mounted playbook, skills, learning rules — re-sent on all 44.
 *
 * On Bedrock a cache read is billed at 10 percent of the input rate AND does
 * not count toward the account's tokens-per-day quota at all
 * (https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html).
 * That second one is why this matters here: that account hit its Sonnet
 * 4.6 daily quota twice in September and ingestion stopped with
 * `ThrottlingException: Too many tokens per day`.
 *
 * ## How
 *
 * Both integrations accept `cache_control` as a per-call option but not as a
 * constructor field, and the agent graph — not this code — makes the call. So
 * the option is injected by a subclass on the way through, and a caller that
 * passes its own `cache_control` still wins.
 *
 * `ChatBedrockConverse` turns the option into Converse `cachePoint` blocks at
 * the end of the tool list, the end of the system blocks and the end of the
 * last message, which is exactly the prefix that repeats between turns.
 *
 * All three entry points are overridden. `_streamChatModelEvents` is the one
 * the agent actually runs — `BaseChatModel.stream()` prefers it — so an
 * override of `_generate` alone would leave caching off in practice.
 *
 * ## What will not cache
 *
 * A prefix shorter than the model's minimum is silently not cached: the call
 * succeeds and `cacheWriteInputTokens` comes back 0. Sonnet 4.6 and Sonnet 5
 * need 1,024 tokens, Haiku 4.5 needs 4,096, Opus 5 needs 512
 * (https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).
 */

import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatModelStreamEvent } from '@langchain/core/language_models/event';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs';
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';

import { ChatBedrockConverse } from '@langchain/aws';

/**
 * How long the vendor should hold the cached prefix.
 *
 * Five minutes is both vendors' default and the right one for an agent turn:
 * the next turn follows within seconds, the TTL restarts on every hit, and a
 * cache entry nobody reads back is a write premium paid for nothing.
 */
export const DEFAULT_CACHE_CONTROL = { type: 'ephemeral', ttl: '5m' } as const;

/**
 * Whether prompt caching may be switched on in this process.
 *
 * `VOCION_PROMPT_CACHE=0` turns it off everywhere — the escape hatch for a
 * vendor-side cache bug, and the way to measure what caching is saving by
 * running the same work without it. Unset means on.
 */
export function promptCacheAllowed(): boolean {
  const raw = (process.env.VOCION_PROMPT_CACHE ?? '').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/**
 * Call options with a cache instruction, unless the caller already said.
 *
 * `'cache_control' in options` rather than a truthiness check, so a caller that
 * explicitly passes `cache_control: undefined` — "no caching on this call" — is
 * obeyed rather than quietly overridden.
 * @param options - The call options the graph handed the model.
 */
export function withCacheControl<T extends object>(options: T): T {
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
    return super._generate(messages, withCacheControl(options), runManager);
  }

  override async* _streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* super._streamResponseChunks(messages, withCacheControl(options), runManager);
  }

  override async* _streamChatModelEvents(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatModelStreamEvent> {
    yield* super._streamChatModelEvents(messages, withCacheControl(options), runManager);
  }
}

/** ChatBedrockConverse that caches the prompt prefix by default. */
export class CachingChatBedrockConverse extends ChatBedrockConverse {
  override _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    return super._generate(messages, withCacheControl(options), runManager);
  }

  override async* _streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* super._streamResponseChunks(messages, withCacheControl(options), runManager);
  }

  override async* _streamChatModelEvents(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatModelStreamEvent> {
    yield* super._streamChatModelEvents(messages, withCacheControl(options), runManager);
  }
}
