/**
 * Every tool that spends a vendor key hands its org down to the provider.
 *
 * The provider is what decides between the org's stored key and the server's
 * env var, and it can only do that if the tool tells it which org is calling.
 * A tool that drops the org silently bills the wrong account — nothing fails,
 * so only a test catches it.
 *
 * The providers themselves are mocked; these tests assert the wiring, not the
 * vendor call. No network, no database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn(async (_query: string, _opts?: { count?: number; orgId?: string }) => [
  { title: 'A page', url: 'https://example.com', snippet: 'text' },
]);
const fetchPage = vi.fn(async (url: string, _opts?: { orgId?: string }) => ({
  url,
  title: 'A page',
  content: 'page text',
}));

vi.mock('@/libs/tools/websearch/registry', () => ({
  getWebSearchProvider: () => ({ name: 'tavily', requiredEnv: [], isReady: () => true, search }),
}));

vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({ name: 'firecrawl', requiredEnv: [], isReady: () => true, fetchPage }),
}));

const { webSearchTool } = await import('./webSearch');
const { fetchUrlTool } = await import('./fetchUrl');
const { crawlSiteTool } = await import('./crawlSite');

/**
 * The smallest runtime context these tools read. Everything else on
 * `RuntimeContext` belongs to tools that are not under test here, so it is
 * left off rather than filled in with values no assertion looks at.
 */
const ctx = { orgId: 'org_tools', connectorSources: [] } as unknown as Parameters<typeof webSearchTool>[0];

beforeEach(() => {
  search.mockClear();
  fetchPage.mockClear();
});

describe('web_search', () => {
  it('hands the calling org to the search provider', async () => {
    await webSearchTool(ctx).invoke({ query: 'vocion' });

    expect(search).toHaveBeenCalledWith('vocion', expect.objectContaining({ orgId: 'org_tools' }));
  });

  it('still asks for the requested number of results', async () => {
    await webSearchTool(ctx).invoke({ query: 'vocion', count: 3 });

    expect(search).toHaveBeenCalledWith('vocion', expect.objectContaining({ count: 3 }));
  });
});

describe('fetch_url', () => {
  it('hands the calling org to the browse provider', async () => {
    await fetchUrlTool(ctx).invoke({ url: 'https://example.com/post' });

    expect(fetchPage).toHaveBeenCalledWith('https://example.com/post', { orgId: 'org_tools' });
  });
});

describe('crawl_site', () => {
  it('hands the calling org to every page the crawl fetches', async () => {
    await crawlSiteTool(ctx).invoke({ start_url: 'https://example.com', max_pages: 1 });

    expect(fetchPage).toHaveBeenCalledWith('https://example.com', { orgId: 'org_tools' });
  });
});
