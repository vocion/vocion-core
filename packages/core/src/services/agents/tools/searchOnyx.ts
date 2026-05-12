import type { RawDoc } from '../search';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { search } from '@/libs/onyx/client';
import { renderDocLine, reRankResults, toSearchDocument } from '../search';

/**
 * search_onyx — primary retrieval tool.
 *
 * Ports the smart source / metadata / time filtering, intent detection,
 * and re-ranking from the legacy services/AgentService.ts:executeTool
 * switch. The Zod schema matches what the legacy OpenAI JSON-Schema
 * declared so prompts that mention the old shape keep working.
 * @param ctx
 */
export function searchOnyxTool(ctx: RuntimeContext) {
  const availableSources = ctx.connectorSources.join(', ');

  return tool(
    async (args) => {
      const { query, source_types, metadata_filters, time_filter } = args;

      let sourceFilter = source_types as string[] | undefined;
      let metaFilters = metadata_filters as Record<string, string> | undefined;

      // If the user mentioned calls/meetings without naming a source,
      // restrict to Zoom to avoid sweeping every connector.
      if (!sourceFilter) {
        if (/\b(call|calls|meeting|meetings|zoom|transcript|recording|discovery|intro)\b/i.test(query)) {
          sourceFilter = ['zoom'];
        }
      }
      // Discovery-call language → narrow by call_type metadata.
      if (!metaFilters) {
        if (/\b(discovery\s+call|discovery\s+calls|discovery\s+meeting|discovery\s+meetings)\b/i.test(query)) {
          metaFilters = { call_type: 'discovery' };
        }
      }

      let timeCutoff: string | undefined;
      if (time_filter) {
        const now = new Date();
        switch (time_filter) {
          case 'past_day': now.setDate(now.getDate() - 1); break;
          case 'past_week': now.setDate(now.getDate() - 7); break;
          case 'past_month': now.setMonth(now.getMonth() - 1); break;
        }
        timeCutoff = now.toISOString();
      }

      let results: { top_documents?: RawDoc[]; results?: RawDoc[] };
      try {
        results = await search({
          query,
          search_filters: (sourceFilter || timeCutoff)
            ? {
                ...(sourceFilter ? { source_type: sourceFilter } : {}),
                ...(timeCutoff ? { time_cutoff: timeCutoff } : {}),
              }
            : undefined,
          metadata_filters: metaFilters,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('503') || msg.includes('Vespa')) {
          return 'Search index is currently rebuilding after a system restart. Results are temporarily unavailable. The index should be ready in a few minutes.';
        }
        return `Search error: ${msg || 'unknown error'}`;
      }

      const rawDocs = results.top_documents ?? results.results ?? [];
      if (rawDocs.length === 0) {
        return 'No results found for this query.';
      }

      const discoveryIntent = /\b(discovery|intro|prospect)\b/i.test(query);
      const maxResults = ctx.searchConfig.maxResults ?? 15;
      const docs = reRankResults(rawDocs, ctx.searchConfig, { wantsDiscovery: discoveryIntent }).slice(0, maxResults);

      ctx.emit({ type: 'documents', documents: docs.slice(0, 15).map(toSearchDocument) });

      return docs.slice(0, 15).map((d, i) => renderDocLine(d, i)).join('\n\n');
    },
    {
      name: 'search_onyx',
      description: `Search all connected enterprise systems. Use natural language queries — the search is semantic, not keyword-based. Good queries describe what you're looking for conceptually, not exact field matches.${availableSources ? ` Available sources: ${availableSources}.` : ''}`,
      schema: z.object({
        query: z.string().describe('Natural language search query — describe what you want conceptually'),
        source_types: z.array(z.string()).optional().describe(`Optional: limit to specific sources${availableSources ? ` (available: ${availableSources})` : ''}`),
        metadata_filters: z.record(z.string(), z.string()).optional().describe('Optional: filter by document metadata key-value pairs. Example: {"call_type": "discovery"} to find only discovery calls.'),
        time_filter: z.enum(['past_day', 'past_week', 'past_month']).optional().describe('Optional: limit results to a recent time window.'),
      }),
    },
  );
}
