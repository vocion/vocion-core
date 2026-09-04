/**
 * What a crawl does with the org it was given, and with a page that fails.
 *
 * Two failures here are invisible from the outside and worth a test each. A
 * crawl that drops the org bills the server for a workspace's pages. And a
 * crawl that swallows "this provider has no key" returns "no readable pages",
 * which reads as an empty site rather than as configuration the workspace can
 * fix — `fetch_url` and `web_search` both say the true thing in that case.
 *
 * The provider is mocked; no test here reaches the network.
 */
import type { BrowseProvider, Page } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderNotConfiguredError } from '../types';
import { bfsCrawl } from './crawl';

const fetchPage = vi.fn<(url: string, opts?: { orgId?: string }) => Promise<Page | null>>();

/** A provider whose every behaviour is the mock above. */
const provider = {
  name: 'firecrawl',
  requiredEnv: ['FIRECRAWL_API_KEY'],
  isReady: () => true,
  fetchPage: (url: string, opts?: { orgId?: string }) => fetchPage(url, opts),
} satisfies BrowseProvider;

const START_URL = 'https://example.com/start';

beforeEach(() => {
  fetchPage.mockReset();
  fetchPage.mockImplementation(async url => ({ url, title: 'A page', content: 'page text' }));
});

describe('a crawl run for an org', () => {
  it('hands the org to the page fetch', async () => {
    await bfsCrawl(provider, START_URL, { maxDepth: 0, maxPages: 1, orgId: 'org_crawl' });

    expect(fetchPage).toHaveBeenCalledWith(START_URL, { orgId: 'org_crawl' });
  });

  it('returns the pages it read', async () => {
    const pages = await bfsCrawl(provider, START_URL, { maxDepth: 0, maxPages: 1, orgId: 'org_crawl' });

    expect(pages.map(page => page.url)).toEqual([START_URL]);
  });
});

describe('a crawl whose provider has no key', () => {
  it('says so instead of reporting an empty site', async () => {
    fetchPage.mockRejectedValue(new ProviderNotConfiguredError('browse', 'firecrawl', ['FIRECRAWL_API_KEY']));

    await expect(bfsCrawl(provider, START_URL, { maxDepth: 0, maxPages: 1 }))
      .rejects
      .toThrow(ProviderNotConfiguredError);
  });
});

describe('a crawl where one page fails', () => {
  it('keeps going and returns the pages that worked', async () => {
    fetchPage.mockImplementation(async (url) => {
      if (url === START_URL) {
        throw new Error('502 from the origin');
      }
      return { url, title: 'A page', content: 'page text' };
    });

    const pages = await bfsCrawl(provider, START_URL, { maxDepth: 0, maxPages: 1 });

    expect(pages).toEqual([]);
  });
});
