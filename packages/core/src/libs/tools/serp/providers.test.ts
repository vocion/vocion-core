/**
 * The three SERP vendors, each read into the one shape from a recorded
 * response (fictional domains, real field names), and each spending the org's
 * own key before the server's. No test here reaches the network or the
 * credential store.
 */
import type { DataForSeoResponse, DataForSeoSerpResult, DataForSeoVolumeResult } from './dataforseo';
import type { SerpApiResponse } from './serpapi';
import type { SerperResponse } from './serper';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();
const resolveToolProviderCredential = vi.fn<(provider: string, orgId: string) => Promise<Record<string, string> | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (p: string, o: string) => resolveToolProviderKey(p, o),
  resolveToolProviderCredential: (p: string, o: string) => resolveToolProviderCredential(p, o),
}));

const { normaliseSerper, serperProvider } = await import('./serper');
const { normaliseSerpApi, serpApiProvider } = await import('./serpapi');
const { dataForSeoProvider, dfsLocation, normaliseDataForSeo, normaliseDataForSeoIdeas, normaliseDataForSeoVolume } = await import('./dataforseo');
const { ProviderNotConfiguredError } = await import('../types');

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as T;
}

const AT = new Date('2026-10-27T14:05:12Z');
const ENV = ['SERPER_API_KEY', 'SERPAPI_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resolveToolProviderKey.mockReset().mockResolvedValue(null);
  resolveToolProviderCredential.mockReset().mockResolvedValue(null);
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

describe('Serper', () => {
  it('reads organic results, the answer box, People Also Ask and related searches', () => {
    const serp = normaliseSerper({ query: 'wide hiking boots' }, fixture<SerperResponse>('serper-search.json'), AT);

    expect(serp).toMatchObject({ provider: 'serper', isGoogleRanking: true, location: 'Denver, Colorado, United States', language: 'en', country: 'us', retrievedAt: AT.toISOString(), billedUnits: 1, adsCount: null });
    expect(serp.organic.map(r => [r.position, r.domain])).toEqual([[1, 'northwind-outfitters.example'], [2, 'contoso-supply.example'], [3, 'acme-trail-journal.example']]);
    expect(serp.organic[0]!.date).toBe('Jul 19, 2026');
    expect(serp.featuredSnippet?.url).toBe('https://northwind-outfitters.example/guides/wide-hiking-boots');
    expect(serp.peopleAlsoAsk).toEqual([
      { question: 'What hiking boots are best for wide feet?', snippet: 'Boots with a wide toe box and a stretchable upper.', url: 'https://acme-trail-journal.example/fit/wide-feet' },
      { question: 'Should hiking boots be a size bigger?' },
    ]);
    expect(serp.relatedSearches).toEqual(['wide hiking boots women', 'waterproof wide hiking boots']);
  });

  it('says it read the desktop page when mobile was asked for', () => {
    const serp = normaliseSerper({ query: 'q', device: 'mobile' }, {}, AT);

    expect(serp.device).toBe('desktop');
    expect(serp.note).toMatch(/desktop/);
  });

  it('maps gl, hl, location and num, and sends the org\'s own key first', async () => {
    resolveToolProviderKey.mockResolvedValue('serper-org-key');
    process.env.SERPER_API_KEY = 'serper-server-key';
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(fixture('serper-search.json'))));
    vi.stubGlobal('fetch', fetchMock);

    await serperProvider().search({ query: 'wide hiking boots', country: 'US', language: 'EN', location: 'Denver, Colorado, United States', num: 20 }, { orgId: 'org_a' });

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://google.serper.dev/search');
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('serper-org-key');
    expect(JSON.parse(init.body as string)).toEqual({ q: 'wide hiking boots', gl: 'us', hl: 'en', location: 'Denver, Colorado, United States', num: 20 });
  });

  it('is not configured with no key anywhere', async () => {
    await expect(serperProvider().search({ query: 'q' }, { orgId: 'org_a' })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe('SerpApi', () => {
  it('reads organic results, related questions, ads and the processed time', () => {
    const serp = normaliseSerpApi({ query: 'wide hiking boots' }, fixture<SerpApiResponse>('serpapi-search.json'), AT);

    expect(serp).toMatchObject({ provider: 'serpapi', device: 'mobile', adsCount: 1, retrievedAt: '2026-10-27T14:05:12.000Z' });
    expect(serp.organic).toHaveLength(2);
    expect(serp.peopleAlsoAsk[0]).toEqual({ question: 'Should hiking boots be a size bigger?', snippet: 'Half a size, usually.', url: 'https://acme-trail-journal.example/fit/wide-feet' });
  });

  it('never repeats the key in an error', async () => {
    process.env.SERPAPI_API_KEY = 'serpapi-secret-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    await expect(serpApiProvider().search({ query: 'q' })).rejects.toThrow(/^SerpApi search failed: HTTP 401$/);
  });
});

describe('DataForSEO', () => {
  it('reads organic, featured snippet, People Also Ask, related searches and paid items', () => {
    const data = fixture<DataForSeoResponse<DataForSeoSerpResult>>('dataforseo-serp.json');
    const serp = normaliseDataForSeo({ query: 'wide hiking boots', location: 'Denver, Colorado, United States' }, data.tasks![0]!.result![0]!, AT, 1);

    expect(serp).toMatchObject({ provider: 'dataforseo', adsCount: 1, location: 'Denver,Colorado,United States', retrievedAt: '2026-10-27T14:05:12.000Z' });
    expect(serp.organic.map(r => [r.position, r.domain, r.date])).toEqual([[1, 'northwind-outfitters.example', '2026-07-19'], [2, 'contoso-supply.example', undefined]]);
    expect(serp.featuredSnippet?.snippet).toMatch(/wide toe box/);
    expect(serp.peopleAlsoAsk).toEqual([{ question: 'Should hiking boots be a size bigger?', snippet: 'Half a size, usually.', url: 'https://acme-trail-journal.example/fit/wide-feet' }]);
    expect(serp.relatedSearches).toEqual(['wide hiking boots women', 'waterproof wide hiking boots']);
  });

  it('reads search volume, CPC and competition, and keeps a missing volume missing', () => {
    const result = normaliseDataForSeoVolume(fixture<DataForSeoResponse<DataForSeoVolumeResult>>('dataforseo-volume.json'), { location: 'United States', language: 'en' }, AT);

    expect(result.metrics[0]).toMatchObject({ keyword: 'wide hiking boots', searchVolume: 9900, cpc: 1.42, competition: 'HIGH', competitionIndex: 100 });
    expect(result.metrics[0]!.monthly?.[0]).toEqual({ year: 2026, month: 9, searchVolume: 12100 });
    expect(result.metrics[1]).toMatchObject({ keyword: 'extra wide trail shoes', searchVolume: null });
  });

  it('turns a failed task into its own words, not an empty page', () => {
    expect(() => normaliseDataForSeoVolume({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field: \'location_name\'.' }] }, { location: 'x', language: 'en' }, AT)).toThrow(/Invalid Field/);
  });

  it('names locations the way DataForSEO does', () => {
    expect(dfsLocation('Denver, Colorado, United States')).toBe('Denver,Colorado,United States');
    expect(dfsLocation(undefined, 'gb')).toBe('United Kingdom');
    expect(dfsLocation()).toBe('United States');
  });

  it('signs with the org\'s stored login and password before the server\'s', async () => {
    resolveToolProviderCredential.mockResolvedValue({ login: 'org-login', password: 'org-pass' });
    process.env.DATAFORSEO_LOGIN = 'server-login';
    process.env.DATAFORSEO_PASSWORD = 'server-pass';
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(fixture('dataforseo-serp.json'))));
    vi.stubGlobal('fetch', fetchMock);

    const serp = await dataForSeoProvider().search({ query: 'wide hiking boots', num: 20, device: 'mobile' }, { orgId: 'org_a' });

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('org-login:org-pass').toString('base64')}`);
    expect(JSON.parse(init.body as string)).toEqual([{ keyword: 'wide hiking boots', location_name: 'United States', language_code: 'en', device: 'mobile', depth: 20 }]);
    expect(serp.billedUnits).toBe(2);
  });
});

describe('the local pack', () => {
  const PACK = [
    { position: 1, name: 'Northwind Home Services', rating: 4.8, reviews: 212, category: 'Plumber', website: 'https://www.northwind-home.example/', domain: 'northwind-home.example', address: '120 Example St, Fairview' },
    { position: 2, name: 'Lakeside Plumbing Co', rating: 4.6, reviews: 1204, category: 'Water heater installation service', website: 'https://lakeside-plumbing.example/water-heaters', domain: 'lakeside-plumbing.example', address: '45 Oak Ave, Lakeside' },
    { position: 3, name: 'Fairview Rooter & Drain', category: 'Plumber', address: '8 Market Rd, Fairview' },
  ];

  it('reads Serper\'s places, numbers given as text included', () => {
    const serp = normaliseSerper({ query: 'water heater repair fairview' }, fixture<SerperResponse>('serper-local.json'), AT);

    expect(serp.localPack).toEqual(PACK);
  });

  it('reads SerpApi\'s local results', () => {
    const serp = normaliseSerpApi({ query: 'water heater repair fairview' }, fixture<SerpApiResponse>('serpapi-local.json'), AT);

    expect(serp.localPack).toEqual(PACK);
    expect(normaliseSerpApi({ query: 'q' }, { local_results: [{ title: 'Northwind Home Services', rating: 4.8 }] }, AT).localPack).toEqual([{ position: 1, name: 'Northwind Home Services', rating: 4.8 }]);
  });

  it('reads DataForSEO\'s local_pack items, which carry no address or category, and keeps them out of organic', () => {
    const data = fixture<DataForSeoResponse<DataForSeoSerpResult>>('dataforseo-local.json');
    const serp = normaliseDataForSeo({ query: 'water heater repair fairview' }, data.tasks![0]!.result![0]!, AT, 1);

    expect(serp.localPack).toEqual([
      { position: 1, name: 'Northwind Home Services', rating: 4.8, reviews: 212, website: 'https://www.northwind-home.example/', domain: 'northwind-home.example' },
      { position: 2, name: 'Lakeside Plumbing Co', rating: 4.6, reviews: 1204, website: 'https://lakeside-plumbing.example/water-heaters', domain: 'lakeside-plumbing.example' },
      { position: 3, name: 'Fairview Rooter & Drain' },
    ]);
    expect(serp.organic.map(r => r.domain)).toEqual(['yelp.com', 'northwind-home.example']);
  });

  it('is empty, not missing, when the page shows none', () => {
    expect(normaliseSerper({ query: 'q' }, {}, AT).localPack).toEqual([]);
    expect(normaliseSerpApi({ query: 'q' }, {}, AT).localPack).toEqual([]);
  });
});

describe('DataForSEO keyword ideas', () => {
  it('reads Google Ads ideas, highest volume first, without the seeds or repeats', () => {
    const result = normaliseDataForSeoIdeas(fixture<DataForSeoResponse<DataForSeoVolumeResult>>('dataforseo-ideas.json'), { location: 'United States', language: 'en', seeds: ['water heater repair'] }, AT);

    expect(result.ideas.map(i => [i.keyword, i.searchVolume])).toEqual([['water heater leaking', 22200], ['tankless water heater repair', 2400], ['hot water heater pilot light', null]]);
    expect(result.ideas[0]!.monthly).toEqual([{ year: 2026, month: 9, searchVolume: 24000 }]);
  });

  it('asks keywords_for_keywords with at most 20 seeds', async () => {
    process.env.DATAFORSEO_LOGIN = 'server-login';
    process.env.DATAFORSEO_PASSWORD = 'server-pass';
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(fixture('dataforseo-ideas.json'))));
    vi.stubGlobal('fetch', fetchMock);
    const seeds = Array.from({ length: 25 }, (_, i) => `seed ${i}`);

    const result = await dataForSeoProvider().keywordIdeas!(seeds, { location: 'Fairview, Oregon, United States' });

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live');
    expect(JSON.parse(init.body as string)[0]).toMatchObject({ location_name: 'Fairview,Oregon,United States', language_code: 'en', sort_by: 'search_volume' });
    expect(JSON.parse(init.body as string)[0].keywords).toHaveLength(20);
    expect(result.seeds).toHaveLength(20);
  });
});
