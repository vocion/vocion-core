/**
 * Which SERP provider answers, and the honest fallback when none can: the
 * web search engine's results, labelled as not Google's ranking.
 */
import type { CachedKeyword, KeywordCacheStore } from './keywordCache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();
const resolveToolProviderCredential = vi.fn<(provider: string, orgId: string) => Promise<Record<string, string> | null>>();
const webSearch = vi.fn();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (p: string, o: string) => resolveToolProviderKey(p, o),
  resolveToolProviderCredential: (p: string, o: string) => resolveToolProviderCredential(p, o),
}));
vi.mock('@/libs/tools/websearch/registry', () => ({
  resolveWebSearchProviderName: () => 'brave',
  getWebSearchProvider: () => ({ name: 'brave', search: (...a: unknown[]) => webSearch(...a) }),
}));

const { keywordIdeas, keywordMetrics, searchSerp } = await import('./registry');
const { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } = await import('../types');

const ENV = ['VOCION_SERP_PROVIDER', 'VOCION_KEYWORD_DATA_PROVIDER', 'SERPER_API_KEY', 'SERPAPI_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resolveToolProviderKey.mockReset().mockResolvedValue(null);
  resolveToolProviderCredential.mockReset().mockResolvedValue(null);
  webSearch.mockReset().mockResolvedValue([{ title: 'Wide boots', url: 'https://www.contoso-supply.example/boots/wide', snippet: 'Shop wide boots.' }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
});

describe('searchSerp', () => {
  it('falls back to web search with no SERP key anywhere, and says it is not Google\'s ranking', async () => {
    const serp = await searchSerp({ query: 'wide hiking boots' }, { orgId: 'org_a' });

    expect(serp.provider).toBe('web_search:brave');
    expect(serp.isGoogleRanking).toBe(false);
    expect(serp.note).toMatch(/^Brave results, not Google's ranking/);
    expect(serp.organic[0]).toMatchObject({ position: 1, domain: 'contoso-supply.example' });
    expect(serp.billedUnits).toBe(0);
  });

  it('uses Serper when its key is set', async () => {
    process.env.SERPER_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ organic: [{ title: 'A', link: 'https://northwind-outfitters.example/a', position: 1 }], credits: 1 }))));

    const serp = await searchSerp({ query: 'q' });

    expect(serp.provider).toBe('serper');
    expect(webSearch).not.toHaveBeenCalled();
  });

  it('uses an org\'s own stored key for a provider the server has none for', async () => {
    resolveToolProviderKey.mockImplementation(async p => (p === 'serpapi' ? 'org-serpapi' : null));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ organic_results: [] }))));

    expect((await searchSerp({ query: 'q' }, { orgId: 'org_a' })).provider).toBe('serpapi');
  });

  it('refuses rather than falls back when only Google will do', async () => {
    await expect(searchSerp({ query: 'water heater repair fairview' }, { orgId: 'org_a', googleOnly: true })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect(webSearch).not.toHaveBeenCalled();
  });

  it('never falls back when the org\'s key could not be read', async () => {
    process.env.VOCION_SERP_PROVIDER = 'serper';
    resolveToolProviderKey.mockRejectedValue(new ToolProviderKeyUnavailableError('serper'));

    await expect(searchSerp({ query: 'q' }, { orgId: 'org_a' })).rejects.toBeInstanceOf(ToolProviderKeyUnavailableError);
    expect(webSearch).not.toHaveBeenCalled();
  });
});

