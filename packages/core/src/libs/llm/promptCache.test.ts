import type { ChatAnthropic } from '@langchain/anthropic';
import type { ChatBedrockConverse } from '@langchain/aws';
/**
 * The prompt-cache subclasses, and the switches around them.
 *
 * What these guard, in order of how much it would cost to get wrong:
 *
 * 1. **All three entry points carry the instruction.** `BaseChatModel.stream()`
 *    prefers `_streamChatModelEvents` whenever a chat-model stream handler is
 *    attached, which is exactly what the agent graph does. A version of this
 *    module that overrode only `_generate` and `_streamResponseChunks` looked
 *    right, typechecked, and cached nothing on the one path that matters.
 * 2. **A caller who said something is obeyed** — including the caller who said
 *    `cache_control: undefined`, which means "not on this call" and must not be
 *    quietly refilled with the default.
 * 3. **The kill switch reads as a switch**, so `VOCION_PROMPT_CACHE=0` in an
 *    incident actually turns caching off.
 * 4. **`minimumCacheableTokens` answers for a decorated Bedrock id**, because
 *    the caller almost always holds `us.anthropic.…-v1:0` rather than the plain
 *    model card, and a wrong answer here is a prompt nobody notices is uncached.
 *
 * No network: the vendor methods are replaced with spies, so what is asserted
 * is the options object the vendor layer was handed.
 */
import type { BaseMessage } from '@langchain/core/messages';
import process from 'node:process';
import { HumanMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedThroughPrefix,
  CachingChatAnthropic,
  CachingChatBedrockConverse,
  DEFAULT_CACHE_CONTROL,
  MINIMUM_CACHEABLE_TOKENS,
  minimumCacheableTokens,
  promptCacheAllowed,
  withCacheControl,
} from './promptCache';

/** The three ways a LangChain chat model can be asked to produce a turn. */
const ENTRY_POINTS = ['_generate', '_streamResponseChunks', '_streamChatModelEvents'] as const;
type EntryPoint = typeof ENTRY_POINTS[number];

const MESSAGES: BaseMessage[] = [new HumanMessage('hello')];

/**
 * The prototype in `instance`'s chain that actually owns `method`, skipping the
 * caching subclass itself.
 *
 * Spying needs the object the property lives on: `ChatAnthropic.prototype`
 * inherits all three of these from `ChatAnthropicMessages.prototype`, so a spy
 * installed on the wrong link either throws or is never reached.
 * @param instance - A caching chat model.
 * @param method - The entry point to find.
 */
