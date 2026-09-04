import type { BrowseProvider, Page } from './types';
import process from 'node:process';
import { resolveToolProviderKey } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';

/**
 * Firecrawl provider — renders JS-heavy pages and returns clean markdown.
 * Opt-in (paid) via VOCION_BROWSE_PROVIDER=firecrawl + FIRECRAWL_API_KEY.
 * https://docs.firecrawl.dev/
 *
 * Every page costs a credit, so an org that stored its own Firecrawl key
 * spends its own account. Falls back to `FIRECRAWL_API_KEY`.
 */
export function firecrawlBrowseProvider(): BrowseProvider {
  const requiredEnv = ['FIRECRAWL_API_KEY'];
  return {
    name: 'firecrawl',
    requiredEnv,
    // Reports whether the *server* is configured; an org with its own key can
    // fetch even when this says no.
    isReady: () => Boolean(process.env.FIRECRAWL_API_KEY),
    async fetchPage(url, opts): Promise<Page | null> {
      const orgKey = opts?.orgId ? await resolveToolProviderKey('firecrawl', opts.orgId) : null;
      const apiKey = orgKey ?? process.env.FIRECRAWL_API_KEY;
      if (!apiKey) {
        throw new ProviderNotConfiguredError('browse', 'firecrawl', requiredEnv);
      }
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      });
      if (!res.ok) {
        throw new Error(`firecrawl scrape failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
      }
      const data = (await res.json()) as {
        data?: { markdown?: string; metadata?: { title?: string } };
      };
      const content = data.data?.markdown ?? '';
      if (!content.trim()) {
        return null;
      }
      return { url, title: data.data?.metadata?.title ?? url, content };
    },
  };
}
