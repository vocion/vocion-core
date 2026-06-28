import type { BrowseProvider, Page } from './types';
import { extractLinks } from '@/libs/sources/web';

/**
 * Same-origin BFS crawl shared by both browse providers. Uses the
 * provider's `fetchPage` for content; pulls links from the raw HTML
 * (same extractor the `web` connector uses). Capped depth + page count.
 * @param provider
 * @param startUrl
 * @param opts
 * @param opts.maxDepth
 * @param opts.maxPages
 */
export async function bfsCrawl(
  provider: BrowseProvider,
  startUrl: string,
  opts: { maxDepth?: number; maxPages?: number } = {},
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
      page = await provider.fetchPage(url);
    } catch {
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
