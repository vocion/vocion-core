/**
 * embedder — batched OpenAI embeddings client. Owns OpenAI specifics
 * so callers (IngestionService + RetrievalService) can think in terms
 * of `Float32Array[]` without leaking the SDK surface.
 *
 * Defaults:
 *   - model: text-embedding-3-small (1536-d). Matches Schema.ts
 *     `vector(1536)` column dimension. Override via env if we ever
 *     swap to text-embedding-3-large (3072-d) or a Voyage model.
 *   - batch size: 100. OpenAI accepts up to 2048 inputs per request
 *     but the latency curve flattens around 100; keeps memory bounded.
 *
 * Tracing: every batch fires a Langfuse `retrieval.embed` generation
 * span so we can attribute embedding cost per ingest run + per
 * retrieval query. The Schema.ts comment promises this and the
 * `/dashboard/observability` page sums against it.
 */

import process from 'node:process';
import OpenAI, { APIConnectionError } from 'openai';
import { langfuse, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { hashKey, llmMode, pseudoVector, readEntry, writeEntry } from '@/libs/llm/replay';

const MODEL = process.env.VOCION_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const BATCH_SIZE = 100;

/**
 * Log, loading the logger only when it's needed.
 *
 * `libs/Logger` has a top-level await, and this file sits in the import chain
 * of CLI scripts (`sync:source`, `ingest-docs`) that tsx compiles as CommonJS,
 * where a top-level await is fatal. Importing it normally breaks those scripts
 * outright. Same approach as `services/adoption/track.ts`.
 * @param message - What happened, in plain words.
 * @param properties - Identifiers and context worth keeping.
 */
function logWarning(message: string, properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger.warn(message, properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}

/**
 * Longest we'll honour a `Retry-After` for.
 *
 * A sync holds the caller's request open while it runs, so an unusually large
 * value would leave someone's browser waiting. Past this we fall back to our
 * own backoff and let the attempt budget run out instead.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * How many times to try a single request before giving up.
 *
 * Ingest embeds several documents at once (see MAX_CONCURRENT_INGESTS in
 * SourceSyncService), so hitting OpenAI's rate limit is normal here rather than
 * rare. Without a retry, that document is counted as an error and skipped —
 * meaning it's missing from search, and the agent answers as if it never
 * existed. Retrying is what prevents losing it.
 *
 * Five is enough to ride out a brief rate limit without holding the caller's
 * request open too long. A sustained one won't be solved by trying harder, and
 * the document keeps its existing saved copy either way.
 */
const MAX_ATTEMPTS = 5;

/**
 * Starting point for the wait between attempts, in milliseconds.
 *
 * The wait doubles each attempt and is randomised within that, so five attempts
 * span a few seconds in total. Only used when OpenAI hasn't told us how long to
 * wait — see requestedRetryDelayMs, which takes precedence.
 */
const BASE_RETRY_DELAY_MS = 500;

/**
 * Decide whether a failed request is worth sending again.
 *
 * Rate limits (429) and server errors (5xx) are temporary, so another attempt
 * can succeed. Any other 4xx means the request itself was wrong, and repeating
 * it would fail the same way every time.
 *
 * Dropped connections and timeouts count too, and matter more here than
 * anywhere else: with several embeddings in flight at once, a reset socket is
 * routine. These carry no status code, so they have to be recognised by type —
 * checking merely for "no status" would also retry ordinary programming
 * mistakes five times over.
 * @param error - The error thrown by the OpenAI client.
 */
function isTemporaryFailure(error: unknown): boolean {
  if (error instanceof APIConnectionError) {
    return true;
  }
  const status = (error as { status?: number } | null)?.status;
  if (typeof status !== 'number') {
    return false;
  }
  return status === 429 || status >= 500;
}

/**
 * The wait OpenAI itself asked for, in milliseconds, or null if it didn't.
 *
 * A 429 usually carries a `Retry-After` header saying when the allowance
 * resets. That beats guessing, so it wins over our own backoff. Capped, so a
 * strange or hostile value can't park the sync for an hour.
 * @param error - The error thrown by the OpenAI client.
 */
function requestedRetryDelayMs(error: unknown): number | null {
  const headers = (error as { headers?: { get?: (name: string) => string | null } } | null)?.headers;
  const rawValue = headers?.get?.('retry-after');
  if (!rawValue) {
    return null;
  }
  // OpenAI sends a whole number of seconds. An HTTP date is also legal here,
  // which parses as NaN — fall back to our own backoff in that case.
  const seconds = Number(rawValue);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Send one embedding request, retrying temporary failures.
 *
 * This is the only place embedding requests are retried. The OpenAI client can
 * do its own retrying, and is switched off in `client()` for that reason —
 * otherwise both layers retry the same request without knowing about each
 * other, turning five attempts into fifteen and multiplying the waits between
 * them. That makes a rate limit worse rather than better.
 *
 * When OpenAI says how long to wait, we wait that long. Otherwise the wait
 * grows with each attempt and is randomised, because several documents embed at
 * the same time and a rate limit tends to reject all of them at once — a fixed
 * wait would send every retry back together and trip the same limit again.
 * @param sendRequest - Performs the request, given the attempt number so it can
 * record each attempt separately. Called once per attempt.
 */
async function sendWithRetries<T>(sendRequest: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await sendRequest(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      if (!isTemporaryFailure(error) || isLastAttempt) {
        // Thrown on to the caller, which logs it with the document it belongs to.
        throw error;
      }
      const requestedDelayMs = requestedRetryDelayMs(error);
      // Failing that, wait somewhere between zero and a ceiling that doubles
      // each attempt.
      const delayMs = requestedDelayMs ?? Math.random() * (BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
      // Log every retry. These are swallowed by definition — the request
      // eventually succeeds and nobody hears about it — so without this a
      // sustained rate limit looks like nothing more than a slow sync.
      logWarning('embedding request failed, retrying', {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        delayMs: Math.round(delayMs),
        waitAskedForByOpenAi: requestedDelayMs !== null,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
  // Unreachable — MAX_ATTEMPTS is at least 1, so the loop above either returns
  // a result or throws. Kept so a future change to the loop bounds surfaces as
  // a real error rather than `throw undefined`, which would defeat every
  // `instanceof Error` check upstream.
  throw lastError ?? new Error('embedding retry loop ended without a result');
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set — embeddings require an OpenAI key. Set it on the running container or in .env.local.');
    }
    // maxRetries: 0 — retrying is handled by sendWithRetries above, and this
    // client would otherwise retry the same request twice more underneath it.
    // Two layers that can't see each other multiply: five of our attempts
    // become fifteen requests, each already carrying the client's own waits.
    // Ours is the layer to keep, because it logs each retry and honours the
    // `Retry-After` header rather than only backing off blindly.
    _client = new OpenAI({ apiKey, maxRetries: 0 });
  }
  return _client;
}

export type EmbedOptions = {
  orgId: string;
  /** Tag on the trace: 'ingest' | 'query' | etc. */
  purpose: 'ingest' | 'query' | 'rerank';
  /** Optional source-slug for trace tagging. */
  sourceSlug?: string;
};

/**
 * Embed a batch of strings. Returns vectors in the same order as the
 * input. Splits into BATCH_SIZE chunks under the hood.
 * @param texts
 * @param opts
 */
export async function embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  // Demo sandbox replay: never call OpenAI. Recorded vectors come back
  // exactly; unrecorded text gets a deterministic pseudo-vector so
  // retrieval stays functional (stable, if arbitrary, ranking).
  if (llmMode() === 'replay') {
    return texts.map((text) => {
      const cached = readEntry<number[]>('embeddings', hashKey(MODEL, text));
      return cached ?? pseudoVector(text);
    });
  }
  const trace = traceFor({
    feature: FEATURES.RETRIEVAL_EMBED,
    slug: opts.sourceSlug ?? opts.purpose,
    orgId: opts.orgId,
    userId: 'system',
    input: { count: texts.length, model: MODEL },
    metadata: { purpose: opts.purpose },
  });
  const out: number[][] = [];
  let totalTokens = 0;
  try {
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchNumber = i / BATCH_SIZE;
      // Record each attempt as its own step, rather than wrapping the whole
      // retry loop in one. Wrapping counted our own waiting as OpenAI's
      // response time, so a rate-limited batch showed up on
      // /dashboard/observability as OpenAI having slowed to a minute — sending
      // you to look at OpenAI when the real problem is being throttled. Per
      // attempt, the timings are the real request times and the retries are
      // visible as separate steps instead of hiding inside one slow one.
      const res = await sendWithRetries(async (attempt) => {
        const generation = trace.generation({
          // The first attempt keeps the original name so existing charts and
          // queries still match; only retries get a suffix.
          name: attempt === 1 ? `embed-batch-${batchNumber}` : `embed-batch-${batchNumber}-retry-${attempt - 1}`,
          model: MODEL,
          input: { count: batch.length },
        });
        try {
          const response = await client().embeddings.create({ model: MODEL, input: batch });
          const usage = response.usage ?? { prompt_tokens: 0, total_tokens: 0 };
          totalTokens += usage.total_tokens;
          generation.end({
            output: `${batch.length} vectors`,
            usageDetails: { input: usage.prompt_tokens, total: usage.total_tokens },
          });
          return response;
        } catch (error) {
          // Close the step as failed. Left open, a failed attempt would either
          // vanish from the numbers or sit there looking unfinished.
          generation.end({
            level: 'ERROR',
            output: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });
      for (const item of res.data) {
        out[i + item.index] = item.embedding;
        // Demo sandbox record: persist per-text vectors for exact replay.
        if (llmMode() === 'record' && batch[item.index] !== undefined) {
          writeEntry('embeddings', hashKey(MODEL, batch[item.index]!), item.embedding);
        }
      }
      // Check every input in this batch actually came back with a vector.
      //
      // Results are placed by the index the response reports, so a missing or
      // repeated index leaves a gap in the array while its `length` still looks
      // right. Callers check the length against their chunk count and would
      // pass, then write an undefined vector to the database. Better to fail
      // the document: the sync counts it as an error and, since we saw it,
      // leaves the existing copy in place.
      for (let position = i; position < i + batch.length; position++) {
        if (!out[position]) {
          throw new Error(
            `embedding response was missing a vector for input ${position} of ${texts.length} — refusing to store an incomplete result`,
          );
        }
      }
    }
    trace.update({ output: { vectors: out.length, totalTokens } });
  } finally {
    // Fire-and-forget flush; embed() callers may run many times in
    // succession so we don't await the network round-trip.
    void langfuse.flushAsync();
  }
  return out;
}
