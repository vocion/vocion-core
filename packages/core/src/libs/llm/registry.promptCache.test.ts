/**
 * Which chat model class `buildChatModel` hands back.
 *
 * Caching is a property of the class, not of the call, because the agent graph
 * makes the call and this codebase never touches it. So "is caching on" is
 * answerable only by asking what was constructed — and the three ways it can be
 * wrong are all here: on when it should be off (an agent whose prompt must not
 * be cached), off when it should be on (the default, silently losing the whole
 * saving), and a kill switch that does not kill.
 *
 * OpenAI is deliberately absent: its caching is automatic with no per-call
 * switch, so there is no caching subclass to pick and `promptCache` is ignored.
 *
 * No network: constructing a chat model sends nothing.
 */
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatBedrockConverse } from '@langchain/aws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `buildChatModel` reaches the registry, which reads `api_token`. PGlite
// stands in for the database, as it does in the neighbouring registry tests.
vi.mock('@/libs/DB');

const { buildChatModel } = await import('./langchain');
const { CachingChatAnthropic, CachingChatBedrockConverse } = await import('./promptCache');

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'AWS_REGION',
  'VOCION_LLM_PROVIDER',
  'VOCION_LLM_PROVIDER_MAIN',
  'VOCION_PROMPT_CACHE',
] as const;
const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.ANTHROPIC_API_KEY = 'not-a-real-key';
  process.env.AWS_REGION = 'us-east-1';
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('buildChatModel on anthropic', () => {
  it('caches the prompt prefix by default', () => {
    expect(buildChatModel('main')).toBeInstanceOf(CachingChatAnthropic);
  });

  it('builds the plain class when the caller opts out', () => {
    const model = buildChatModel('main', { promptCache: false });

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model).not.toBeInstanceOf(CachingChatAnthropic);
  });

  it('still caches when the caller passes promptCache: true', () => {
    expect(buildChatModel('main', { promptCache: true })).toBeInstanceOf(CachingChatAnthropic);
  });

  it('is forced off process-wide by VOCION_PROMPT_CACHE=0, over the caller', () => {
    process.env.VOCION_PROMPT_CACHE = '0';
    const model = buildChatModel('main', { promptCache: true });

    expect(model).not.toBeInstanceOf(CachingChatAnthropic);
  });
});

describe('buildChatModel on bedrock', () => {
  beforeEach(() => {
    process.env.VOCION_LLM_PROVIDER = 'bedrock';
  });

  it('caches the prompt prefix by default', () => {
    expect(buildChatModel('main')).toBeInstanceOf(CachingChatBedrockConverse);
  });

  it('builds the plain class when the caller opts out', () => {
    const model = buildChatModel('main', { promptCache: false });

    expect(model).toBeInstanceOf(ChatBedrockConverse);
    expect(model).not.toBeInstanceOf(CachingChatBedrockConverse);
  });

  it('is forced off process-wide by VOCION_PROMPT_CACHE=0', () => {
    process.env.VOCION_PROMPT_CACHE = '0';

    expect(buildChatModel('main', {})).not.toBeInstanceOf(CachingChatBedrockConverse);
  });

  it('caches the classifier role too, whose Haiku default may still be under the minimum', () => {
    // Asking is free and correct; whether it caches is a property of the
    // prompt's length (see `minimumCacheableTokens`), not of this choice.
    expect(buildChatModel('classifier')).toBeInstanceOf(CachingChatBedrockConverse);
  });
});
