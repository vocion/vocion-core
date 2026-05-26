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
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { search } from '@/services/RetrievalService';
import { renderDocLine, reRankResults, toSearchDocument } from '../search';

export function searchKnowledgeTool(ctx: RuntimeContext) {
  const availableSources = ctx.connectorSources.join(', ');

  return tool(
    async (args) => {
      const { query, source_types, metadata_filters } = args;
      const sourceFilter = source_types as string[] | undefined;

      // Discovery-call slugging: bias toward the `zoom` source when the
      // query mentions calls / meetings / transcripts.
      let sourceSlugs = sourceFilter;
      if (!sourceSlugs && /\b(?:call|calls|meeting|meetings|zoom|transcript|recording|discovery|intro)\b/i.test(query)) {
        sourceSlugs = ['zoom'];
      }

      let hits;
      try {
        hits = await search(query, {
          orgId: ctx.orgId,
          userId: ctx.userId ?? 'agent',
          mode: 'hybrid',
          k: ctx.searchConfig.maxResults ?? 15,
          sourceSlugs,
          rerank: true,
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
        return 'No results found for this query.';
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
        metadata: { chunkIdx: h.chunkIdx, ...h.scores },
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
      const maxResults = ctx.searchConfig.maxResults ?? 15;
      const docs = reRankResults(filteredDocs, ctx.searchConfig, { wantsDiscovery: discoveryIntent }).slice(0, maxResults);

      ctx.emit({ type: 'documents', documents: docs.slice(0, 15).map(toSearchDocument) });

      return docs.slice(0, 15).map((d, i) => renderDocLine(d, i)).join('\n\n');
    },
    {
      name: 'search_knowledge',
      description: `Search all ingested knowledge — docs, calls, files, and other connected sources. Use natural language queries; retrieval is hybrid (vector + keyword) so paraphrases and exact terms both work.${availableSources ? ` Available sources: ${availableSources}.` : ''}`,
      schema: z.object({
        query: z.string().describe('Natural language search query — describe what you want conceptually'),
        source_types: z.array(z.string()).optional().describe(`Optional: limit to specific sources${availableSources ? ` (available: ${availableSources})` : ''}`),
        metadata_filters: z.record(z.string(), z.string()).optional().describe('Optional: filter by document metadata key-value pairs. Example: {"call_type": "discovery"} to find only discovery calls.'),
      }),
    },
  );
}
