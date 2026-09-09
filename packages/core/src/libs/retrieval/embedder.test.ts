/**
 * Retry behavior in embed().
 *
 * Ingest embeds several documents at the same time (see
 * MAX_CONCURRENT_INGESTS), which makes OpenAI rate-limit responses a
 * routine occurrence rather than a theoretical one. A temporary rate limit
 * must not cost us the document: SourceSyncService only counts per-document
 * failures and carries on, so an embedding that gives up is data quietly
 * missing from the corpus.
 *
 * OpenAI is mocked out, since CI has no network access. What these tests
 * exercise is the retry loop inside embed() itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createEmbeddings = vi.fn();

// Replace only the client. The real error classes are kept, because the retry
// logic identifies a dropped connection by type — a fake would not behave the
// same way.
vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  return {
    ...actual,
    default: class {
      embeddings = { create: createEmbeddings };
    },
  };
});

/**
 * Every step reported to Langfuse, in order, so tests can check what the
 * observability dashboard would end up showing.
 */
const recordedSteps: Array<{ name: string; endedWith?: { level?: string } }> = [];

// The embedder now asks the credential vault whether this org supplied its own
// OpenAI key. These tests are about the retry loop, not about credentials, so
// the answer is always "no key of its own" — which sends it to the environment,
// exactly as before.
vi.mock('@/libs/llm/orgKey', () => ({
  resolveOrgProviderKey: vi.fn(async () => null),
}));

// The embedder also reads the workspace's own embedding settings off the
// project row. There is no such row here, so the answer is "authored nothing"
// and the provider resolves from the environment — which is what these tests
// want. PGlite stands in for the database specifically to keep node-postgres
// out: its connection timers fire through the `setTimeout` stub below and would
// be counted as waits the retry loop asked for.
vi.mock('@/libs/DB');

vi.mock('@/libs/Langfuse', () => ({
  flushTraces: vi.fn(async () => {}),
  traceFor: () => ({
    update: vi.fn(),
    generation: ({ name }: { name: string }) => {
      const step: { name: string; endedWith?: { level?: string } } = { name };
      recordedSteps.push(step);
      return {
        end: (endedWith?: { level?: string }) => {
          step.endedWith = endedWith ?? {};
        },
      };
    },
  }),
}));

const { APIConnectionError, APIError } = await import('openai');
const { embed } = await import('@/libs/retrieval/embedder');

const EMBED_OPTIONS = { orgId: 'org_embed_test', purpose: 'ingest' as const };

const EMBEDDING_DIMENSIONS = 1536;

/**
 * Build an error shaped the way the OpenAI client reports an HTTP failure.
 * @param status - The HTTP status code to attach to the error.
 */
function httpError(status: number): Error {
  return Object.assign(new Error(`http ${status}`), { status });
}

/**
 * Build a rate-limit error carrying the wait OpenAI is asking for.
 * @param retryAfter - Value for the `Retry-After` header.
 */
function rateLimitedWithRetryAfter(retryAfter: string): Error {
  return new APIError(429, undefined, 'rate limited', new Headers({ 'retry-after': retryAfter }));
}

/**
 * Waits the code asked for, in the order it asked. Populated by the timer stub
 * installed in `beforeEach`, which serves every wait immediately.
 */
const requestedWaits: number[] = [];

/**
 * Build a successful embedding response.
 * @param inputCount - How many inputs the response should return vectors for.
 */
function successfulResponse(inputCount: number) {
  return {
    data: Array.from({ length: inputCount }, (_, index) => ({
      index,
      embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.1),
    })),
    usage: { prompt_tokens: 4, total_tokens: 4 },
  };
}

let timerStub: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  recordedSteps.length = 0;
  requestedWaits.length = 0;
  createEmbeddings.mockReset();
  // Serve every wait immediately, but remember how long was asked for. The
  // backoff between retries is real time, so without this the suite would sit
  // through several seconds of it. Recording the request instead of serving it
  // also lets a test assert on a minute-long wait in a millisecond.
  const realSetTimeout = globalThis.setTimeout;
  timerStub = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
  ) => {
    // Zero-delay calls are other machinery yielding, not a deliberate wait.
    if (Number(delay ?? 0) > 0) {
      requestedWaits.push(Number(delay));
    }
    return realSetTimeout(callback, 0);
  }) as typeof globalThis.setTimeout);
});

afterEach(() => {
  timerStub?.mockRestore();
  timerStub = null;
});

