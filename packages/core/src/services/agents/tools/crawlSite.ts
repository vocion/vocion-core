/**
 * crawl_site — same-origin BFS crawl of a site, returning a digest of the
 * pages found. Capped depth + page count. Uses the active browse provider.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { bfsCrawl } from '@/libs/tools/browse/crawl';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { ProviderNotConfiguredError } from '@/libs/tools/types';

const PER_PAGE_CHARS = 1_200;

export function crawlSiteTool(_ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { start_url, max_depth, max_pages } = args;
      try {
        const provider = getBrowseProvider();
        const pages = await bfsCrawl(provider, start_url, {
          maxDepth: max_depth ?? 1,
          maxPages: max_pages ?? 20,
        });
        if (pages.length === 0) {
          return `Crawl of ${start_url} returned no readable pages.`;
        }
        const digest = pages
          .map((p, i) => `${i + 1}. ${p.title}\n   ${p.url}\n   ${p.content.slice(0, PER_PAGE_CHARS).replace(/\s+/g, ' ').trim()}…`)
          .join('\n\n');
        return `Crawled ${pages.length} page(s) from ${start_url}:\n\n${digest}`;
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) {
          return `Browse is not configured (${err.message}).`;
        }
        return `Could not crawl ${start_url}: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'crawl_site',
      description:
        'Crawl a website (same-origin, breadth-first) starting from a URL and return a digest of each page. Use to survey a site or docs section. Depth and page count are capped.',
      schema: z.object({
        start_url: z.string().url().describe('URL to start crawling from'),
        max_depth: z.number().int().min(0).max(3).optional().describe('Link depth to follow (default 1, max 3)'),
        max_pages: z.number().int().min(1).max(50).optional().describe('Max pages to fetch (default 20, max 50)'),
      }),
    },
  );
}
