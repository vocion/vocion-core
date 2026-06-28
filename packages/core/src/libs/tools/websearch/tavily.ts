import type { WebSearchProvider, WebSearchResult } from './types';
import process from 'node:process';
import { ProviderNotConfiguredError } from '../types';

/**
 * Tavily — search built for LLM/agent consumption. Single key, returns
 * clean titles + snippets. https://docs.tavily.com/
 */
export function tavilyProvider(): WebSearchProvider {
  const requiredEnv = ['TAVILY_API_KEY'];
  return {
    name: 'tavily',
    requiredEnv,
    isReady: () => Boolean(process.env.TAVILY_API_KEY),
    async search(query, opts) {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new ProviderNotConfiguredError('web_search', 'tavily', requiredEnv);
      }
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: Math.min(opts?.count ?? 5, 10),
          search_depth: 'basic',
        }),
      });
      if (!res.ok) {
        throw new Error(`tavily search failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
      }
      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
      };
      return (data.results ?? []).map((r): WebSearchResult => ({
        title: r.title ?? r.url ?? 'Untitled',
        url: r.url ?? '',
        snippet: r.content ?? '',
        publishedAt: r.published_date,
      }));
    },
  };
}
