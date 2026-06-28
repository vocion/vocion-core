/**
 * web_search — live web search as an agent tool.
 *
 * Provider-pluggable (Tavily default; Brave; Anthropic-native reserved)
 * via `VOCION_WEBSEARCH_PROVIDER`. Degrades gracefully: if the provider
 * is unconfigured it returns a clear message rather than throwing, so the
 * agent can fall back to `search_knowledge` or tell the user.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ProviderNotConfiguredError } from '@/libs/tools/types';
import { getWebSearchProvider } from '@/libs/tools/websearch/registry';

export function webSearchTool(_ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { query, count } = args;
      let provider;
      try {
        provider = getWebSearchProvider();
      } catch (err) {
        return `Web search is unavailable: ${(err as Error).message}`;
      }
      try {
        const results = await provider.search(query, { count: count ?? 5 });
        if (results.length === 0) {
          return `No web results for "${query}".`;
        }
        return results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.publishedAt ? ` · ${r.publishedAt}` : ''}\n   ${r.snippet}`)
          .join('\n\n');
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) {
          return `Web search is not configured (${err.message}). Try \`search_knowledge\` for indexed sources instead.`;
        }
        return `Web search error: ${(err as Error).message ?? 'unknown'}`;
      }
    },
    {
      name: 'web_search',
      description:
        'Search the live public web and get back ranked titles, URLs, and snippets. Use for current events, external research, or anything not in the tenant\'s connected sources. For internal/ingested knowledge use search_knowledge instead.',
      schema: z.object({
        query: z.string().describe('The web search query'),
        count: z.number().int().min(1).max(10).optional().describe('How many results to return (default 5, max 10)'),
      }),
    },
  );
}
