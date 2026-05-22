/**
 * Reranker — second-stage pass over top-K hybrid candidates.
 *
 * Default implementation: an LLM-based listwise reranker that asks a
 * small/fast model to score each candidate for relevance to the
 * query. This deliberately avoids a vendor dependency (Cohere /
 * Voyage rerank) because:
 *
 *   - we keep the OSS install path minimal (one API key, OpenAI;
 *     Anthropic for the agent is already required)
 *   - rerank quality at K=20 is not the bottleneck — chunking +
 *     hybrid fusion dominate retrieval quality
 *   - the pluggable interface below lets M.2 (caching) swap in a
 *     real cross-encoder when we want it
 *
 * Tracing: each rerank call opens a `retrieval.rerank` generation
 * span so we can attribute the few hundred input tokens per query.
 */

import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import type { SearchHit } from '@/services/RetrievalService';

const RERANK_MODEL = process.env.VOCION_RERANK_MODEL ?? 'claude-haiku-4-5-20251001';
const RERANK_MAX_CANDIDATES = 20;
const RERANK_MAX_KEPT = 8;

let _client: ChatAnthropic | null = null;
function client(): ChatAnthropic {
  if (!_client) {
    _client = new ChatAnthropic({
      model: RERANK_MODEL,
      temperature: 0,
      maxTokens: 512,
    });
  }
  return _client;
}

export type RerankOptions = {
  orgId: string;
  /** Tag-only — used to thread the rerank trace under its parent. */
  parentSlug?: string;
  /** Max kept after rerank. Defaults to 8. */
  keep?: number;
};

/**
 * Rerank the candidate list against the query. Returns a new array
 * of hits, sorted by the model's relevance scores, truncated to
 * `keep`. If the rerank call fails for any reason we return the
 * input hits unchanged — better to ship the first-stage ranking
 * than to drop retrieval on the floor.
 */
export async function rerank(
  query: string,
  candidates: SearchHit[],
  opts: RerankOptions,
): Promise<SearchHit[]> {
  const keep = Math.min(opts.keep ?? RERANK_MAX_KEPT, candidates.length);
  if (candidates.length <= 1) {
    return candidates;
  }
  const items = candidates.slice(0, RERANK_MAX_CANDIDATES);
  const trace = traceFor({
    feature: FEATURES.RETRIEVAL_RERANK,
    slug: opts.parentSlug ?? 'rerank',
    orgId: opts.orgId,
    userId: 'system',
    input: { query, candidates: items.length, keep },
  });
  const gen = trace.generation({
    name: 'rerank',
    model: RERANK_MODEL,
  });

  // Listwise prompt: paste numbered candidates, ask for a JSON array
  // of ids in relevance order. Cheap because each candidate is
  // truncated to the first ~400 chars.
  const prompt
    = `You are a search reranker. Given a query and a list of candidate passages,`
      + ` return a JSON array of the candidate ids in order from MOST to LEAST relevant.`
      + ` Only include the top ${keep} ids. Return ONLY the JSON array, no prose.\n\n`
      + `Query: ${query}\n\nCandidates:\n${
        items
          .map((h, i) => `[${i}] (${h.title ?? h.sourceSlug}): ${h.content.slice(0, 400).replace(/\s+/g, ' ')}`)
          .join('\n')}`;

  let kept: SearchHit[];
  try {
    const res = await client().invoke([{ role: 'user', content: prompt }]);
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const match = text.match(/\[[\s\S]*?\]/);
    const order: number[] = match ? JSON.parse(match[0]) : [];
    const seen = new Set<number>();
    kept = order
      .filter(i => typeof i === 'number' && i >= 0 && i < items.length && !seen.has(i) && (seen.add(i) || true))
      .map(i => items[i]!)
      .slice(0, keep);
    // Anything the model missed → append in original order so we
    // never shorten more than `keep`.
    if (kept.length < keep) {
      for (const c of items) {
        if (kept.length >= keep) {
          break;
        }
        if (!kept.includes(c)) {
          kept.push(c);
        }
      }
    }
    gen.end({
      output: { reranked: kept.length },
      usageDetails: { input: prompt.length / 4 },
    });
    trace.update({ output: { reranked: kept.length } });
  } catch (err) {
    gen.end({
      level: 'ERROR',
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    trace.update({ output: { error: err instanceof Error ? err.message : String(err) } });
    return candidates.slice(0, keep);
  }
  return kept;
}
