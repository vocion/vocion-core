import { describe, expect, it } from 'vitest';
import { anthropicAdaptiveOnly, anthropicThinksUnlessDisabled, buildChatModel } from '@/libs/llm/langchain';

describe('models that take only adaptive thinking', () => {
  it('names the 5 family past its first release, Fable 5 and Mythos 5', () => {
    expect(anthropicAdaptiveOnly('claude-opus-5-5')).toBe(true);
    expect(anthropicAdaptiveOnly('claude-sonnet-5-1')).toBe(true);
    expect(anthropicAdaptiveOnly('claude-fable-5-1')).toBe(true);
    expect(anthropicAdaptiveOnly('claude-opus-5')).toBe(false);
    expect(anthropicAdaptiveOnly('claude-sonnet-4-6')).toBe(false);
    expect(anthropicThinksUnlessDisabled('claude-opus-5-5')).toBe(false);
  });

  it('sends adaptive, never the disabled LangChain sends by default', () => {
    const m = buildChatModel('main', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' } as never) as unknown as { thinking?: { type?: string } };

    expect(m.thinking?.type).toBe('adaptive');

    const off = buildChatModel('main', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k', thinking: 'off' } as never) as unknown as { thinking?: { type?: string } };

    expect(off.thinking?.type).toBe('adaptive');
  });
});
