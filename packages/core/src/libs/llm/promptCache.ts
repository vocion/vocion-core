/**
 * Chat models that ask the vendor to cache the prompt prefix.
 *
 * ## Why this exists
 *
 * An agent turn re-sends the whole conversation. A run that fetched a web page
 * on turn 2 carries that page again on turns 3, 4, 5 and every turn after, and
 * without a cache the vendor charges full input price for the same bytes each
 * time. Measured on a customer ingestion agent (dev mission run 24, 2026-09-09,
 * from CloudWatch AWS/Bedrock metrics): 44 model calls in six minutes,
 * 3.26M input tokens against 20k output tokens. The first call carried about
 * 18k tokens of system prompt, mounted playbook, skills and learning rules; the
 * last carried about 93k. Roughly a quarter of that total is one fixed prefix
 * re-sent 44 times, and the rest is conversation history re-sent.
 *
 * Caching that prefix buys two separate things on Bedrock:
 *
 *   1. A cache read is billed at 10 percent of the input price.
 *   2. A cache read does not count against the account's tokens-per-day quota
 *      at all — "CacheReadInputTokenCount don't contribute to this calculation
 *      and are not counted toward your quota"
 *      (https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html).
 *      That is the one that matters most here: that account hit its
 *      Sonnet 4.6 daily quota twice in September and ingestion stopped with
 *      `ThrottlingException: Too many tokens per day`. Cached tokens are
 *      invisible to that quota, so the same work fits in the same day.
 *
 * ## How the instruction reaches the vendor
 *
 * Both vendor integrations already accept a cache instruction, but only as a
 * per-call option, not as a constructor field:
 *
 *   - `ChatAnthropic` forwards `cache_control` as a top-level request field.
 *   - `ChatBedrockConverse` turns `cache_control` into Converse `cachePoint`
 *     blocks in three places — the end of the system blocks, the end of the
 *     tool list, and the end of the last message
 *     (`@langchain/aws/dist/utils/message_inputs.js`,
 *     `applyCachePointsToConversePayload`).
 *
 * The agent graph, not this codebase, makes the model call, so there is no
 * call site of ours to pass the option at. Hence a subclass: it fills the
 * option in on the way through when the caller left it out.
 *
 * Note that this is a DIFFERENT mechanism from the one the raw adapters use.
 * `libs/llm/anthropic.ts` and `libs/llm/bedrock.ts` talk to the vendor SDKs
 * directly and mark their own system block, because they build the request
 * themselves. Here the request is built inside LangChain, so the instruction
 * has to travel as the call option LangChain knows how to place. Both are
 * correct for their path; do not "fix" one to match the other.
 *
 * All three entry points are overridden. `_streamChatModelEvents` is easy to
 * miss and is the one the agent actually runs — `BaseChatModel.stream()` picks
 * it over `_streamResponseChunks` whenever the caller attached a chat-model
 * stream handler — so overriding only `_generate` and `_streamResponseChunks`
 * leaves caching quietly off on the hot path.
 *
 * ## What is NOT cached, and why the numbers can still read zero
 *
 * A prefix below the model's minimum cacheable length is silently not cached:
 * the request succeeds, and `cacheWriteInputTokens` comes back 0. The minimums
 * are 1,024 tokens for Sonnet 4.5 and 4.6 and 4,096 tokens for Haiku 4.5
 * (https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).
 * The `classifier` role defaults to Haiku, so a short classifier prompt will
 * not cache no matter what this module asks for. That is a property of the
 * prompt, not a bug here.
 *
 * A cache write costs more than a plain input token (1.25x on both vendors), so
 * a prefix that is written and never read back is a small loss. Everything this
 * default is turned on for — agent turns, eval cases, repeated one-shot
 * extraction against one system prompt — reads the prefix back within seconds.
 */

import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatModelStreamEvent } from '@langchain/core/language_models/event';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs';
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';

import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/**
 * How long the vendor should hold the cached prefix.
 *
 * Five minutes is the default on both vendors and the right one for an agent
 * turn: the next turn of the same run follows within seconds, and a cache entry
 * nobody reads back is a write premium paid for nothing. The one-hour TTL costs
 * twice as much to write and only pays off for a prefix reused across separate
 * runs, which is not a shape we have yet.
 */
