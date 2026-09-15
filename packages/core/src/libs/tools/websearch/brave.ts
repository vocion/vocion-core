import type { WebSearchProvider, WebSearchResult } from './types';
import process from 'node:process';
import { resolveToolProviderKey } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';

/**
 * Brave Search API. https://brave.com/search/api/
 *
 * Spends the org's own subscription token when it has stored one, so search
 * spend lands on the customer's account. Falls back to `BRAVE_API_KEY`.
 */
export function braveProvider(): WebSearchProvider {
  const requiredEnv = ['BRAVE_API_KEY'];
  return {
    name: 'brave',
    requiredEnv,
    // Reports whether the *server* is configured; an org with its own token can
    // search even when this says no.
    isReady: () => Boolean(process.env.BRAVE_API_KEY),
    async search(query, opts) {
      const orgKey = opts?.orgId ? await resolveToolProviderKey('brave', opts.orgId) : null;
      const apiKey = orgKey ?? process.env.BRAVE_API_KEY;
      if (!apiKey) {
        throw new ProviderNotConfiguredError('web_search', 'brave', requiredEnv);
      }
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(opts?.count ?? 5, 10)));
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
      });
      if (!res.ok) {
        throw new Error(`brave search failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
      }
      const data = (await res.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
      };
      return (data.web?.results ?? []).map((r): WebSearchResult => ({
        title: r.title ?? r.url ?? 'Untitled',
        url: r.url ?? '',
        snippet: r.description ?? '',
        publishedAt: r.age,
      }));
    },
  };
}
