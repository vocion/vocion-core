import type { ChatAnthropic } from '@langchain/anthropic';
import { describe, expect, it } from 'vitest';
import { buildChatModel, defaultAnthropicMaxTokens } from './langchain';

describe('defaultAnthropicMaxTokens', () => {
  it('gives the Claude 5 family room for a long tool argument; older models keep the library default', () => {
    expect(defaultAnthropicMaxTokens('claude-sonnet-5')).toBe(32_000);
    expect(defaultAnthropicMaxTokens('claude-opus-5-20261001')).toBe(32_000);
    expect(defaultAnthropicMaxTokens('claude-sonnet-4-6')).toBe(16_384);
    expect(defaultAnthropicMaxTokens('claude-haiku-4-5-20251001')).toBe(16_384);
  });
});

describe('a Claude 5 model with thinking off', () => {
  it('keeps the Claude 5 cap instead of the LangChain 4,096 fallback (conversation 349)', () => {
    const model = buildChatModel('main', { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-test', thinking: 'off' }) as ChatAnthropic;

    expect(model.maxTokens).toBe(32_000);
  });

  it('still takes a cap the caller set', () => {
    const model = buildChatModel('main', { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-test', thinking: 'off', maxTokens: 6_000 }) as ChatAnthropic;

    expect(model.maxTokens).toBe(6_000);
  });
});
