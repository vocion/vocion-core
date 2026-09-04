import { describe, expect, it, vi } from 'vitest';

// harness.ts reaches the database and the deepagents runtime at import time via
// its own imports. Neither is used by the pure function under test, but both
// have to be satisfiable for the module to load.
vi.mock('@/libs/DB');

const { chatModelOptionsFor } = await import('./harness');

/**
 * Which chat model an agent's harness block asks for.
 *
 * The rule worth pinning is that a bare `model:` is ignored on the local loop.
 * Every `model:` written before `modelProvider` existed holds a Bedrock id
 * authored for the runtime harness, so honouring it unconditionally
 * would hand a Bedrock id to ChatAnthropic whenever a runtime agent fell back
 * to the local loop.
 */

describe('chatModelOptionsFor', () => {
  it('asks for nothing when the harness block is empty', () => {
    expect(chatModelOptionsFor({})).toEqual({});
  });

  it('passes the provider through when the agent names one', () => {
    expect(chatModelOptionsFor({ modelProvider: 'bedrock' })).toEqual({ provider: 'bedrock' });
  });

  it('passes the model alongside a named provider', () => {
    expect(chatModelOptionsFor({
      modelProvider: 'bedrock',
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    })).toEqual({
      provider: 'bedrock',
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
  });

  it('ignores a model with no provider, because it belongs to another harness', () => {
    // Veerio's own agent carries exactly this: a Bedrock id authored for the
    // runtime harness, with no modelProvider. On the local fallback path it
    // must not reach ChatAnthropic.
    expect(chatModelOptionsFor({ model: 'global.anthropic.claude-sonnet-4-6' })).toEqual({});
  });

  it('still passes maxTokens when no provider is named', () => {
    expect(chatModelOptionsFor({ maxTokens: 8192 })).toEqual({ maxTokens: 8192 });
  });

  it('passes all three together', () => {
    expect(chatModelOptionsFor({
      modelProvider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 1024,
    })).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 1024,
    });
  });

  it('omits a zero maxTokens rather than sending a cap of nothing', () => {
    expect(chatModelOptionsFor({ maxTokens: 0 })).toEqual({});
  });

  it('omits an empty model string rather than asking for a nameless model', () => {
    expect(chatModelOptionsFor({ modelProvider: 'bedrock', model: '' })).toEqual({ provider: 'bedrock' });
  });
});
