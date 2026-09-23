/**
 * crawl_site — how much of each page the digest hands the agent, and how far
 * it may go.
 *
 * The 1,200-character digest is a default for surveying a site, not a cap: an
 * agent reading a listing whose events sit past that point on each page has
 * to be able to ask for more, or it misses them. Depth and page count are the
 * agent's to choose for the same reason.
 *
 * The crawl itself is mocked; no test here reaches the network.
 */
import type { Page } from '@/libs/tools/browse/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bfsCrawl = vi.fn<(provider: unknown, startUrl: string, opts?: { maxDepth?: number; maxPages?: number; orgId?: string }) => Promise<Page[]>>();

vi.mock('@/libs/tools/browse/crawl', () => ({ bfsCrawl: (...args: Parameters<typeof bfsCrawl>) => bfsCrawl(...args) }));
vi.mock('@/libs/tools/browse/registry', () => ({ getBrowseProvider: () => ({ name: 'builtin' }) }));

const { crawlSiteTool } = await import('./crawlSite');

const ctx = { orgId: 'org_crawl' } as unknown as Parameters<typeof crawlSiteTool>[0];

/** A listing page whose last event sits well past the default digest. */
const LONG_PAGE: Page = {
  url: 'https://example.org/events',
  title: 'Events',
  content: `${'Tuesday Bluegrass, 7pm. '.repeat(100)}Saturday Contra Dance, 8pm.`,
};

beforeEach(() => {
  bfsCrawl.mockReset();
  bfsCrawl.mockResolvedValue([LONG_PAGE]);
});

describe('crawl_site', () => {
  it('cuts each page to 1,200 characters when the agent asks for nothing else', async () => {
    const digest = String(await crawlSiteTool(ctx).invoke({ start_url: 'https://example.org/events' }));

    expect(digest).not.toContain('Saturday Contra Dance');
  });

  it('hands back as much of each page as the agent asks for', async () => {
    const digest = String(await crawlSiteTool(ctx).invoke({ start_url: 'https://example.org/events', chars_per_page: 10_000 }));

    expect(digest).toContain('Saturday Contra Dance');
  });

  it('passes depth and page counts past the old ceilings through to the crawl', async () => {
    // These were refused above 3 and 50, so a site with 80 detail pages
    // could never be surveyed in full.
    await crawlSiteTool(ctx).invoke({ start_url: 'https://example.org/events', max_depth: 5, max_pages: 200 });

    expect(bfsCrawl).toHaveBeenCalledWith(expect.anything(), 'https://example.org/events', expect.objectContaining({ maxDepth: 5, maxPages: 200 }));
  });
});
