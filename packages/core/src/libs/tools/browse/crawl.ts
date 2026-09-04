import type { BrowseProvider, Page } from './types';
import { extractLinks } from '@/libs/sources/web';
import { ProviderNotConfiguredError } from '../types';

/**
 * Same-origin BFS crawl shared by both browse providers. Uses the
 * provider's `fetchPage` for content; pulls links from the raw HTML
 * (same extractor the `web` connector uses). Capped depth + page count.
 * @param provider
 * @param startUrl
 * @param opts
 * @param opts.maxDepth
 * @param opts.maxPages
 * @param opts.orgId
 */
export async function bfsCrawl(
  provider: BrowseProvider,
  startUrl: string,
  opts: { maxDepth?: number; maxPages?: number; orgId?: string } = {},
): Promise<Page[]> {
  const maxDepth = Math.min(opts.maxDepth ?? 1, 3);
  const maxPages = Math.min(opts.maxPages ?? 20, 50);
  const startOrigin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const pages: Page[] = [];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) {
      continue;
    }
    visited.add(url);

    let page: Page | null = null;
    try {
      page = await provider.fetchPage(url, { orgId: opts.orgId });
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        // Not this page's problem — the provider has no key at all, so every
        // remaining page would fail the same way. Reporting "no readable
        // pages" here would read as an empty site rather than as
        // configuration the workspace can fix, which is what `fetch_url` and
        // `web_search` say in the same situation.
        throw error;
      }
      console.error('[browse/crawl] skipping a page that could not be read', { url, error });
      continue;
    }
    if (!page) {
      continue;
    }
    pages.push(page);

    if (depth < maxDepth) {
      const html = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        .then(r => r.text())
        .catch(() => '');
      for (const href of extractLinks(html, url)) {
        try {
          const u = new URL(href, url);
          u.hash = '';
          if (u.origin === startOrigin && !visited.has(u.toString())) {
            queue.push({ url: u.toString(), depth: depth + 1 });
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }
  return pages;
}
