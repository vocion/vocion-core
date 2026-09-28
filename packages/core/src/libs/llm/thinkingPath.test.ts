import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The thinking branch of `buildChatModel`, asserted on the constructor
 * arguments rather than a live call: what matters is the SHAPE of the
 * request, because 4.7+ answer the old shape with a 400 before any model
 * runs.
 */
const ctor = vi.fn();
vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    constructor(args: unknown) {
      ctor(args);
    }
  },
}));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: class {} }));
vi.mock('@langchain/aws', () => ({ ChatBedrockConverse: class {} }));
vi.mock('./replay', () => ({ llmMode: () => 'live' }));
vi.mock('./replayCache', () => ({ getReplayCache: () => null }));

describe('buildChatModel — thinking on Anthropic', () => {
  beforeEach(() => {
    ctor.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.VOCION_THINKING_BUDGET = '2048';
  });

  afterEach(() => {
    delete process.env.VOCION_THINKING_BUDGET;
  });

  it('sends adaptive thinking with no temperature and no budget on 4.6+', async () => {
    const { buildChatModel } = await import('./langchain');
    buildChatModel('main', { provider: 'anthropic', model: 'claude-sonnet-5' });
    const args = ctor.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(args.thinking).toEqual({ type: 'adaptive' });
    expect(args).not.toHaveProperty('temperature');
    expect(JSON.stringify(args)).not.toContain('budget_tokens');
  });

  it('keeps the budgeted form, with temperature 1, for older Claude', async () => {
    const { buildChatModel } = await import('./langchain');
    buildChatModel('main', { provider: 'anthropic', model: 'claude-3-7-sonnet-20250219' });
    const args = ctor.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(args.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(args.temperature).toBe(1);
  });

  it('does not think at all for roles other than main', async () => {
    const { buildChatModel } = await import('./langchain');
    buildChatModel('classifier', { provider: 'anthropic', model: 'claude-sonnet-5' });
    const args = ctor.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(args).not.toHaveProperty('thinking');
  });
});

describe('buildChatModel — thinking off on models that think unless told not to', () => {
  beforeEach(() => {
    ctor.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it.each(['claude-sonnet-5', 'claude-opus-5'])('tells %s to stop thinking when the caller asks for off', async (model) => {
    const { buildChatModel } = await import('./langchain');
    buildChatModel('extractor', { provider: 'anthropic', model, thinking: 'off' });
    const args = ctor.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(args.thinking).toEqual({ type: 'disabled' });
  });

  it.each(['claude-sonnet-4-6', 'claude-fable-5', 'claude-mythos-5', 'claude-opus-5-5'])('sends no thinking field to %s for off', async (model) => {
    // Sonnet 4.6 does not think unless asked; Fable 5 and Mythos 5 answer
    // `disabled` with a 400; Opus 5.5 is not known to accept it.
    const { buildChatModel } = await import('./langchain');
    buildChatModel('extractor', { provider: 'anthropic', model, thinking: 'off' });
    const args = ctor.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(args).not.toHaveProperty('thinking');
  });

  it('changes nothing for a caller that did not ask for off', async () => {
    const { buildChatModel } = await import('./langchain');
    buildChatModel('main', { provider: 'anthropic', model: 'claude-sonnet-5' });
    const args = ctor.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(args).not.toHaveProperty('thinking');
  });
});
