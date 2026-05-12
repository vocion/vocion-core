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

const MODEL = process.env.VOCION_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const BATCH_SIZE = 100;

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
      const res = await client().embeddings.create({
        model: MODEL,
        input: batch,
      });
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
