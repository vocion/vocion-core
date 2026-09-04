/**
 * Which Firecrawl key a page fetch spends.
 *
 * Firecrawl is the paid browse provider — every page it renders costs a
 * credit — so an org that pasted its own key should be billed on its own
 * account. The server key stays the fallback.
 *
 * Firecrawl and the credential lookup are both mocked — no test here makes a
 * network call or touches the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The Authorization headers sent to Firecrawl, in call order. */
const sentAuthorizations: Array<string | undefined> = [];

const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
  sentAuthorizations.push(init?.headers?.Authorization);
  return {
    ok: true,
    json: async () => ({ data: { markdown: 'page text', metadata: { title: 'A page' } } }),
  };
});

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (provider: string, orgId: string) => resolveToolProviderKey(provider, orgId),
}));

const { firecrawlBrowseProvider } = await import('./firecrawl');
const { ProviderNotConfiguredError } = await import('../types');

const originalApiKey = process.env.FIRECRAWL_API_KEY;
const PAGE_URL = 'https://example.com/post';

beforeEach(() => {
  sentAuthorizations.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  resolveToolProviderKey.mockReset();
  resolveToolProviderKey.mockResolvedValue(null);
  process.env.FIRECRAWL_API_KEY = 'fc-ours';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) {
    delete process.env.FIRECRAWL_API_KEY;
  } else {
    process.env.FIRECRAWL_API_KEY = originalApiKey;
  }
});

describe('firecrawl provider choosing a key', () => {
  it('asks for the key of the org fetching the page', async () => {
    await firecrawlBrowseProvider().fetchPage(PAGE_URL, { orgId: 'org_browse' });

    expect(resolveToolProviderKey).toHaveBeenCalledWith('firecrawl', 'org_browse');
  });

  it('uses the org\'s stored key in preference to the environment', async () => {
    resolveToolProviderKey.mockResolvedValue('fc-theirs');

    await firecrawlBrowseProvider().fetchPage(PAGE_URL, { orgId: 'org_browse' });

    expect(sentAuthorizations[0]).toBe('Bearer fc-theirs');
  });

  it('falls back to the environment for an org that stored none', async () => {
    await firecrawlBrowseProvider().fetchPage(PAGE_URL, { orgId: 'org_browse' });

    expect(sentAuthorizations[0]).toBe('Bearer fc-ours');
  });

  it('skips the lookup entirely when the caller has no org in hand', async () => {
    await firecrawlBrowseProvider().fetchPage(PAGE_URL);

    expect(resolveToolProviderKey).not.toHaveBeenCalled();
    expect(sentAuthorizations[0]).toBe('Bearer fc-ours');
  });

  it('fetches on a stored key even when the server has none of its own', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    resolveToolProviderKey.mockResolvedValue('fc-theirs');

    await firecrawlBrowseProvider().fetchPage(PAGE_URL, { orgId: 'org_browse' });

    expect(sentAuthorizations[0]).toBe('Bearer fc-theirs');
  });

  it('refuses when neither the org nor the server has a key', async () => {
    delete process.env.FIRECRAWL_API_KEY;

    await expect(firecrawlBrowseProvider().fetchPage(PAGE_URL, { orgId: 'org_browse' }))
      .rejects
      .toThrow(ProviderNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks the key up once for a crawl of many pages', async () => {
    // `crawl_site` walks up to 50 pages through one provider instance. A
    // lookup per page is a database read plus a decrypt per page, for an
    // answer that cannot change inside a single crawl.
    resolveToolProviderKey.mockResolvedValue('fc-theirs');
    const provider = firecrawlBrowseProvider();

    await provider.fetchPage(`${PAGE_URL}/one`, { orgId: 'org_browse' });
    await provider.fetchPage(`${PAGE_URL}/two`, { orgId: 'org_browse' });
    await provider.fetchPage(`${PAGE_URL}/three`, { orgId: 'org_browse' });

    expect(resolveToolProviderKey).toHaveBeenCalledTimes(1);
    expect(sentAuthorizations).toEqual(['Bearer fc-theirs', 'Bearer fc-theirs', 'Bearer fc-theirs']);
  });

  it('never carries one org\'s key into the next org\'s fetch', async () => {
    resolveToolProviderKey.mockImplementation(async (_provider, orgId) =>
      orgId === 'org_first' ? 'fc-first' : 'fc-second');
    const provider = firecrawlBrowseProvider();

    await provider.fetchPage(PAGE_URL, { orgId: 'org_first' });
    await provider.fetchPage(PAGE_URL, { orgId: 'org_second' });

    expect(sentAuthorizations).toEqual(['Bearer fc-first', 'Bearer fc-second']);
  });
});