describe('keywordMetrics', () => {
  /** A cache that holds nothing until written: each test starts cold. */
  function memory(): KeywordCacheStore & { rows: Map<string, CachedKeyword> } {
    const rows = new Map<string, CachedKeyword>();
    return {
      rows,
      get: async (_key, keywords) => keywords.flatMap(k => (rows.has(k) ? [rows.get(k)!] : [])),
      put: async (_key, list) => {
        for (const r of list) {
          rows.set(r.keyword, r);
        }
      },
    };
  }
  const volume = (keyword: string, n: number) => new Response(JSON.stringify({ status_code: 20000, cost: 0.075, tasks: [{ status_code: 20000, result: [{ keyword, search_volume: n }] }] }));
  const labsEmpty = () => new Response(JSON.stringify({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }));

  it('names every number it could not establish, and why, with nothing connected', async () => {
    process.env.VOCION_SERP_PROVIDER = 'serper';
    process.env.SERPER_API_KEY = 'k';

    const out = await keywordMetrics(['wide hiking boots'], {}, { orgId: 'org_a' }, memory());

    expect(out.ok).toBe(false);
    expect(!out.ok && out.missing).toEqual(['search volume', 'keyword difficulty', 'CPC', 'search intent', 'AI Overview presence']);
    expect(!out.ok && out.reason).toMatch(/^Could not establish search volume, keyword difficulty, CPC, search intent or AI Overview presence: no keyword data source is connected, and Serper reads Google's results page only\. Google Search Console \(free\)/);
    expect(!out.ok && out.reason).toMatch(/do not estimate them/);
  });

  it('asks DataForSEO whenever a DataForSEO login is held, Labs first', async () => {
    process.env.SERPER_API_KEY = 'k';
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('dataforseo_labs') ? labsEmpty() : volume('wide hiking boots', 9900))));

    const out = await keywordMetrics(['wide hiking boots'], {}, {}, memory());

    expect(out.ok && out.result.metrics[0]?.searchVolume).toBe(9900);
    expect(out.ok && out.result.provider).toBe('dataforseo');
  });

  it('buys nothing on the server\'s account when VOCION_KEYWORD_DATA_PROVIDER is none', async () => {
    process.env.VOCION_KEYWORD_DATA_PROVIDER = 'none';
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await keywordMetrics(['wide hiking boots'], {}, { orgId: 'org_a' }, memory());

    expect(out.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the workspace\'s Ahrefs and labels the source', async () => {
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    resolveToolProviderKey.mockImplementation(async p => (p === 'ahrefs' ? 'ahrefs-key' : null));
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ keywords: [{ keyword: 'wide hiking boots', volume: 8700, difficulty: 41 }] })));
    vi.stubGlobal('fetch', fetchMock);

    const out = await keywordMetrics(['wide hiking boots'], {}, { orgId: 'org_a' }, memory());

    expect(out.ok && out.result.provider).toBe('ahrefs');
    expect(out.ok && out.result.metrics[0]).toMatchObject({ searchVolume: 8700, kd: 41, source: 'ahrefs' });
    expect(fetchMock.mock.calls.every(([u]) => String(u).startsWith('https://api.ahrefs.com/'))).toBe(true);
  });

  it('falls back to DataForSEO when the Ahrefs plan refuses, and says so', async () => {
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    resolveToolProviderKey.mockImplementation(async p => (p === 'ahrefs' ? 'ahrefs-key' : null));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://api.ahrefs.com/')) {
        return new Response(JSON.stringify({ error: 'Insufficient plan' }), { status: 403 });
      }
      return url.includes('dataforseo_labs') ? labsEmpty() : volume('wide hiking boots', 9900);
    }));

    const out = await keywordMetrics(['wide hiking boots'], {}, { orgId: 'org_a' }, memory());

    expect(out.ok && out.result.provider).toBe('dataforseo');
    expect(out.ok && out.note).toMatch(/^Ahrefs refused this call: the workspace's Ahrefs plan does not include it\..* These numbers are DataForSEO's instead\.$/);
  });

  it('buys a keyword once a week: the second ask is answered from the cache', async () => {
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    const fetchMock = vi.fn(async (url: string) => (url.includes('dataforseo_labs') ? labsEmpty() : volume('wide hiking boots', 9900)));
    vi.stubGlobal('fetch', fetchMock);
    const store = memory();

    await keywordMetrics(['wide hiking boots'], {}, {}, store);
    const again = await keywordMetrics(['Wide  Hiking Boots'], {}, {}, store);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(again.ok && again.result).toMatchObject({ cachedKeywords: 1, billedUnits: 0 });
    expect(again.ok && again.result.metrics[0]).toMatchObject({ keyword: 'Wide  Hiking Boots', searchVolume: 9900 });
  });
});

describe('keywordIdeas', () => {
  it('says plainly that keyword ideas are not available on Serper', async () => {
    process.env.VOCION_SERP_PROVIDER = 'serper';
    process.env.SERPER_API_KEY = 'k';

    const out = await keywordIdeas(['water heater repair'], {});

    expect(out).toEqual({ ok: false, reason: expect.stringMatching(/^No keyword ideas: keyword ideas are not available on Serper, which has no keyword data\./) });
  });

  it('asks DataForSEO whenever a DataForSEO login is held', async () => {
    process.env.SERPER_API_KEY = 'k';
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ keyword: 'tankless water heater repair', search_volume: 2400 }] }] }))));

    const out = await keywordIdeas(['water heater repair'], {});

    expect(out.ok && out.result.ideas.map(i => i.keyword)).toEqual(['tankless water heater repair']);
  });
});
