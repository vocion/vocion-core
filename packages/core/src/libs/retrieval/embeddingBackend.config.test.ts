import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS, resolveEmbeddingModel, resolveEmbeddingProvider } from './embeddingBackend';

/**
 * Embedding provider + model precedence.
 *
 * Pure functions, so no database and no mocks. What is being pinned down here
 * is an ordering: the workspace's authored setting beats the environment,
 * because a workspace's stored vectors were produced under the workspace's
 * setting and an env var changing underneath it would invalidate all of them.
 */

const ENV_KEYS = [
  'VOCION_EMBEDDING_PROVIDER',
  'VOCION_EMBEDDING_MODEL',
  'VOCION_LLM_PROVIDER',
  'VOCION_LLM_PROVIDER_EMBEDDER',
] as const;

const original = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    original.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('resolveEmbeddingProvider', () => {
  it('defaults to openai, which is what every already-stored vector came from', () => {
    expect(resolveEmbeddingProvider()).toBe('openai');
  });

  it('honours VOCION_EMBEDDING_PROVIDER', () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'bedrock';

    expect(resolveEmbeddingProvider()).toBe('bedrock');
  });

  it('accepts the value case-insensitively', () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'BEDROCK';

    expect(resolveEmbeddingProvider()).toBe('bedrock');
  });

  it('rejects a provider it cannot serve, naming what it expected', () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'cohere';

    expect(() => resolveEmbeddingProvider()).toThrow(/unknown embedding provider "cohere"/);
  });

  it('follows VOCION_LLM_PROVIDER to bedrock when no embedding var is set', () => {
    process.env.VOCION_LLM_PROVIDER = 'bedrock';

    expect(resolveEmbeddingProvider()).toBe('bedrock');
  });

  it('follows the per-role VOCION_LLM_PROVIDER_EMBEDDER too', () => {
    process.env.VOCION_LLM_PROVIDER_EMBEDDER = 'bedrock';

    expect(resolveEmbeddingProvider()).toBe('bedrock');
  });

  it('stays on openai for an anthropic deployment, which ships no embedding model', () => {
    process.env.VOCION_LLM_PROVIDER = 'anthropic';

    expect(resolveEmbeddingProvider()).toBe('openai');
  });

  it('lets the explicit embedding var override an inherited bedrock deployment', () => {
    process.env.VOCION_LLM_PROVIDER = 'bedrock';
    process.env.VOCION_EMBEDDING_PROVIDER = 'openai';

    expect(resolveEmbeddingProvider()).toBe('openai');
  });

  it('lets the workspace setting win over the environment', () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'openai';

    expect(resolveEmbeddingProvider({ provider: 'bedrock' })).toBe('bedrock');
  });

  it('falls through to the environment when the workspace pinned only a model', () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'bedrock';

    expect(resolveEmbeddingProvider({ model: 'amazon.titan-embed-text-v1' })).toBe('bedrock');
  });

  it('treats a null workspace config as no opinion', () => {
    process.env.VOCION_EMBEDDING_PROVIDER = 'bedrock';

    expect(resolveEmbeddingProvider(null)).toBe('bedrock');
  });
});

describe('resolveEmbeddingModel', () => {
  it('defaults openai to the 1536-dimension small model', () => {
    expect(resolveEmbeddingModel('openai')).toBe('text-embedding-3-small');
  });

  it('defaults bedrock to Titan Text Embeddings G1', () => {
    expect(resolveEmbeddingModel('bedrock')).toBe('amazon.titan-embed-text-v1');
  });

  it('honours VOCION_EMBEDDING_MODEL for either provider', () => {
    process.env.VOCION_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

    expect(resolveEmbeddingModel('bedrock')).toBe('amazon.titan-embed-text-v2:0');
    expect(resolveEmbeddingModel('openai')).toBe('amazon.titan-embed-text-v2:0');
  });

  it('lets the workspace model win over the environment', () => {
    process.env.VOCION_EMBEDDING_MODEL = 'text-embedding-3-large';

    expect(resolveEmbeddingModel('openai', { model: 'text-embedding-3-small' })).toBe('text-embedding-3-small');
  });

  it('falls back to the provider default when the workspace pinned only a provider', () => {
    expect(resolveEmbeddingModel('bedrock', { provider: 'bedrock' })).toBe('amazon.titan-embed-text-v1');
  });
});

describe('EMBEDDING_DIMENSIONS', () => {
  it('matches the vector width the knowledge_chunk column was built for', () => {
    // Pinned by a test because the constant and the column have to move
    // together: a mismatch means either refused writes or a corrupt index.
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });
});
