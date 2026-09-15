import { describe, expect, it } from 'vitest';
import { anthropicOmitsSampling } from './langchain';

describe('anthropicOmitsSampling', () => {
  it('omits for the 5 family, which answers a sampling parameter with a 400', () => {
    // The live break on 2026-09-15: "`temperature` is deprecated for this model".
    expect(anthropicOmitsSampling('claude-sonnet-5')).toBe(true);
    expect(anthropicOmitsSampling('claude-opus-5')).toBe(true);
    expect(anthropicOmitsSampling('claude-fable-5-1')).toBe(true);
    expect(anthropicOmitsSampling('claude-mythos-5-1')).toBe(true);
  });

  it('omits for 4.7 and 4.8, which refuse them the same way', () => {
    expect(anthropicOmitsSampling('claude-opus-4-7')).toBe(true);
    expect(anthropicOmitsSampling('claude-opus-4-8')).toBe(true);
  });

  it('KEEPS them for 4.6, which still honours what it is sent', () => {
    // `claude-sonnet-4-6` is the default main model. Omitting the parameter
    // here would move every default call off temperature 0 without anyone
    // asking for it — the bug this test exists to prevent coming back.
    expect(anthropicOmitsSampling('claude-sonnet-4-6')).toBe(false);
    expect(anthropicOmitsSampling('claude-opus-4-6')).toBe(false);
  });

  it('keeps them for older Claude', () => {
    expect(anthropicOmitsSampling('claude-3-5-sonnet-20241022')).toBe(false);
    expect(anthropicOmitsSampling('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('sees through a Bedrock id, which decorates the model name', () => {
    expect(anthropicOmitsSampling('us.anthropic.claude-sonnet-5-v1:0')).toBe(true);
    expect(anthropicOmitsSampling('us.anthropic.claude-opus-4-8-v1:0')).toBe(true);
    expect(anthropicOmitsSampling('us.anthropic.claude-sonnet-4-6-v1:0')).toBe(false);
  });
});
