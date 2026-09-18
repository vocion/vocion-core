import { describe, expect, it } from 'vitest';
import { defaultAnthropicMaxTokens } from './langchain';

describe('defaultAnthropicMaxTokens', () => {
  it('gives the Claude 5 family room for a long tool argument; older models keep the library default', () => {
    expect(defaultAnthropicMaxTokens('claude-sonnet-5')).toBe(32_000);
    expect(defaultAnthropicMaxTokens('claude-opus-5-20261001')).toBe(32_000);
    expect(defaultAnthropicMaxTokens('claude-sonnet-4-6')).toBe(16_384);
    expect(defaultAnthropicMaxTokens('claude-haiku-4-5-20251001')).toBe(16_384);
  });
});
