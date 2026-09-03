/**
 * embedder — batched embeddings, on whichever provider is configured. Owns the
 * batching, retry and tracing so callers (IngestionService +
 * RetrievalService) can think in terms of vectors without knowing which vendor
 * produced them.
 *
 * The vendor specifics — model id, request shape, how many texts fit in one
 * request — live in `./embeddingBackend.ts`. OpenAI and Amazon Bedrock are both
 * supported; `VOCION_EMBEDDING_PROVIDER` picks one, and a deployment that set
 * `VOCION_LLM_PROVIDER=bedrock` gets Bedrock embeddings without a second
 * variable. OpenAI stays the default, because it is what every already-stored
 * vector was produced by.
 *
 * Defaults:
 *   - model: per provider, see `DEFAULT_MODELS` in `./embeddingBackend.ts`.
 *     Every backend checks the width it got back against the `vector(1536)`
 *     column in Schema.ts and refuses a mismatch rather than failing at insert.
 *   - batch size: the backend's. OpenAI takes 100 texts per request; Titan on
 *     Bedrock takes one.
 *
 * Tracing: every batch fires a Langfuse `retrieval.embed` generation
 * span so we can attribute embedding cost per ingest run + per
 * retrieval query. The Schema.ts comment promises this and the
 * `/dashboard/observability` page sums against it.
 */

import { APIConnectionError } from 'openai';
import { flushTraces, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { hashKey, llmMode, pseudoVector, readEntry, writeEntry } from '@/libs/llm/replay';
import { embeddingBackendForOrg, resolveEmbeddingModel, resolveEmbeddingProvider } from './embeddingBackend';

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
 *
 * Two client libraries reach this. The OpenAI client puts the code on `status`;
 * the AWS SDK puts it on `$metadata.httpStatusCode` and additionally marks
 * throttling on `$retryable`. Both are read, because an `AccessDeniedException`
 * or a `ValidationException` from Bedrock must fail on the first attempt —
 * retrying a wrong model id or a missing permission five times only delays the
 * error that tells you what to fix.
 * @param error - The error thrown by the provider's client.
 */
function isTemporaryFailure(error: unknown): boolean {
  if (error instanceof APIConnectionError) {
    return true;
  }
  const candidate = error as {
    status?: number;
    $metadata?: { httpStatusCode?: number };
    $retryable?: { throttling?: boolean };
  } | null;
  if (candidate?.$retryable?.throttling) {
    return true;
  }
  const status = candidate?.status ?? candidate?.$metadata?.httpStatusCode;
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
 *
 * The two clients expose headers differently: the OpenAI client hands back a
 * `Headers` object with a `get`, the AWS SDK a plain lowercase-keyed record on
 * `$response.headers`. Both are read so a throttled Bedrock call honours the
 * wait AWS asked for instead of falling back to our blind backoff.
 * @param error - The error thrown by the provider's client.
 */
function requestedRetryDelayMs(error: unknown): number | null {
  const candidate = error as {
    headers?: { get?: (name: string) => string | null };
    $response?: { headers?: Record<string, string | undefined> };
  } | null;
  const rawValue = candidate?.headers?.get?.('retry-after')
    ?? candidate?.$response?.headers?.['retry-after'];
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
 * do its own retrying, and the backend switches it off for that reason —
 * otherwise both layers retry the same request without knowing about each
 * other, turning five attempts into fifteen and multiplying the waits between
 * them. That makes a rate limit worse rather than better.
 *
 * When the provider says how long to wait, we wait that long. Otherwise the wait
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
        waitAskedForByProvider: requestedDelayMs !== null,
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

export type EmbedOptions = {
  orgId: string;
  /** Tag on the trace: 'ingest' | 'query' | etc. */
  purpose: 'ingest' | 'query' | 'rerank';
  /** Optional source-slug for trace tagging. */
  sourceSlug?: string;
};

/**
 * Embed a batch of strings. Returns vectors in the same order as the
 * input. Splits into the backend's batch size under the hood.
 * @param texts
 * @param opts
 */
export async function embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  // Demo sandbox replay: never call the provider. Recorded vectors come back
  // exactly; unrecorded text gets a deterministic pseudo-vector so
  // retrieval stays functional (stable, if arbitrary, ranking).
  //
  // The model id comes from the environment alone here, not from the
  // workspace's stored setting, because this path deliberately touches no
  // database: replay exists for a sandbox that may have no project row and no
  // credential to decrypt. The consequence is narrow — the model only keys the
  // cache, so a workspace that pinned a provider through workspace.yaml reads
  // and writes recordings under the env-resolved model instead. Recorded
  // vectors still replay exactly; unrecorded text still gets a pseudo-vector.
  if (llmMode() === 'replay') {
    const replayModel = resolveEmbeddingModel(resolveEmbeddingProvider());
    return texts.map((text) => {
      const cached = readEntry<number[]>('embeddings', hashKey(replayModel, text));
      return cached ?? pseudoVector(text);
    });
  }
  // Resolved once for the whole call: every batch below belongs to the same
  // org, so one credential lookup covers them all.
  const backend = await embeddingBackendForOrg(opts.orgId);
  const trace = traceFor({
    feature: FEATURES.RETRIEVAL_EMBED,
    slug: opts.sourceSlug ?? opts.purpose,
    orgId: opts.orgId,
    userId: 'system',
    input: { count: texts.length, model: backend.model, provider: backend.provider },
    metadata: { purpose: opts.purpose },
  });
  const out: number[][] = [];
  let totalTokens = 0;
  try {
    for (let i = 0; i < texts.length; i += backend.batchSize) {
      const batch = texts.slice(i, i + backend.batchSize);
      const batchNumber = i / backend.batchSize;
      // Record each attempt as its own step, rather than wrapping the whole
      // retry loop in one. Wrapping counted our own waiting as the provider's
      // response time, so a rate-limited batch showed up on
      // /dashboard/observability as the provider having slowed to a minute —
      // sending you to look at the provider when the real problem is being
      // throttled. Per attempt, the timings are the real request times and the
      // retries are visible as separate steps instead of hiding inside one slow
      // one.
      const result = await sendWithRetries(async (attempt) => {
        const generation = trace.generation({
          // The first attempt keeps the original name so existing charts and
          // queries still match; only retries get a suffix.
          name: attempt === 1 ? `embed-batch-${batchNumber}` : `embed-batch-${batchNumber}-retry-${attempt - 1}`,
          model: backend.model,
          input: { count: batch.length },
        });
        try {
          const response = await backend.embedBatch(batch);
          totalTokens += response.inputTokens;
          generation.end({
            output: `${batch.length} vectors`,
            usageDetails: { input: response.inputTokens, total: response.inputTokens },
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
      // Placed by position within the batch, which the backend guarantees
      // matches the order the texts went in. A backend that leaves a hole is
      // caught by the gap check below.
      for (let offset = 0; offset < result.vectors.length; offset++) {
        const vector = result.vectors[offset];
        const text = batch[offset];
        if (!vector) {
          continue;
        }
        out[i + offset] = vector;
        // Demo sandbox record: persist per-text vectors for exact replay.
        if (llmMode() === 'record' && text !== undefined) {
          writeEntry('embeddings', hashKey(backend.model, text), vector);
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
    void flushTraces();
  }
  return out;
}
