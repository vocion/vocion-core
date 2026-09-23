/**
 * crawl_site — same-origin BFS crawl of a site, returning a digest of the
 * pages found. Uses the active browse provider.
 *
 * Every limit here is a default the agent can raise: 1,200 characters per
 * page, depth 1, 20 pages. None has a ceiling. A digest cut at a fixed length
 * hides whatever sits past it on each page — for an events listing, the later
 * events — and a hard page ceiling drops the rest of a large site. The cost of
 * asking for more is prompt tokens, which the agent's instructions weigh.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { bfsCrawl } from '@/libs/tools/browse/crawl';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';

const DEFAULT_CHARS_PER_PAGE = 1_200;

export function crawlSiteTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { start_url, max_depth, max_pages, chars_per_page } = args;
      const charsPerPage = chars_per_page ?? DEFAULT_CHARS_PER_PAGE;
      try {
        const provider = getBrowseProvider();
        const pages = await bfsCrawl(provider, start_url, {
          maxDepth: max_depth ?? 1,
          maxPages: max_pages ?? 20,
          orgId: ctx.orgId,
        });
        if (pages.length === 0) {
          return `Crawl of ${start_url} returned no readable pages.`;
        }
        const digest = pages
          .map((p, i) => `${i + 1}. ${p.title}\n   ${p.url}\n   ${p.content.slice(0, charsPerPage).replace(/\s+/g, ' ').trim()}…`)
          .join('\n\n');
        return `Crawled ${pages.length} page(s) from ${start_url}:\n\n${digest}`;
      } catch (err) {
        if (err instanceof ToolProviderKeyUnavailableError) {
          // Deliberately not falling through to the server's key: this org may
          // hold one we simply could not read, and spending the deployment's
          // account instead would bill the wrong party silently.
          return `${err.message}. A workspace admin can re-enter it under API credentials.`;
        }
        if (err instanceof ProviderNotConfiguredError) {
          return `Browse is not configured (${err.message}).`;
        }
        return `Could not crawl ${start_url}: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'crawl_site',
      description:
        'Crawl a website (same-origin, breadth-first) starting from a URL and return a digest of each page. Use to survey a site or docs section. Depth, page count and characters per page are defaults you can raise.',
      schema: z.object({
        start_url: z.string().url().describe('URL to start crawling from'),
        max_depth: z.number().int().min(0).optional().describe('Link depth to follow (default 1)'),
        max_pages: z.number().int().min(1).optional().describe('Most pages to fetch (default 20)'),
        chars_per_page: z.number().int().min(1).optional().describe(`Characters of each page to return (default ${DEFAULT_CHARS_PER_PAGE}); raise it when what you need sits further down a page`),
      }),
    },
  );
}
