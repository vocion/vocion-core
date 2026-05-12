import type { RawDoc } from '../search';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { search } from '@/libs/onyx/client';
import { renderDocLine, reRankResults, toSearchDocument } from '../search';

/**
 * search_everything — multi-query sweep across all sources, no source
 * filter. Use sparingly: this is the "broad cast" mode for when the
 * narrower tools have returned nothing.
 * @param ctx
 */
export function searchEverythingTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const topic = args.topic;
      const queries = args.queries ?? [topic];
      const seen = new Set<string>();
      const all: RawDoc[] = [];
      for (const q of queries.slice(0, 4)) {
        try {
          const r = await search({ query: q });
          for (const doc of (r.top_documents ?? r.results ?? []) as RawDoc[]) {
            const id = doc.document_id ?? doc.semantic_identifier ?? '';
            if (id && !seen.has(id)) {
              seen.add(id);
              all.push(doc);
            }
          }
        } catch {
          /* per-query error tolerated */
        }
      }
      if (all.length === 0) {
        return `No results found for "${topic}" across any connected sources.`;
      }
      const ranked = reRankResults(all, ctx.searchConfig).slice(0, 20);
      ctx.emit({ type: 'documents', documents: ranked.map(toSearchDocument) });

      const bySource = new Map<string, number>();
      for (const doc of ranked) {
        const s = doc.source_type ?? 'unknown';
        bySource.set(s, (bySource.get(s) ?? 0) + 1);
      }
      const sourceSummary = [...bySource.entries()].map(([s, n]) => `${n} from ${s}`).join(', ');

      return `Found ${ranked.length} results (${sourceSummary}):\n\n${ranked.map((d, i) => renderDocLine(d, i)).join('\n\n')}`;
    },
    {
      name: 'search_everything',
      description: 'Multi-query semantic search across ALL connected sources, no filter. Use after narrower tools (search_onyx, find_related_conversations) have come up empty.',
      schema: z.object({
        topic: z.string(),
        queries: z.array(z.string()).optional(),
      }),
    },
  );
}
