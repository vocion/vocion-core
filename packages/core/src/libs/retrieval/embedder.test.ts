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
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/libs/Langfuse', () => ({
  langfuse: { flushAsync: vi.fn(async () => {}) },
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
 * Run something and report the waits it asked for, without serving them.
 *
 * Timers fire straight away, so a test can assert on a sixty-second wait in a
 * few milliseconds. Delays of zero are dropped: those are the scheduling hops
 * other machinery makes, not a deliberate wait between retries.
 * @param run - The work to observe.
 */
async function waitsRequestedBy(run: () => Promise<unknown>): Promise<number[]> {
  const requested: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
  ) => {
    requested.push(Number(delay ?? 0));
    return realSetTimeout(callback, 0);
  }) as typeof globalThis.setTimeout);
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return requested.filter(delay => delay > 0);
}

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

beforeEach(() => {
  recordedSteps.length = 0;
  createEmbeddings.mockReset();
  // Start each test from the defaults; tests below override what they need.
  vi.unstubAllEnvs();
  // Remove the retry delay so the suite doesn't spend real time sleeping.
  vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
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

  it('stops after the configured number of attempts and reports the last error', async () => {
    createEmbeddings.mockRejectedValue(httpError(429));
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', '3');

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('http 429');
    expect(createEmbeddings).toHaveBeenCalledTimes(3);
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
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
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
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
    createEmbeddings
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(successfulResponse(1));

    await embed(['alpha'], EMBED_OPTIONS);

    expect(recordedSteps.map(step => step.endedWith?.level)).toEqual(['ERROR', undefined]);
  });

  it('closes the step even when every attempt fails', async () => {
    // A step left open would sit in the dashboard looking unfinished forever.
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', '2');
    createEmbeddings.mockRejectedValue(httpError(429));

    await expect(embed(['alpha'], EMBED_OPTIONS)).rejects.toThrow('http 429');

    expect(recordedSteps).toHaveLength(2);
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
    // Our own backoff is zero here, so a two-second wait can only have come
    // from the header.
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
    createEmbeddings
      .mockRejectedValueOnce(rateLimitedWithRetryAfter('2'))
      .mockResolvedValueOnce(successfulResponse(1));

    const waits = await waitsRequestedBy(() => embed(['alpha'], EMBED_OPTIONS));

    expect(waits).toEqual([2000]);
  });

  it('ignores an absurd Retry-After rather than stalling the sync', async () => {
    // A day-long wait would hold the sync — and the caller's request — open.
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '0');
    createEmbeddings
      .mockRejectedValueOnce(rateLimitedWithRetryAfter('86400'))
      .mockResolvedValueOnce(successfulResponse(1));

    const waits = await waitsRequestedBy(() => embed(['alpha'], EMBED_OPTIONS));

    expect(waits).toEqual([60_000]);
  });

  it('falls back to its own backoff when Retry-After is an HTTP date', async () => {
    // The header may legally be a date, which is not a number of seconds.
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', '40');
    createEmbeddings
      .mockRejectedValueOnce(rateLimitedWithRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'))
      .mockResolvedValueOnce(successfulResponse(1));

    const waits = await waitsRequestedBy(() => embed(['alpha'], EMBED_OPTIONS));

    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeLessThanOrEqual(40);
  });
});

/**
 * An unusable attempt count must not disable embedding. Reading it with a bare
 * `Number()` yields NaN, which skips the retry loop entirely — so nothing is
 * ever sent, and the error raised carries no message at all.
 */
describe('embed() with unusable retry settings', () => {
  it.each(['five', '', '0', '-2'])('ignores an attempt count of %o and still embeds', async (value) => {
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', value);
    createEmbeddings.mockResolvedValue(successfulResponse(1));

    const vectors = await embed(['alpha'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(1);
    expect(createEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('still retries when the attempt count is unusable', async () => {
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', 'not-a-number');
    createEmbeddings
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(successfulResponse(1));

    const vectors = await embed(['alpha'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(1);
    expect(createEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('reports a real error rather than an empty one when it gives up', async () => {
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', 'not-a-number');
    createEmbeddings.mockRejectedValue(httpError(429));

    const failure = await embed(['alpha'], EMBED_OPTIONS).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('http 429');
  });

  it('ignores an unusable retry delay, which would otherwise remove the backoff', async () => {
    // `setTimeout(…, NaN)` fires immediately, so an unusable delay silently
    // turns the backoff off. Inspect the delay actually scheduled: it has to
    // be a real number for the wait to mean anything.
    const scheduleDelay = vi.spyOn(globalThis, 'setTimeout');
    vi.stubEnv('VOCION_EMBED_RETRY_BASE_MS', 'soon');
    vi.stubEnv('VOCION_EMBED_MAX_ATTEMPTS', '2');
    createEmbeddings
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(successfulResponse(1));

    const vectors = await embed(['alpha'], EMBED_OPTIONS);

    expect(vectors).toHaveLength(1);

    const scheduledDelays = scheduleDelay.mock.calls.map(call => call[1]);

    expect(scheduledDelays.length).toBeGreaterThan(0);
    expect(scheduledDelays.every(delay => Number.isFinite(delay))).toBe(true);

    scheduleDelay.mockRestore();
  });
});
