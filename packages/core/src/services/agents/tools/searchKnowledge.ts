/**
 * search_knowledge — native pgvector retrieval tool (first-party).
 * LangChain `tool()` wrapper over `services/RetrievalService.search`.
 *
 *   - emits a `RawDoc` projection consumed by the chat sources sidebar
 *   - reRankResults() applies per-tenant source weights + discovery
 *     intent boosts on top of the hybrid RRF score
 *
 * `time_filter` is not yet wired (the chunker stores `last_modified_at`,
 * so it can be added without schema work — deferred until a prompt asks
 * for it). Source filter takes `knowledge_source.slug` values directly.
 */

import type { RawDoc } from '../search';
import type { RuntimeContext } from '../types';
import type { FacetFilter } from '@/libs/retrieval/facets';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { describeFacets, validateFacetFilter } from '@/libs/retrieval/facets';
import { search } from '@/services/RetrievalService';
import { renderDocLine, reRankResults, toSearchDocument } from '../search';
import { repeatNote, searchKey } from '../turnEvidence';

/** Hits shown when the agent's search config names no number: enough to judge, few enough to re-read every step. */
export const DEFAULT_SHOWN_HITS = 8;

export function searchKnowledgeTool(ctx: RuntimeContext) {
  const availableSources = ctx.connectorSources.join(', ');
  // The facets the agent's sources carry, read from their connectors
  // (`libs/retrieval/facets.ts`): a source's slug is its connector unless the
  // workspace named it otherwise.
  const connectors = new Set([...ctx.connectorSources, ...Object.values(ctx.sourceKinds ?? {})]);
  const facetNote = describeFacets(connectors);

  return tool(
    async (args) => {
      const { query, source_types, metadata_filters, facets, since } = args;
      const sourceFilter = source_types as string[] | undefined;
      if (facets) {
        const problems = validateFacetFilter(facets as FacetFilter);
        if (problems.length > 0) {
          return `Facet filter not applied: ${problems.map(p => p.message).join('; ')}. Correct it and search again.`;
        }
      }
      const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : undefined;
      // The same search twice in one turn — by the lead or a teammate it
      // consulted — is answered from the first (`turnEvidence.ts`).
      const key = searchKey('search_knowledge', { query, source_types, metadata_filters, facets, since });
      const prior = ctx.evidence?.searches.get(key);
      if (prior) {
        return repeatNote(prior);
      }
      const remember = (output: string, numbers: number[]): string => {
        ctx.evidence?.searches.set(key, { query, key, numbers, output, hits: numbers.length });
        return output;
      };

      // Discovery-call slugging: bias toward the meeting sources when the
      // query is about what was SAID on a call. This narrows rather than
      // restricts to one source — pinning it to `zoom` alone silently dropped
      // Granola notes (calls held on Teams/Meet) and excluded HubSpot from any
      // query containing the word "discovery" or "intro".
      let sourceSlugs = sourceFilter;
      if (!sourceSlugs && !facets && /\b(?:call|calls|meeting|meetings|zoom|transcript|recording)\b/i.test(query)) {
        sourceSlugs = ctx.connectorSources.filter(s => /^(?:zoom|granola|google-calendar)$/.test(s));
        if (sourceSlugs.length === 0) {
          sourceSlugs = undefined;
        }
      }

      let hits;
      try {
        hits = await search(query, {
          orgId: ctx.orgId,
          userId: ctx.userId ?? 'agent',
          mode: 'hybrid',
          k: ctx.searchConfig.maxResults ?? 15,
          sourceSlugs,
          // Per-user connection ACL — restricted sources drop out of this
          // user's retrieval even when the agent's scope includes them.
          allowedSourceSlugs: ctx.allowedSourceSlugs,
          // No LLM rerank inside the agent turn: deepagents' streamEvents taps
          // every nested model call, so the reranker's "[2,3,0,…]" id-ordering
          // output leaked into the chat response. Hybrid RRF + the heuristic
          // reRankResults below already order well; drop the LLM pass (also
          // cuts a full model round-trip of latency per search).
          rerank: false,
          ...(facets ? { facets: facets as FacetFilter } : {}),
          ...(sinceDate ? { since: sinceDate } : {}),
          onEvent: (e) => {
            // Project SearchEvent -> AgentEvent. The chat UI's
            // ThinkingPanel reads this to animate "Searching ·
            // 22 candidates · reranking..." in real time.
            switch (e.type) {
              case 'retrieval.started':
                ctx.emit({ type: 'retrieval_progress', stage: 'started', meta: { mode: e.mode } });
                break;
              case 'retrieval.candidates':
                ctx.emit({ type: 'retrieval_progress', stage: 'candidates', meta: { vector: e.vector, keyword: e.keyword } });
                break;
              case 'retrieval.fused':
                ctx.emit({ type: 'retrieval_progress', stage: 'fused', meta: { kept: e.kept } });
                break;
              case 'retrieval.reranking':
                ctx.emit({ type: 'retrieval_progress', stage: 'reranking', meta: { candidates: e.candidates } });
                break;
              case 'retrieval.complete':
                ctx.emit({ type: 'retrieval_progress', stage: 'complete', meta: { hits: e.hits } });
                break;
            }
          },
        });
      } catch (err) {
        return `Retrieval error: ${(err as Error).message ?? 'unknown'}`;
      }

      if (hits.length === 0) {
        return remember(facets
          ? `Nothing in the synced index matches ${JSON.stringify(facets)}${sinceDate ? ` since ${sinceDate.toISOString()}` : ''}. That is the complete answer for that state: do not search again with other phrases.`
          : 'No results found for this query.', []);
      }

      // Project SearchHit → RawDoc so the existing rerank + sidebar
      // emitter logic keeps working without conditionals downstream.
      const rawDocs: RawDoc[] = hits.map(h => ({
        document_id: String(h.documentId),
        semantic_identifier: h.title ?? `chunk-${h.chunkIdx}`,
        link: h.uri ?? '',
        source_type: h.sourceSlug,
        blurb: h.content,
        content: h.content,
        score: h.score,
        // The document's OWN date and metadata, not just this chunk's
        // debugging numbers. Dropping them was one bug that read as four:
        // undated hits (so the model could not tell a stale calendar event
        // from today's), a recency decay that never applied, a `call_type`
        // boost that never fired, and `metadata_filters` — a documented
        // argument on this tool — that could never match, because the only
        // keys present were `chunkIdx`, `vector` and `keyword`.
        updated_at: h.updatedAt?.toISOString(),
        metadata: { ...h.metadata, chunkIdx: h.chunkIdx, ...h.scores },
      }));

      // Client-side metadata filter (apply after retrieval — pgvector
      // doesn't push metadata predicates yet; small candidate set so
      // it's cheap).
      let filteredDocs = rawDocs;
      if (metadata_filters) {
        const entries = Object.entries(metadata_filters);
        filteredDocs = rawDocs.filter(d =>
          entries.every(([k, v]) => String((d.metadata ?? {})[k] ?? '') === String(v)),
        );
      }

      const discoveryIntent = /\b(?:discovery|intro|prospect)\b/i.test(query);
      const maxResults = ctx.searchConfig.maxResults ?? DEFAULT_SHOWN_HITS;
      // One hit per document: two chunks of one email are one source to cite,
      // and the second only repeats the first's context.
      const seenDocs = new Set<string>();
      const docs = reRankResults(filteredDocs, ctx.searchConfig, { wantsDiscovery: discoveryIntent })
        .filter(d => !d.document_id || (seenDocs.has(d.document_id) ? false : (seenDocs.add(d.document_id), true)))
        .slice(0, maxResults);

      // Allocate a contiguous global citation block for THIS search so the
      // [n] numbers stay unique across multiple searches in one turn — the
      // model is instructed to cite them inline and the UI maps [n] → source.
      // A source this turn already numbered keeps its number.
      const known = new Map([...(ctx.evidence?.sources.values() ?? [])].filter(s => s.documentId).map(s => [s.documentId!, s.n]));
      const shown = docs.slice(0, 15);
      const numbered = shown.map((d) => {
        const already = d.document_id ? known.get(d.document_id) : undefined;
        if (already) {
          return { d, n: already, fresh: false };
        }
        ctx.citationSeq.current += 1;
        return { d, n: ctx.citationSeq.current, fresh: true };
      });
      const numbers = numbered.map(x => x.n);
      const fresh = numbered.filter(x => x.fresh);
      if (fresh.length > 0) {
        ctx.emit({ type: 'documents', documents: fresh.map(x => toSearchDocument(x.d, x.n)) });
      }

      const lines = shown.map((d, i) => renderDocLine(d, numbers[i]! - 1, new Date(), ctx.timeZone));
      return remember(lines.join('\n\n'), numbers);
    },
    {
      name: 'search_knowledge',
      description: `Search all ingested knowledge — docs, calls, files, and other connected sources. Use natural language queries; retrieval is hybrid (vector + keyword) so paraphrases and exact terms both work.${availableSources ? ` Available sources: ${availableSources}.` : ''}${facetNote ? ` ${facetNote}` : ''}`,
      schema: z.object({
        query: z.string().describe('Natural language search query — describe what you want conceptually'),
        source_types: z.array(z.string()).optional().describe(`Optional: limit to specific sources${availableSources ? ` (available: ${availableSources})` : ''}`),
        metadata_filters: z.record(z.string(), z.string()).optional().describe('Optional: filter by document metadata key-value pairs. Example: {"call_type": "discovery"} to find only discovery calls.'),
        facets: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.object({ since: z.string().optional(), until: z.string().optional() })]))
          .optional()
          .describe(facetNote
            ? 'Optional: filter on state stamped at sync (the facets named above), e.g. {"reply_state": "needs_my_reply", "category": "sales"}. A list matches any of its values. The query then ranks only the matching documents.'
            : 'Optional: filter on state stamped at sync. None of the connected sources carries any yet.'),
        since: z.string().optional().describe('Optional: only documents dated at or after this ISO date.'),
      }),
    },
  );
}
