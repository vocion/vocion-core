import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLLMClient, resetLLMClients } from './registry';

/**
 * Provider registry tests — construction + error paths. We don't hit real
 * APIs here; adapter-shape tests mock the SDK clients directly.
 */
describe('getLLMClient', () => {
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    resetLLMClients();
  });

  afterEach(() => {
    if (originalOpenAI === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAI;
    }
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
  });

  it('constructs openai client when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test-abc';
    const client = getLLMClient('openai');

    expect(client.provider).toBe('openai');
    expect(typeof client.generate).toBe('function');
  });

  it('constructs anthropic client when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const client = getLLMClient('anthropic');

    expect(client.provider).toBe('anthropic');
  });

  it('throws with a helpful message when openai key is missing', () => {
    delete process.env.OPENAI_API_KEY;

    expect(() => getLLMClient('openai')).toThrow(/OPENAI_API_KEY/);
  });

  it('throws with a helpful message when anthropic key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => getLLMClient('anthropic')).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('declares vertex as not-yet-implemented', () => {
    expect(() => getLLMClient('vertex')).toThrow(/not yet implemented/);
  });

  it('declares azure-openai as not-yet-implemented', () => {
    expect(() => getLLMClient('azure-openai')).toThrow(/not yet implemented/);
  });

  it('reuses the same singleton across calls', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const a = getLLMClient('openai');
    const b = getLLMClient('openai');

    expect(a).toBe(b);
  });
});
