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
 *
 * One instance is built per tool call and `crawl_site` walks up to 50 pages
 * through it, so the org's key is looked up once per instance rather than once
 * per page — a database read plus a decrypt each time, for an answer that
 * cannot change inside a single crawl. The cache is keyed on the org, so a
 * second org's page never reads the first org's key, and a key rotated
 * mid-crawl is picked up by the next call rather than the next page.
 */
export function firecrawlBrowseProvider(): BrowseProvider {
  const requiredEnv = ['FIRECRAWL_API_KEY'];
  let lookedUp: { orgId: string; key: string | null } | null = null;

  /**
   * The org's stored key, looked up at most once for this instance.
   * @param orgId - The org the page is being fetched for.
   */
  async function orgKeyOnce(orgId: string): Promise<string | null> {
    if (lookedUp?.orgId !== orgId) {
      lookedUp = { orgId, key: await resolveToolProviderKey('firecrawl', orgId) };
    }
    return lookedUp.key;
  }

  return {
    name: 'firecrawl',
    requiredEnv,
    // Reports whether the *server* is configured; an org with its own key can
    // fetch even when this says no.
    isReady: () => Boolean(process.env.FIRECRAWL_API_KEY),
    async fetchPage(url, opts): Promise<Page | null> {
      const orgKey = opts?.orgId ? await orgKeyOnce(opts.orgId) : null;
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
