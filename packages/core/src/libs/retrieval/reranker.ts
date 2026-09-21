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

import type { SearchHit } from '@/services/RetrievalService';
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { resolveOrgProviderKey } from '@/libs/llm/orgKey';
import { tokenUsageOf } from '@/libs/llm/usage';

const RERANK_MODEL = process.env.VOCION_RERANK_MODEL ?? 'claude-haiku-4-5-20251001';
const RERANK_MAX_CANDIDATES = 20;
const RERANK_MAX_KEPT = 8;

/**
 * A rerank model for one org, on that org's own Anthropic key when it has
 * stored one and on the server's key otherwise.
 *
 * Built per call rather than cached. A cached model would hold the first org's
 * key and hand it to every org after it — the same cross-tenant leak the LLM
 * client cache was removed to avoid — and building one is cheap next to the
 * model call it precedes.
 * @param orgId - The org whose search is being reranked.
 */
async function modelForOrg(orgId: string): Promise<ChatAnthropic> {
  const apiKey = await resolveOrgProviderKey('anthropic', orgId) ?? process.env.ANTHROPIC_API_KEY;
  return new ChatAnthropic({
    model: RERANK_MODEL,
    temperature: 0,
    maxTokens: 512,
    ...(apiKey ? { apiKey } : {}),
  });
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
 * @param query
 * @param candidates
 * @param opts
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
  // Over a hard cap, skip the rerank instead of refusing the search. This is a
  // quality pass over a list that is already ranked, so dropping it costs the
  // person a slightly worse ordering — the same thing that happens when the
  // rerank call fails, handled the same way below. Refusing the search outright
  // over a few hundred tokens would be the wrong trade.
  // Imported here rather than at the top of the file: `BudgetService` reaches
  // the database handle, which validates the whole environment at import, and
  // this module is loaded by retrieval code that runs in tests and CLI scripts
  // with no database configured.
  const { chargeUsage, preflightCheck } = await import('@/services/BudgetService');
  const budget = await preflightCheck({ orgId: opts.orgId, feature: FEATURES.RETRIEVAL_RERANK });
  if (!budget.ok) {
    return candidates.slice(0, keep);
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
    const model = await modelForOrg(opts.orgId);
    const res = await model.invoke([{ role: 'user', content: prompt }]);
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
    // The provider's own count, or nothing.
    //
    // This used to fall back to `prompt.length / 4` — the rule of thumb that
    // English runs about four characters to a token. It was wrong for this
    // prompt in particular (chunked document text with punctuation and ids
    // tokenises denser than prose), it never counted the output at all, and
    // there is no way to make it exact: Anthropic publishes no tokenizer for
    // current Claude models, and their `count_tokens` endpoint is documented
    // as an estimate too. The only exact number is the one the response
    // reports.
    //
    // So a missing count now shows as missing. A successful non-streaming
    // `invoke` always carries `usage_metadata`, which makes an empty trace here
    // a real signal rather than a gap to paper over. The budget is charged from
    // these same numbers, so what it says and what the trace says cannot drift.
    const usage = tokenUsageOf(res);
    gen.end({
      output: { reranked: kept.length },
      usageDetails: usage ? cleanUsageDetails({ input: usage.inputTokens, output: usage.outputTokens }) : undefined,
    });
    if (usage) {
      await chargeUsage({
        orgId: opts.orgId,
        feature: FEATURES.RETRIEVAL_RERANK,
        model: RERANK_MODEL,
        usage,
      });
    }
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
