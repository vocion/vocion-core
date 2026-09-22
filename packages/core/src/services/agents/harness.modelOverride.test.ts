import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { chatModelOptionsWithOverride } = await import('./harness');

/**
 * Which chat model a graph is built with when the caller names one.
 *
 * The model-upgrade test names a model per run. The rule pinned here is that
 * the override wins over the harness block on model and provider, keeps the
 * block's `maxTokens`, reads the vendor off the id when none is given, and
 * refuses an id whose shape says nothing — the failure has to happen here,
 * with a message naming the fix, not on the first model turn.
 */
describe('chatModelOptionsWithOverride', () => {
  it('is exactly chatModelOptionsFor when there is no override', () => {
    expect(chatModelOptionsWithOverride({}, undefined)).toEqual({});
    expect(chatModelOptionsWithOverride({ modelProvider: 'openai', model: 'gpt-4o' }, undefined)).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('replaces the agent\'s model and provider with the override\'s', () => {
    expect(chatModelOptionsWithOverride(
      { modelProvider: 'anthropic', model: 'claude-sonnet-4-6', maxTokens: 4096 },
      { model: 'gpt-6-astra', provider: 'openai' },
    )).toEqual({ provider: 'openai', model: 'gpt-6-astra', maxTokens: 4096 });
  });

  it('infers the vendor from the id when the override names none', () => {
    expect(chatModelOptionsWithOverride({}, { model: 'gpt-6-astra' })).toEqual({ provider: 'openai', model: 'gpt-6-astra' });
    expect(chatModelOptionsWithOverride({}, { model: 'claude-opus-5' })).toEqual({ provider: 'anthropic', model: 'claude-opus-5' });
    expect(chatModelOptionsWithOverride({}, { model: 'us.anthropic.claude-sonnet-4-6' })).toEqual({ provider: 'bedrock', model: 'us.anthropic.claude-sonnet-4-6' });
  });

  it('refuses an id it cannot place, naming the fix', () => {
    expect(() => chatModelOptionsWithOverride({}, { model: 'mystery-9000' })).toThrow(/pass provider explicitly/);
  });

  it('honours an explicit provider over the inferred one', () => {
    // A Bedrock-hosted OpenAI-shaped id is not a thing today, but the point
    // is that a caller who says which vendor is believed.
    expect(chatModelOptionsWithOverride({}, { model: 'gpt-6-astra', provider: 'bedrock' })).toEqual({ provider: 'bedrock', model: 'gpt-6-astra' });
  });
});

describe('chatModelOptionsWithOverride and prompt caching', () => {
  it('keeps the agent\'s promptCache when the caller swaps the model', () => {
    // The model-upgrade test and the eval runner both override the model for
    // one compiled graph. An agent whose prompt must never be cached has to
    // stay uncached through that swap — the override is about which model does
    // the job, not about what its prompt may be used for.
    expect(chatModelOptionsWithOverride(
      { promptCache: false },
      { model: 'claude-opus-5', provider: 'anthropic' },
    )).toMatchObject({ promptCache: false, model: 'claude-opus-5', provider: 'anthropic' });
  });

  it('says nothing about caching when the agent said nothing', () => {
    expect(chatModelOptionsWithOverride({}, { model: 'claude-opus-5', provider: 'anthropic' }))
      .not
      .toHaveProperty('promptCache');
  });
});