describe('embed() retry', () => {
  it('retries after a rate limit and still returns the vectors', async () => {
    createEmbeddings
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(successfulResponse(2));

    const vectors = await embed(['alpha', 'beta'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(createEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('retries after a server error and still returns the vectors', async () => {
    createEmbeddings
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(successfulResponse(1));

    const vectors = await embed(['alpha'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(1);
  });

  it('does not retry a bad request, which would fail identically every time', async () => {
    createEmbeddings.mockRejectedValue(httpError(400));

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('http 400');
    expect(createEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('gives up after five attempts and reports the last error', async () => {
    createEmbeddings.mockRejectedValue(httpError(429));

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('http 429');
    expect(createEmbeddings).toHaveBeenCalledTimes(5);
  });

  it('backs off further with each attempt', async () => {
    // Each wait is random within a ceiling that doubles, so the exact numbers
    // vary — but the ceilings are 500, 1000, 2000, 4000, and four waits sit
    // between five attempts.
    createEmbeddings.mockRejectedValue(httpError(429));

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('http 429');

    expect(requestedWaits).toHaveLength(4);
    expect(requestedWaits.every((wait, index) => wait <= 500 * 2 ** index)).toBe(true);
  });

  it('retries a dropped connection, which carries no status code', async () => {
    // Several documents embed at once, so a reset socket is routine. These have
    // no status, so an earlier version treated them as permanent and gave up.
    createEmbeddings
      .mockRejectedValueOnce(new APIConnectionError({ message: 'socket hang up' }))
      .mockResolvedValueOnce(successfulResponse(1));

    const vectors = await embed(['alpha'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(1);
    expect(createEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ordinary programming mistake', async () => {
    // The guard above must key off the error's type, not merely the absence of
    // a status — otherwise a plain bug gets retried and its cause obscured.
    createEmbeddings.mockRejectedValue(new TypeError('cannot read property of undefined'));

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('cannot read property');
    expect(createEmbeddings).toHaveBeenCalledTimes(1);
  });
});

describe('what embed() reports for observability', () => {
  it('records one step per request, not one per batch', async () => {
    // Timing the whole retry loop as a single step counted our own waiting as
    // OpenAI's response time, so a throttled batch looked like OpenAI had
    // slowed to a crawl. One step per attempt keeps the timings honest.
    createEmbeddings
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(recordedSteps.map(step => step.name)).toEqual([
      'embed-batch-0',
      'embed-batch-0-retry-1',
      'embed-batch-0-retry-2',
    ]);
  });

  it('marks the attempts that failed as failed', async () => {
    createEmbeddings
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(recordedSteps.map(step => step.endedWith?.level)).toEqual(['ERROR', undefined]);
  });

  it('closes the step even when every attempt fails', async () => {
    // A step left open would sit in the dashboard looking unfinished forever.
    createEmbeddings.mockRejectedValue(httpError(429));

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('http 429');

    expect(recordedSteps).toHaveLength(5);
    expect(recordedSteps.every(step => step.endedWith !== undefined)).toBe(true);
  });

  it('keeps the original step name when nothing had to be retried', async () => {
    // Existing dashboard queries match on this name.
    createEmbeddings.mockResolvedValue(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(recordedSteps.map(step => step.name)).toEqual(['embed-batch-0']);
  });
});

describe('embed() checking the response is complete', () => {
  it('refuses a response that skipped one of the inputs', async () => {
    // Vectors are placed by the index the response reports, so a missing index
    // leaves a gap while the array's length still looks correct. Callers check
    // that length against their chunk count, so the gap would slip past them
    // and an undefined vector would reach the database.
    createEmbeddings.mockResolvedValue({
      data: [
        { index: 0, embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.1) },
        { index: 2, embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.3) },
      ],
      usage: { prompt_tokens: 6, total_tokens: 6 },
    });

    await expect(embed(['alpha', 'beta', 'gamma'], EMBED_OPTIONS))
      .rejects
      .toThrow('missing a vector for input 1');
  });

  it('refuses a response that repeated an index', async () => {
    createEmbeddings.mockResolvedValue({
      data: [
        { index: 0, embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.1) },
        { index: 0, embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.2) },
      ],
      usage: { prompt_tokens: 6, total_tokens: 6 },
    });

    await expect(embed(['alpha', 'beta'], EMBED_OPTIONS))
      .rejects
      .toThrow('missing a vector for input 1');
  });

  it('accepts a response whose indexes arrive out of order', async () => {
    // Order within the response is not promised, only the index is.
    createEmbeddings.mockResolvedValue({
      data: [
        { index: 1, embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.2) },
        { index: 0, embedding: Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0.1) },
      ],
      usage: { prompt_tokens: 6, total_tokens: 6 },
    });

    const vectors = await embed(['alpha', 'beta'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(2);
    // Each vector sits at the position its index asked for, not where it arrived.
    expect(vectors[0]?.[0]).toBeCloseTo(0.1);
    expect(vectors[1]?.[0]).toBeCloseTo(0.2);
  });
});

describe('embed() honouring Retry-After', () => {
  it('waits as long as OpenAI asks instead of guessing', async () => {
    // Two seconds is well outside the first backoff ceiling of 500ms, so this
    // wait can only have come from the header.
    createEmbeddings
      .mockRejectedValueOnce(rateLimitedWithRetryAfter('2'))
      .mockResolvedValueOnce(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(requestedWaits).toEqual([2000]);
  });

  it('ignores an absurd Retry-After rather than stalling the sync', async () => {
    // A day-long wait would hold the sync — and the caller's request — open.
    createEmbeddings
      .mockRejectedValueOnce(rateLimitedWithRetryAfter('86400'))
      .mockResolvedValueOnce(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(requestedWaits).toEqual([60_000]);
  });

  it('falls back to its own backoff when Retry-After is an HTTP date', async () => {
    // The header may legally be a date, which is not a number of seconds.
    createEmbeddings
      .mockRejectedValueOnce(rateLimitedWithRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'))
      .mockResolvedValueOnce(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(requestedWaits).toHaveLength(1);
    // The first backoff ceiling, not the header.
    expect(requestedWaits[0]).toBeLessThanOrEqual(500);
  });
});
