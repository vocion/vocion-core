/**
 * Keyword numbers from DataForSEO and Ahrefs, read from recorded responses
 * (fictional keywords and domains, the vendors' real field names): volume
 * and its last twelve months, difficulty, CPC, intent, SERP features and the
 * AI Overview with what it cites, each keyword with its source and date.
 * No test reaches the network or the credential store.
 */
import type { DataForSeoOverviewResult, DataForSeoResponse, DataForSeoSerpResult } from './dataforseo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveToolProviderKey = vi.fn<(provider: string, orgId: string) => Promise<string | null>>();
const resolveToolProviderCredential = vi.fn<(provider: string, orgId: string) => Promise<Record<string, string> | null>>();

vi.mock('@/libs/tools/orgKey', () => ({
  resolveToolProviderKey: (p: string, o: string) => resolveToolProviderKey(p, o),
  resolveToolProviderCredential: (p: string, o: string) => resolveToolProviderCredential(p, o),
}));

const { citedDomainsOf, dataForSeoProvider, dfsTime, LABS_OVERVIEW_MAX, normaliseDataForSeo, normaliseDataForSeoOverview } = await import('./dataforseo');
const { ahrefsBrandRadar, ahrefsCountry, ahrefsKeywordMetrics, ahrefsOrganicKeywords, AhrefsRefusedError } = await import('./ahrefs');
const { keywordRecordOf } = await import('./types');
const { ProviderNotConfiguredError } = await import('../types');

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as T;
}

const AT = new Date('2026-10-28T12:00:00Z');
const ENV = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const;
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