function vendorPrototypeOf(instance: object, method: EntryPoint): Record<string, unknown> {
  // Start one link up, so the caching subclass's own override is skipped.
  let proto = Object.getPrototypeOf(Object.getPrototypeOf(instance)) as object | null;
  while (proto) {
    if (Object.getOwnPropertyDescriptor(proto, method)) {
      return proto as Record<string, unknown>;
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  throw new Error(`no prototype in the chain owns ${method}`);
}

/**
 * Drive one entry point and hand back the options the vendor layer received.
 *
 * The two streaming entry points are async generators, so they are consumed to
 * completion — a generator that is never pulled from never runs its body, and
 * the assertion would pass against a model that does nothing at all.
 * @param model - The caching chat model under test.
 * @param method - Which entry point to call.
 * @param options - The call options a caller would pass.
 */
async function optionsSeenByVendor(
  model: ChatAnthropic | ChatBedrockConverse,
  method: EntryPoint,
  options: object,
): Promise<Record<string, unknown>> {
  const proto = vendorPrototypeOf(model, method);
  const seen: Record<string, unknown>[] = [];
  const generate = (_messages: BaseMessage[], opts: Record<string, unknown>) => {
    seen.push(opts);
    return Promise.resolve({ generations: [] });
  };
  const stream = async function* (_messages: BaseMessage[], opts: Record<string, unknown>) {
    seen.push(opts);
  };
  // Cast through a plain record: `proto` is typed as the vendor prototype, and
  // vi.spyOn narrows its key type to the methods it can see on that type.
  const spy = vi.spyOn(proto as Record<string, () => unknown>, method).mockImplementation(
    (method === '_generate' ? generate : stream) as unknown as () => unknown,
  );
  try {
    const call = (model as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
    const result = call!.call(model, MESSAGES, options);
    if (method === '_generate') {
      await result;
    } else {
      for await (const _chunk of result as AsyncGenerator<unknown>) {
        // Drained, so the generator body actually runs.
      }
    }
  } finally {
    spy.mockRestore();
  }
  const [first] = seen;
  if (!first) {
    throw new Error(`${method} never reached the vendor implementation`);
  }
  return first;
}

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'not-a-real-key';
  process.env.AWS_REGION = 'us-east-1';
  delete process.env.VOCION_PROMPT_CACHE;
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe('withCacheControl', () => {
  it('fills in the five-minute ephemeral instruction when the caller said nothing', () => {
    expect(withCacheControl({ temperature: 0 })).toEqual({ temperature: 0, cache_control: DEFAULT_CACHE_CONTROL });
  });

  it('leaves a caller who chose their own cache instruction alone', () => {
    const mine = { type: 'ephemeral', ttl: '1h' };

    expect(withCacheControl({ cache_control: mine })).toEqual({ cache_control: mine });
  });

  it('obeys an explicit undefined, which means "no caching on this call"', () => {
    // The distinction a truthiness check would lose: the key is present and
    // deliberately empty, so refilling it would override the caller.
    expect(withCacheControl({ cache_control: undefined })).toEqual({ cache_control: undefined });
  });

  it('does not mutate the options object it was handed', () => {
    const original = { temperature: 0 };
    withCacheControl(original);

    expect(original).toEqual({ temperature: 0 });
  });
});

describe('promptCacheAllowed', () => {
  it('is on when nothing is set', () => {
    expect(promptCacheAllowed()).toBe(true);
  });

  it.each(['0', 'false', 'off', 'FALSE', ' Off '])('is off for VOCION_PROMPT_CACHE=%s', (value) => {
    process.env.VOCION_PROMPT_CACHE = value;

    expect(promptCacheAllowed()).toBe(false);
  });

  it.each(['1', 'true', 'on', ''])('stays on for VOCION_PROMPT_CACHE=%s', (value) => {
    process.env.VOCION_PROMPT_CACHE = value;

    expect(promptCacheAllowed()).toBe(true);
  });
});

describe('cachingChatAnthropic', () => {
  it.each(ENTRY_POINTS)('sends the cache instruction through %s', async (method) => {
    const model = new CachingChatAnthropic({ model: 'claude-sonnet-4-6' });

    const seen = await optionsSeenByVendor(model, method, {});

    expect(seen.cache_control).toEqual(DEFAULT_CACHE_CONTROL);
  });

  it('keeps the caller\'s own instruction on the streaming-events path', async () => {
    const model = new CachingChatAnthropic({ model: 'claude-sonnet-4-6' });
    const mine = { type: 'ephemeral', ttl: '1h' };

    const seen = await optionsSeenByVendor(model, '_streamChatModelEvents', { cache_control: mine });

    expect(seen.cache_control).toEqual(mine);
  });

  it('passes the caller\'s other options through untouched', async () => {
    const model = new CachingChatAnthropic({ model: 'claude-sonnet-4-6' });

    const seen = await optionsSeenByVendor(model, '_generate', { stop: ['DONE'] });

    expect(seen.stop).toEqual(['DONE']);
  });
});

describe('cachingChatBedrockConverse', () => {
  it.each(ENTRY_POINTS)('sends the cache instruction through %s', async (method) => {
    const model = new CachingChatBedrockConverse({ model: 'us.anthropic.claude-sonnet-4-6', region: 'us-east-1' });

    const seen = await optionsSeenByVendor(model, method, {});

    expect(seen.cache_control).toEqual(DEFAULT_CACHE_CONTROL);
  });

  it('obeys a caller who switched caching off for one call', async () => {
    const model = new CachingChatBedrockConverse({ model: 'us.anthropic.claude-sonnet-4-6', region: 'us-east-1' });

    const seen = await optionsSeenByVendor(model, '_streamChatModelEvents', { cache_control: undefined });

    expect(seen.cache_control).toBeUndefined();
  });
});

describe('minimumCacheableTokens', () => {
  it('answers for a fully decorated Bedrock id', () => {
    expect(minimumCacheableTokens('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(4096);
    expect(minimumCacheableTokens('global.anthropic.claude-sonnet-4-6')).toBe(1024);
  });

  it('answers the same for the plain model card', () => {
    expect(minimumCacheableTokens('claude-sonnet-4-6')).toBe(1024);
    expect(minimumCacheableTokens('claude-opus-5')).toBe(512);
  });

  it('falls back from a dated id to its undated card', () => {
    // No `claude-sonnet-4-6-20260115` row exists; the date is stripped rather
    // than answering null, so a dated spelling is not treated as uncacheable.
    expect(minimumCacheableTokens('us.anthropic.claude-sonnet-4-6-20260115-v1:0')).toBe(1024);
  });

  it('is null for a model with no published figure, rather than a guess', () => {
    expect(minimumCacheableTokens('gpt-6-astra')).toBeNull();
    expect(minimumCacheableTokens('amazon.titan-embed-text-v1')).toBeNull();
  });

  it('holds Haiku above Sonnet, which is the trap the classifier role falls into', () => {
    // The classifier role defaults to Haiku. A prefix sized for Sonnet's 1,024
    // silently does not cache there, and the call still succeeds.
    expect(MINIMUM_CACHEABLE_TOKENS['claude-haiku-4-5']).toBeGreaterThan(
      MINIMUM_CACHEABLE_TOKENS['claude-sonnet-4-6']!,
    );
  });
});

describe('cachedThroughPrefix', () => {
  it('puts the Bedrock cache point after the shared prefix and none after the document', async () => {
    const model = new CachingChatBedrockConverse({ model: 'us.anthropic.claude-sonnet-4-6', region: 'us-east-1' });
    const send = vi.fn(async () => ({
      output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      $metadata: {},
    }));
    (model as unknown as { client: { send: typeof send } }).client.send = send;

    const { messages, callOptions } = cachedThroughPrefix(model, 'system prompt', 'shared head', 'this document');
    await model.invoke(messages, callOptions);

    const input = (send.mock.calls[0] as unknown as [{ input: { system: unknown[]; messages: Array<{ content: unknown[] }> } }])[0].input;

    expect(input.messages[0]?.content).toEqual([{ text: 'shared head' }, { cachePoint: { type: 'default' } }, { text: 'this document' }]);
    expect(input.system.at(-1)).toEqual({ cachePoint: { type: 'default' } });
  });

  it('marks the system prompt and the shared prefix for Anthropic, with no request-level instruction', () => {
    const model = new CachingChatAnthropic({ model: 'claude-sonnet-4-6', apiKey: 'test-key' });

    const { messages, callOptions } = cachedThroughPrefix(model, 'system prompt', 'shared head', 'this document');

    expect(messages[0]?.content).toEqual([{ type: 'text', text: 'system prompt', cache_control: DEFAULT_CACHE_CONTROL }]);
    expect(messages[1]?.content).toEqual([
      { type: 'text', text: 'shared head', cache_control: DEFAULT_CACHE_CONTROL },
      { type: 'text', text: 'this document' },
    ]);
    expect('cache_control' in callOptions).toBe(true);
    expect(callOptions.cache_control).toBeUndefined();
  });

  it('gives a model that is not caching one plain human turn', async () => {
    const { ChatBedrockConverse: PlainBedrock } = await import('@langchain/aws');
    const model = new PlainBedrock({ model: 'us.anthropic.claude-sonnet-4-6', region: 'us-east-1' });

    const { messages, callOptions } = cachedThroughPrefix(model, 'system prompt', 'shared head', ' this document');

    expect(messages[1]?.content).toBe('shared head this document');
    expect(callOptions).toEqual({});
  });
});
