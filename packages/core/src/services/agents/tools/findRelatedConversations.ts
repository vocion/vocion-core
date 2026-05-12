import type { RawDoc } from '../search';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { search } from '@/libs/onyx/client';
import { renderDocLine, reRankResults, toSearchDocument } from '../search';

/**
 * find_related_conversations — multi-query search restricted to
 * conversation sources (Gmail, Slack, HubSpot).
 * @param ctx
 */
export function findRelatedConversationsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const topic = args.topic;
      const queries = args.queries ?? [topic];
      const conversationSources = ['gmail', 'slack', 'hubspot'];

      const seen = new Set<string>();
      const all: RawDoc[] = [];
      for (const q of queries.slice(0, 4)) {
        try {
          const r = await search({ query: q, search_filters: { source_type: conversationSources } });
          for (const doc of (r.top_documents ?? r.results ?? []) as RawDoc[]) {
            const id = doc.document_id ?? doc.semantic_identifier ?? '';
            if (id && !seen.has(id)) {
              seen.add(id);
              all.push(doc);
            }
          }
        } catch {
          /* skip transient errors per-query */
        }
      }

      if (all.length === 0) {
        return `No related conversations found for "${topic}" in Gmail, Slack, or HubSpot.`;
      }

      const ranked = reRankResults(all, ctx.searchConfig).slice(0, 15);
      ctx.emit({ type: 'documents', documents: ranked.map(toSearchDocument) });
      return ranked.map((d, i) => renderDocLine(d, i)).join('\n\n');
    },
    {
      name: 'find_related_conversations',
      description: 'Multi-query semantic search restricted to conversation sources (Gmail, Slack, HubSpot). Use when you want to surface prior threads on a topic across communication channels — not formal records.',
      schema: z.object({
        topic: z.string().describe('canonical topic the queries are about (shown to the user)'),
        queries: z.array(z.string()).optional().describe('up to 4 phrasing variants for the same topic; if omitted, only `topic` is searched'),
      }),
    },
  );
}