export const DEFAULT_CACHE_CONTROL = { type: 'ephemeral', ttl: '5m' } as const;

/**
 * Whether prompt caching is allowed to be switched on at all in this process.
 *
 * `VOCION_PROMPT_CACHE=0` (or `false`) turns it off everywhere — the escape
 * hatch for a vendor-side cache bug, or for measuring what caching is actually
 * saving by running the same work with it off. Unset means on.
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

/**
 * A system prompt and a human turn whose `prefix` repeats on every call, with
 * the cache point placed right after that prefix.
 *
 * The caching classes above put their point at the end of the last message.
 * For a prompt whose head repeats and whose tail does not, that writes the
 * tail to the cache on every call and never reads it back. Marking the shared
 * head instead reads it back and leaves the tail at the plain input rate. Only
 * the caching classes get marks, so `VOCION_PROMPT_CACHE=0` and
 * `promptCache: false` still mean no caching.
 * @param model - The model the messages are for.
 * @param system - The system prompt.
 * @param prefix - The opening of the human turn that every call repeats.
 * @param rest - The remainder of the human turn.
 */
export function cachedThroughPrefix(
  model: BaseChatModel,
  system: string,
  prefix: string,
  rest: string,
): { messages: BaseMessage[]; callOptions: Record<string, unknown> } {
  if (model instanceof CachingChatBedrockConverse) {
    return {
      messages: [
        new SystemMessage(system),
        new HumanMessage({ content: [{ type: 'text', text: prefix }, { cachePoint: { type: 'default' } }, { type: 'text', text: rest }] as never }),
      ],
      callOptions: {},
    };
  }
  if (model instanceof CachingChatAnthropic) {
    return {
      messages: [
        new SystemMessage({ content: [{ type: 'text', text: system, cache_control: DEFAULT_CACHE_CONTROL }] as never }),
        new HumanMessage({ content: [{ type: 'text', text: prefix, cache_control: DEFAULT_CACHE_CONTROL }, { type: 'text', text: rest }] as never }),
      ],
      // No request-level instruction: it would add a breakpoint at the end.
      callOptions: { cache_control: undefined },
    };
  }
  return { messages: [new SystemMessage(system), new HumanMessage(prefix + rest)], callOptions: {} };
}

/**
 * The smallest prompt prefix each model will cache, in tokens.
 *
 * A `cachePoint` placed before this many tokens is not an error: the request
 * succeeds and simply does not cache, with `cacheWriteInputTokens` back as 0.
 * That silence is why the numbers are written down here rather than left to be
 * rediscovered from a run that looks like it worked.
 *
 * Figures from AWS's prompt-caching page and Anthropic's, both read
 * 2026-09-22. The two agree except on Opus 4.7, which AWS lists at 4,096 and
 * Anthropic at 2,048 — the larger is used, so a prefix judged cacheable here is
 * cacheable on either transport.
 *
 * https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
export const MINIMUM_CACHEABLE_TOKENS: Readonly<Record<string, number>> = {
  'claude-fable-5-1': 512,
  'claude-fable-5': 512,
  'claude-mythos-5-1': 512,
  'claude-mythos-5': 512,
  'claude-opus-5': 512,
  'claude-opus-4-8': 1024,
  'claude-opus-4-7': 4096,
  'claude-opus-4-6': 4096,
  'claude-opus-4-5': 4096,
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-sonnet-4-5': 1024,
  'claude-haiku-4-5': 4096,
  'claude-haiku-4-5-20251001': 4096,
};

/**
 * The smallest prompt prefix this model will cache, or null when the model is
 * not one we have a published figure for.
 *
 * Takes a provider-shaped id — `us.anthropic.claude-haiku-4-5-20251001-v1:0`
 * and `claude-haiku-4-5` are the same model card and give the same answer —
 * because the caller usually has the decorated Bedrock spelling in hand.
 * @param model - Model id as the provider spells it.
 */
export function minimumCacheableTokens(model: string): number | null {
  const bare = model
    .replace(/^(?:us|eu|apac|global)\./, '')
    .replace(/^anthropic\./, '')
    .replace(/-v\d+:\d+$/, '');
  return MINIMUM_CACHEABLE_TOKENS[bare] ?? MINIMUM_CACHEABLE_TOKENS[bare.replace(/-\d{8}$/, '')] ?? null;
}
