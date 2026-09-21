/**
 * What the caching models actually send.
 *
 * The bug these guard against is silent and expensive: a cache instruction
 * that never reaches the vendor looks exactly like one that did, and the only
 * evidence is a bill. So each test reads the options the base class was
 * called with, rather than trusting that the subclass exists.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { ChatBedrockConverse } from '@langchain/aws';
import { describe, expect, it, vi } from 'vitest';
import { CachingChatAnthropic, CachingChatBedrockConverse, DEFAULT_CACHE_CONTROL } from './promptCache';

describe('CachingChatBedrockConverse', () => {
  it('asks Bedrock to cache the prefix when the graph said nothing about it', async () => {
    const generate = vi.spyOn(ChatBedrockConverse.prototype, '_generate').mockResolvedValue({ generations: [] });
    const model = new CachingChatBedrockConverse({ model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', region: 'us-west-2' });

    await model._generate([], {} as never);

    expect(generate).toHaveBeenCalledWith([], expect.objectContaining({ cache_control: DEFAULT_CACHE_CONTROL }), undefined);

    generate.mockRestore();
  });

  it('leaves a caller who named their own cache setting alone', async () => {
    const generate = vi.spyOn(ChatBedrockConverse.prototype, '_generate').mockResolvedValue({ generations: [] });
    const model = new CachingChatBedrockConverse({ model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', region: 'us-west-2' });

    await model._generate([], { cache_control: { type: 'ephemeral', ttl: '1h' } } as never);

    expect(generate).toHaveBeenCalledWith([], expect.objectContaining({ cache_control: { type: 'ephemeral', ttl: '1h' } }), undefined);

    generate.mockRestore();
  });

  it('obeys a caller who turned caching off for one call', async () => {
    // `cache_control: undefined` is how a call site says "not this one". A
    // truthiness check would have read that as "unset" and cached anyway.
    const generate = vi.spyOn(ChatBedrockConverse.prototype, '_generate').mockResolvedValue({ generations: [] });
    const model = new CachingChatBedrockConverse({ model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', region: 'us-west-2' });

    await model._generate([], { cache_control: undefined } as never);

    expect(generate.mock.calls[0]?.[1]).toEqual({ cache_control: undefined });

    generate.mockRestore();
  });
});

describe('CachingChatAnthropic', () => {
  it('asks Anthropic to cache the prefix too', async () => {
    const generate = vi.spyOn(ChatAnthropic.prototype, '_generate').mockResolvedValue({ generations: [] });
    const model = new CachingChatAnthropic({ model: 'claude-sonnet-4-6', apiKey: 'test-key-not-real' });

    await model._generate([], {} as never);

    expect(generate).toHaveBeenCalledWith([], expect.objectContaining({ cache_control: DEFAULT_CACHE_CONTROL }), undefined);

    generate.mockRestore();
  });
});
