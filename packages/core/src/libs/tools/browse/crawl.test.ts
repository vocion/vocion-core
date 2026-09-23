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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '../types';
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

describe('a crawl whose key cannot be read', () => {
  it('stops instead of describing a site it never reached', async () => {
    // The seed page fails, so the queue drains and the crawl would otherwise
    // return zero pages — which `crawl_site` reports as "no readable pages".
    // A credential problem dressed as an empty website is the worst of both:
    // nobody fixes the key, and the model believes the site is bare.
    fetchPage.mockRejectedValue(new ToolProviderKeyUnavailableError('firecrawl'));

    await expect(bfsCrawl(provider, START_URL, { orgId: 'org_crawl' }))
      .rejects
      .toBeInstanceOf(ToolProviderKeyUnavailableError);
  });

  it('asks for the key once rather than once per queued page', async () => {
    // The lookup is a database read plus a decrypt. Swallowing the failure
    // would retry it for every page in the queue.
    fetchPage.mockRejectedValue(new ToolProviderKeyUnavailableError('firecrawl'));

    await expect(bfsCrawl(provider, START_URL, { maxPages: 50, orgId: 'org_crawl' })).rejects.toThrow();

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('how far a crawl goes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads as many pages as it was asked for, past the old ceiling of 50', async () => {
    // A listing with 80 detail pages lost 30 of them to a silent clamp.
    const detailLinks = Array.from({ length: 80 }, (_, index) => `<a href="/events/${index}">Event ${index}</a>`).join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html><body>${detailLinks}</body></html>`)));

    const pages = await bfsCrawl(provider, START_URL, { maxDepth: 1, maxPages: 81 });

    expect(pages).toHaveLength(81);
  });
});