describe('DataForSEO Labs keyword overview', () => {
  it('reads volume, twelve months, difficulty, CPC, intent and SERP features, dated by DataForSEO', () => {
    const [boots, shoes] = normaliseDataForSeoOverview(fixture<DataForSeoResponse<DataForSeoOverviewResult>>('dataforseo-overview.json'), AT);

    expect(boots).toMatchObject({ keyword: 'wide hiking boots', searchVolume: 9900, cpc: 1.42, competition: 'HIGH', competitionIndex: 100, kd: 38, intent: 'commercial', source: 'dataforseo', checkedAt: '2026-10-20T06:12:44.000Z' });
    expect(boots!.monthly).toHaveLength(12);
    expect(boots!.monthly![0]).toEqual({ year: 2026, month: 9, searchVolume: 12100 });
    expect(boots!.serpFeatures).toEqual(['ai_overview', 'people_also_ask', 'related_searches', 'shopping']);
    expect(boots!.aiOverview).toEqual({ present: true, citedDomains: null, source: 'dataforseo', checkedAt: '2026-10-22T03:00:00.000Z' });
    // Nothing known stays unknown, never zero; the read's own date stands in.
    expect(shoes).toMatchObject({ keyword: 'extra wide trail shoes', searchVolume: 70, kd: null, intent: null, serpFeatures: null, aiOverview: null, checkedAt: AT.toISOString() });
  });

  it('reads the keyword in the register\'s shape', () => {
    const [boots] = normaliseDataForSeoOverview(fixture<DataForSeoResponse<DataForSeoOverviewResult>>('dataforseo-overview.json'), AT);

    expect(keywordRecordOf(boots!, AT.toISOString())).toEqual({
      keyword: 'wide hiking boots',
      volume: 9900,
      kd: 38,
      intent: 'commercial',
      cpc: 1.42,
      serp_features: ['ai_overview', 'people_also_ask', 'related_searches', 'shopping'],
      ai_overview: { present: true, cited_domains: null },
      source: 'dataforseo',
      checked_at: '2026-10-20T06:12:44.000Z',
    });
  });

  it('batches 700 keywords a task, fills what Labs has not seen from Google Ads, and adds up the cost', async () => {
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    const keywords = ['wide hiking boots', 'extra wide trail shoes', ...Array.from({ length: 900 }, (_, i) => `boot ${i}`)];
    const fetchMock = vi.fn(async (url: string, _init: RequestInit) => {
      if (url.includes('dataforseo_labs')) {
        return new Response(JSON.stringify(fixture('dataforseo-overview.json')));
      }
      return new Response(JSON.stringify({ status_code: 20000, cost: 0.075, tasks: [{ status_code: 20000, result: [{ keyword: 'boot 1', search_volume: 10 }] }] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await dataForSeoProvider().keywordMetrics!(keywords, {});

    const labs = fetchMock.mock.calls.filter(([u]) => u.includes('dataforseo_labs'));
    const ads = fetchMock.mock.calls.filter(([u]) => u.includes('google_ads/search_volume'));

    expect(labs.map(([, init]) => JSON.parse(init.body as string)[0].keywords.length)).toEqual([LABS_OVERVIEW_MAX, keywords.length - LABS_OVERVIEW_MAX]);
    expect(JSON.parse(labs[0]![1].body as string)[0]).toMatchObject({ location_name: 'United States', language_code: 'en', include_serp_info: true });
    // Only the 900 Labs did not return go to Google Ads.
    expect(JSON.parse(ads[0]![1].body as string)[0].keywords).toHaveLength(900);
    expect(r.metrics.map(m => m.keyword).slice(0, 3)).toEqual(['wide hiking boots', 'extra wide trail shoes', 'boot 1']);
    expect(r.metrics[2]).toMatchObject({ searchVolume: 10, kd: null, source: 'dataforseo' });
    expect(r.costUsd).toBeCloseTo(0.0102 * 2 + 0.075, 6);
    expect(r.billedUnits).toBe(3);
  });

  it('reads a city\'s volume from Google Ads and its difficulty from the country', async () => {
    process.env.DATAFORSEO_LOGIN = 'l';
    process.env.DATAFORSEO_PASSWORD = 'p';
    const fetchMock = vi.fn(async (url: string, _init: RequestInit) => url.includes('dataforseo_labs')
      ? new Response(JSON.stringify(fixture('dataforseo-overview.json')))
      : new Response(JSON.stringify({ status_code: 20000, cost: 0.075, tasks: [{ status_code: 20000, result: [{ keyword: 'wide hiking boots', search_volume: 320, cpc: 0.9 }] }] })));
    vi.stubGlobal('fetch', fetchMock);

    const r = await dataForSeoProvider().keywordMetrics!(['wide hiking boots'], { location: 'Denver, Colorado, United States' });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)[0].location_name).toBe('United States');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)[0].location_name).toBe('Denver,Colorado,United States');
    expect(r.metrics[0]).toMatchObject({ searchVolume: 320, cpc: 0.9, kd: 38, intent: 'commercial' });
  });

  it('says it is not configured with no login anywhere', async () => {
    await expect(dataForSeoProvider().keywordMetrics!(['q'], {})).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe('the AI Overview on a results page', () => {
  it('says it is there, names each domain it cites once, and bills the late read', () => {
    const data = fixture<DataForSeoResponse<DataForSeoSerpResult>>('dataforseo-serp-aio.json');
    const serp = normaliseDataForSeo({ query: 'how to fix a leaking water heater' }, data.tasks![0]!.result![0]!, AT, 1);

    expect(serp.aiOverview).toEqual({ present: true, citedDomains: ['lakeside-plumbing.example', 'northwind-home.example'], source: 'dataforseo', checkedAt: '2026-10-28T09:30:00.000Z' });
    expect(serp.serpFeatures).toEqual(['ai_overview', 'people_also_ask', 'video']);
    expect(serp.billedUnits).toBe(2);
  });

  it('says plainly when the page has none', () => {
    const data = fixture<DataForSeoResponse<DataForSeoSerpResult>>('dataforseo-serp.json');
    const serp = normaliseDataForSeo({ query: 'wide hiking boots' }, data.tasks![0]!.result![0]!, AT, 1);

    expect(serp.aiOverview).toMatchObject({ present: false, citedDomains: [] });
    expect(serp.billedUnits).toBe(1);
  });

  it('reads DataForSEO\'s times and references', () => {
    expect(dfsTime('2026-10-27 14:05:12 +00:00')).toBe('2026-10-27T14:05:12.000Z');
    expect(dfsTime(null)).toBeUndefined();
    expect(citedDomainsOf({ type: 'ai_overview', references: [{ url: 'https://www.contoso-supply.example/a' }, { domain: '' }] })).toEqual(['contoso-supply.example']);
  });
});

describe('Ahrefs', () => {
  it('reads Keywords Explorer: volume, KD, traffic potential, CPC in dollars, intent and the AI Overview', async () => {
    resolveToolProviderKey.mockResolvedValue('ahrefs-key');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(fixture('ahrefs-overview.json'))));
    vi.stubGlobal('fetch', fetchMock);

    const r = await ahrefsKeywordMetrics(['wide hiking boots', 'extra wide trail shoes'], { location: 'United Kingdom' }, { orgId: 'org_a' });

    const [url, init] = fetchMock.mock.calls[0]!;
    const params = new URL(url).searchParams;

    expect(url.startsWith('https://api.ahrefs.com/v3/keywords-explorer/overview?')).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ahrefs-key');
    expect(params.get('country')).toBe('gb');
    expect(params.get('keywords')).toBe('wide hiking boots,extra wide trail shoes');
    expect(r.provider).toBe('ahrefs');
    expect(r.metrics[0]).toMatchObject({ keyword: 'wide hiking boots', searchVolume: 8700, kd: 41, trafficPotential: 15000, cpc: 1.35, intent: 'transactional, commercial', source: 'ahrefs' });
    expect(r.metrics[0]!.aiOverview).toMatchObject({ present: true, citedDomains: null, source: 'ahrefs' });
    expect(r.metrics[1]).toMatchObject({ searchVolume: 60, kd: null, intent: null, aiOverview: null });
  });

  it('says plainly when the plan refuses the call, in Ahrefs\' own words', async () => {
    resolveToolProviderKey.mockResolvedValue('ahrefs-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'API access is not available on your plan' }), { status: 403 })));

    const err = await ahrefsKeywordMetrics(['q'], {}, { orgId: 'org_a' }).catch(e => e);

    expect(err).toBeInstanceOf(AhrefsRefusedError);
    expect(err.message).toMatch(/^Ahrefs refused this call: the workspace's Ahrefs plan does not include it\. Ahrefs said: "API access is not available on your plan"\./);
  });

  it('is not configured without the workspace\'s own key: there is no server-wide Ahrefs', async () => {
    await expect(ahrefsKeywordMetrics(['q'], {}, { orgId: 'org_a' })).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('reads a domain\'s organic keywords and the AI answers that mention a brand', async () => {
    resolveToolProviderKey.mockResolvedValue('ahrefs-key');
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(fixture(url.includes('brand-radar') ? 'ahrefs-brand-radar.json' : 'ahrefs-organic.json'))));
    vi.stubGlobal('fetch', fetchMock);

    const organic = await ahrefsOrganicKeywords('https://www.northwind-home.example/', { orgId: 'org_a', today: AT });
    const radar = await ahrefsBrandRadar('Northwind Home Services', { orgId: 'org_a', competitors: ['Lakeside Plumbing'] });

    const organicParams = new URL(fetchMock.mock.calls[0]![0]).searchParams;

    expect(organicParams.get('target')).toBe('northwind-home.example');
    expect(organicParams.get('date')).toBe('2026-10-28');
    expect(organic.keywords[0]).toEqual({ keyword: 'water heater repair fairview', position: 4, url: 'https://northwind-home.example/water-heater-repair', volume: 320, kd: 12, traffic: 41, cpc: 21.5, serpFeatures: ['local_pack'] });
    expect(new URL(fetchMock.mock.calls[1]![0]).searchParams.get('competitors')).toBe('Lakeside Plumbing');
    expect(radar.answers[0]).toMatchObject({ question: 'who fixes water heaters near fairview', assistant: 'google_ai_overviews', links: ['https://northwind-home.example/', 'https://lakeside-plumbing.example/'] });
  });

  it('turns a place into a country code', () => {
    expect(ahrefsCountry()).toBe('us');
    expect(ahrefsCountry('DE')).toBe('de');
    expect(ahrefsCountry('Denver, Colorado, United States')).toBe('us');
    expect(ahrefsCountry('Canada')).toBe('ca');
  });
});
