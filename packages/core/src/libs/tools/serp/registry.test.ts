/**
 * Which SERP provider answers, and the honest fallback when none can: the
 * web search engine's results, labelled as not Google's ranking.
 */
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

const { keywordMetrics, searchSerp } = await import('./registry');
const { ToolProviderKeyUnavailableError } = await import('../types');

const ENV = ['VOCION_SERP_PROVIDER', 'SERPER_API_KEY', 'SERPAPI_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const;
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

  it('never falls back when the org\'s key could not be read', async () => {
    process.env.VOCION_SERP_PROVIDER = 'serper';
    resolveToolProviderKey.mockRejectedValue(new ToolProviderKeyUnavailableError('serper'));

    await expect(searchSerp({ query: 'q' }, { orgId: 'org_a' })).rejects.toBeInstanceOf(ToolProviderKeyUnavailableError);
    expect(webSearch).not.toHaveBeenCalled();
  });
});

describe('keywordMetrics', () => {
  it('says plainly that Serper gives no search volume', async () => {
    process.env.VOCION_SERP_PROVIDER = 'serper';
    process.env.SERPER_API_KEY = 'k';

    const out = await keywordMetrics(['wide hiking boots'], {});

    expect(out).toEqual({ ok: false, reason: expect.stringMatching(/^Could not establish volume: Serper gives no search volume\./) });
  });

  it('asks DataForSEO whenever a DataForSEO login is held', async () => {
    process.env.SERPER_API_KEY = 'k';
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ keyword: 'wide hiking boots', search_volume: 9900 }] }] }))));

    const out = await keywordMetrics(['wide hiking boots'], {});

    expect(out.ok && out.result.metrics[0]?.searchVolume).toBe(9900);
  });
});
