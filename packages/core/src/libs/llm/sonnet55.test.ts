import { describe, expect, it } from 'vitest';
import { anthropicOffIsBetweenTools, buildChatModel, resolvedModelId } from './langchain';

describe('chat on Sonnet 5.5', () => {
  it('is the main default on the Anthropic API', () => {
    const was = process.env.VOCION_LLM_MODEL_MAIN;
    delete process.env.VOCION_LLM_MODEL_MAIN;
    try {
      expect(resolvedModelId('main')).toBe('claude-sonnet-5-5');
    } finally {
      if (was !== undefined) {
        process.env.VOCION_LLM_MODEL_MAIN = was;
      }
    }
  });

  it('turns thinking off its own way: between_tools, never disabled (a 400)', () => {
    expect(anthropicOffIsBetweenTools('claude-sonnet-5-5')).toBe(true);
    expect(anthropicOffIsBetweenTools('claude-sonnet-5')).toBe(false);

    const model = buildChatModel('main', { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test', streaming: false, promptCache: false } as never) as unknown as { invocationParams: (o?: unknown) => Record<string, unknown> };
    // What the request carries, as the model would send it.
    const body = model.invocationParams({});

    expect(body.thinking).toEqual({ type: 'between_tools' });
    expect(body).not.toHaveProperty('temperature');
  });
});
