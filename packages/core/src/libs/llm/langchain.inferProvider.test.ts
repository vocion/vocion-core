import { describe, expect, it, vi } from 'vitest';

// langchain.ts pulls in the org-key resolver, which reaches the database at
// import time. The pure function under test never touches it.
vi.mock('@/libs/DB');

const { inferProviderForModel } = await import('./langchain');

/**
 * Which vendor a bare model id belongs to.
 *
 * The model-upgrade test lets a person name a candidate model without naming
 * its vendor, so `gpt-6-astra` has to land on OpenAI and `claude-…` on
 * Anthropic from the id alone — and anything whose shape says nothing must
 * come back null rather than defaulting to a vendor that will 404 on it.
 */
describe('inferProviderForModel', () => {
  it('reads the GPT-6 / GPT-5.6 generation as OpenAI', () => {
    expect(inferProviderForModel('gpt-6-astra')).toBe('openai');
    expect(inferProviderForModel('gpt-5.6-sol')).toBe('openai');
    expect(inferProviderForModel('gpt-5.6-terra')).toBe('openai');
    expect(inferProviderForModel('gpt-5.6-luna')).toBe('openai');
    expect(inferProviderForModel('gpt-4o-mini')).toBe('openai');
    expect(inferProviderForModel('o3')).toBe('openai');
  });

  it('reads claude- ids as Anthropic', () => {
    expect(inferProviderForModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferProviderForModel('claude-haiku-4-5-20251001')).toBe('anthropic');
  });

  it('reads decorated ids as Bedrock', () => {
    expect(inferProviderForModel('us.anthropic.claude-sonnet-4-6')).toBe('bedrock');
    expect(inferProviderForModel('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('bedrock');
    expect(inferProviderForModel('amazon.titan-embed-text-v1')).toBe('bedrock');
  });

  it('refuses to guess an unfamiliar shape', () => {
    expect(inferProviderForModel('some-model-nobody-priced')).toBeNull();
    expect(inferProviderForModel('')).toBeNull();
  });
});
