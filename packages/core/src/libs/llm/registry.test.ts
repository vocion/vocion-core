import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildChatModel, withPromptCache } from './langchain';
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

describe('buildChatModel', () => {
  const originalProvider = process.env.VOCION_LLM_PROVIDER;
  const originalRoleProvider = process.env.VOCION_LLM_PROVIDER_MAIN;
  const originalRoleModel = process.env.VOCION_LLM_MODEL_MAIN;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.VOCION_LLM_PROVIDER;
    delete process.env.VOCION_LLM_PROVIDER_MAIN;
    delete process.env.VOCION_LLM_MODEL_MAIN;
  });

  afterEach(() => {
    const restore = (k: string, v: string | undefined): void => {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    };
    restore('VOCION_LLM_PROVIDER', originalProvider);
    restore('VOCION_LLM_PROVIDER_MAIN', originalRoleProvider);
    restore('VOCION_LLM_MODEL_MAIN', originalRoleModel);
    restore('ANTHROPIC_API_KEY', originalAnthropic);
    restore('OPENAI_API_KEY', originalOpenAI);
  });

  it('defaults main role to ChatAnthropic with claude-sonnet-4-6', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const model = buildChatModel('main');

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect((model as unknown as { model: string }).model).toBe('claude-sonnet-4-6');
  });

  it('defaults classifier role to claude-haiku', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const model = buildChatModel('classifier');

    expect((model as unknown as { model: string }).model).toMatch(/^claude-haiku-4-5/);
  });

  it('honours VOCION_LLM_PROVIDER override', () => {
    process.env.VOCION_LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const model = buildChatModel('main');

    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it('role-specific provider beats process-wide provider', () => {
    process.env.VOCION_LLM_PROVIDER = 'anthropic';
    process.env.VOCION_LLM_PROVIDER_MAIN = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const main = buildChatModel('main');
    const classifier = buildChatModel('classifier');

    expect(main).toBeInstanceOf(ChatOpenAI);
    expect(classifier).toBeInstanceOf(ChatAnthropic);
  });

  it('honours VOCION_LLM_MODEL_<ROLE> override', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VOCION_LLM_MODEL_MAIN = 'claude-opus-4-7';
    const model = buildChatModel('main');

    expect((model as unknown as { model: string }).model).toBe('claude-opus-4-7');
  });

  it('inline options beat env vars', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VOCION_LLM_MODEL_MAIN = 'claude-sonnet-4-6';
    const model = buildChatModel('main', { model: 'claude-opus-4-7' });

    expect((model as unknown as { model: string }).model).toBe('claude-opus-4-7');
  });

  it('throws a helpful error when the required key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => buildChatModel('main')).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('rejects unknown provider strings', () => {
    process.env.VOCION_LLM_PROVIDER = 'cohere';

    expect(() => buildChatModel('main')).toThrow(/unknown llm provider/);
  });
});

describe('withPromptCache', () => {
  it('marks the last content block of the last message as ephemeral', () => {
    const out = withPromptCache([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
    ]);
    const last = out[out.length - 1]!;

    expect(Array.isArray(last.content)).toBe(true);

    const blocks = last.content as unknown as Array<{ type: string; cache_control?: { type: string } }>;

    expect(blocks[blocks.length - 1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('returns the input unchanged when the list is empty', () => {
    const out = withPromptCache([]);

    expect(out).toEqual([]);
  });

  it('does not mutate earlier messages', () => {
    const out = withPromptCache([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user message' },
    ]);

    expect(out[0]?.content).toBe('system prompt');
  });

  it('preserves an existing block array', () => {
    const out = withPromptCache([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ]);
    const blocks = out[0]!.content as Array<{ type: string; text: string; cache_control?: { type: string } }>;

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });
});
