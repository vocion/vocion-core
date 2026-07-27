/**
 * embedder retry/backoff. Ingest runs the document loop with a bounded
 * concurrency window (VOCION_INGEST_CONCURRENCY), which makes OpenAI
 * 429s likely rather than theoretical. A transient rate-limit must not
 * drop the document — SourceSyncService catches per-document errors and
 * only bumps a counter, so a dropped embed is silent data loss.
 *
 * OpenAI itself is mocked (no network in CI); the behavior under test is
 * embed()'s own retry loop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

vi.mock('openai', () => ({
  default: class {
    embeddings = { create };
  },
}));

vi.mock('@/libs/Langfuse', () => ({
  langfuse: { flushAsync: vi.fn(async () => {}) },
  traceFor: () => ({
    update: vi.fn(),
    generation: () => ({ end: vi.fn() }),
  }),
}));

const { embed } = await import('@/libs/retrieval/embedder');

const OPTS = { orgId: 'org_embed_test', purpose: 'ingest' as const };

/**
 * An OpenAI SDK-shaped HTTP error.
 * @param status
 */
function httpError(status: number): Error {
  return Object.assign(new Error(`http ${status}`), { status });
}

/**
 * One embedding response for `n` inputs.
 * @param n
 */
function okResponse(n: number) {
  return {
    data: Array.from({ length: n }, (_, index) => ({
      index,
      embedding: Array.from<number>({ length: 1536 }).fill(0.1),
    })),
    usage: { prompt_tokens: 4, total_tokens: 4 },
  };
}

beforeEach(() => {
  create.mockReset();
  // Collapse backoff so the suite doesn't sit in real sleeps.
  vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
});

describe('embed() retry', () => {
  it('retries a 429 and still returns the vectors', async () => {
    create
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(okResponse(2));

    const vectors = await embed(['alpha', 'beta'], OPTS);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1536);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx and still returns the vectors', async () => {
    create
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(okResponse(1));

    const vectors = await embed(['alpha'], OPTS);

    expect(vectors).toHaveLength(1);
  });

  it('does not retry a 400 — a malformed request will never succeed', async () => {
    create.mockRejectedValue(httpError(400));

    await expect(embed(['alpha'], OPTS)).rejects.toThrow('http 400');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and throws the last error', async () => {
    create.mockRejectedValue(httpError(429));
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', '3');

    await expect(embed(['alpha'], OPTS)).rejects.toThrow('http 429');
    expect(create).toHaveBeenCalledTimes(3);
  });
});
