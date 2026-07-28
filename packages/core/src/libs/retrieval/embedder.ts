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
import OpenAI from 'openai';
import { langfuse, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { logger } from '@/libs/Logger';

const MODEL = process.env.VOCION_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const BATCH_SIZE = 100;

/**
 * How many times to try a single request, and how long to wait between tries.
 *
 * Ingest embeds several documents at once (see MAX_CONCURRENT_INGESTS in
 * SourceSyncService), so hitting OpenAI's rate limit is normal here rather
 * than rare. Without a retry, that document is counted as an error and
 * skipped — meaning it's missing from search, and the agent answers as if it
 * never existed. Retrying is what prevents losing it.
 *
 * Read on each call rather than at startup, so these can be changed without
 * rebuilding.
 */
function readRetrySettings(): { maxAttempts: number; baseDelayMs: number } {
  return {
    maxAttempts: readNumericSetting('VOCION_EMBED_MAX_ATTEMPTS', { fallback: 5, minimum: 1 }),
    baseDelayMs: readNumericSetting('VOCION_EMBED_RETRY_BASE_MS', { fallback: 500, minimum: 0 }),
  };
}

/**
 * Read a number from an environment variable, using the default if the value
 * is missing or doesn't make sense.
 *
 * `Number('eigth')` doesn't fail — it gives you NaN, which then breaks things
 * quietly. A NaN attempt count skips the retry loop, so nothing is ever sent.
 * A NaN delay makes `setTimeout` fire straight away, so there's no wait at all
 * between retries. Falling back to the default is better than either.
 * @param name - Environment variable to read.
 * @param bounds - The default, and the lowest value that makes sense.
 * @param bounds.fallback - Used when the variable is missing or unusable.
 * @param bounds.minimum - Anything below this is treated as unusable.
 */
function readNumericSetting(
  name: string,
  bounds: { fallback: number; minimum: number },
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return bounds.fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < bounds.minimum) {
    return bounds.fallback;
  }
  return parsed;
}

/**
 * Decide whether a failed request is worth sending again.
 *
 * Rate limits (429) and server errors (5xx) are temporary, so another
 * attempt can succeed. Any other 4xx means the request itself was wrong,
 * and repeating it would fail the same way every time.
 * @param error - The error thrown by the OpenAI client.
 */
function isTemporaryFailure(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status !== 'number') {
    return false;
  }
  return status === 429 || status >= 500;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Send one embedding request, retrying temporary failures with an
 * exponentially growing, randomized delay.
 *
 * The delay is randomized on purpose. Several documents embed at the same
 * time, so a rate limit tends to reject all of them at once. Waiting a
 * fixed amount would send every retry back at the same moment and trip the
 * same limit again; spreading them over a widening window avoids that.
 * @param sendRequest - Performs the request. Called once per attempt.
 */
async function sendWithRetries<T>(sendRequest: () => Promise<T>): Promise<T> {
  const { maxAttempts, baseDelayMs } = readRetrySettings();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendRequest();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts;
      if (!isTemporaryFailure(error) || isLastAttempt) {
        // Thrown on to the caller, which logs it with the document it belongs to.
        throw error;
      }
      // Wait somewhere between zero and a ceiling that doubles each attempt.
      const delayCeilingMs = baseDelayMs * 2 ** (attempt - 1);
      // Log every retry. These are swallowed by definition — the request
      // eventually succeeds and nobody hears about it — so without this a
      // sustained rate limit looks like nothing more than a slow sync.
      logger.warn('embedding request failed, retrying', {
        attempt,
        maxAttempts,
        delayCeilingMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(Math.random() * delayCeilingMs);
    }
  }
  // Unreachable — `maxAttempts` is always at least 1, so the loop above either
  // returns a result or throws. Kept so a future change to the loop bounds
  // surfaces as a real error rather than `throw undefined`, which would defeat
  // every `instanceof Error` check upstream.
  throw lastError ?? new Error('embedding retry loop ended without a result');
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set — embeddings require an OpenAI key. Set it on the running container or in .env.local.');
    }
    _client = new OpenAI({ apiKey });
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
      const generation = trace.generation({
        name: `embed-batch-${i / BATCH_SIZE}`,
        model: MODEL,
        input: { count: batch.length },
      });
      const res = await sendWithRetries(() => client().embeddings.create({
        model: MODEL,
        input: batch,
      }));
      const usage = res.usage ?? { prompt_tokens: 0, total_tokens: 0 };
      totalTokens += usage.total_tokens;
      generation.end({
        output: `${batch.length} vectors`,
        usageDetails: { input: usage.prompt_tokens, total: usage.total_tokens },
      });
      for (const item of res.data) {
        out[i + item.index] = item.embedding;
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
