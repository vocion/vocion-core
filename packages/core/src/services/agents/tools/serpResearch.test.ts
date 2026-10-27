import type { RuntimeContext } from '../types';
/**
 * The SERP tools as an agent holds them: granted, charged to `seo.research`,
 * the brief filed in `seo/serp` with the pages read in parallel, and volume
 * never invented. Providers, the page fetch, the artifact store and the
 * budget are mocked.
 */
import type { SerpResult } from '@/libs/tools/serp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchSerp = vi.fn();
const keywordMetrics = vi.fn();
const keywordIdeas = vi.fn();
const fetchHtml = vi.fn();
const renderMarkdownArtifact = vi.fn();
const chargeUsage = vi.fn();
const getArtifact = vi.fn();
const updateArtifact = vi.fn();

vi.mock('@/libs/tools/serp/registry', () => ({
  searchSerp: (...a: unknown[]) => searchSerp(...a),
  keywordMetrics: (...a: unknown[]) => keywordMetrics(...a),
  keywordIdeas: (...a: unknown[]) => keywordIdeas(...a),
}));
vi.mock('@/libs/tools/browse/registry', () => ({ getBrowseProvider: () => ({ name: 'builtin', fetchHtml: (...a: unknown[]) => fetchHtml(...a) }) }));
vi.mock('./renderArtifacts', () => ({
  renderMarkdownArtifact: (...a: unknown[]) => renderMarkdownArtifact(...a),
  authorOf: () => ({ kind: 'agent', id: 'agent:serp-analyst' }),
}));
vi.mock('@/services/BudgetService', () => ({ chargeUsage: (...a: unknown[]) => chargeUsage(...a) }));
vi.mock('@/services/ArtifactService', () => ({
  getArtifact: (...a: unknown[]) => getArtifact(...a),
  updateArtifact: (...a: unknown[]) => updateArtifact(...a),
  toPayload: (row: unknown) => row,
}));

const { clearSerpRunCache, serpTools } = await import('./serpResearch');
const { ProviderNotConfiguredError } = await import('@/libs/tools/types');
const { expandGrants } = await import('./grantGroups');

const emit = vi.fn();
function ctx(grantTools: string[]): RuntimeContext {
  return { orgId: 'org_seo', agentSlug: 'serp-analyst', conversationId: 7, emit, harnessConfig: { grantTools } } as unknown as RuntimeContext;
}

function serp(n = 3, over: Partial<SerpResult> = {}): SerpResult {
  return {
    query: 'wide hiking boots',
    provider: 'serper',
    isGoogleRanking: true,
    device: 'desktop',
    organic: Array.from({ length: n }, (_, i) => ({ position: i + 1, url: `https://site-${i + 1}.example/boots`, domain: `site-${i + 1}.example`, title: `Boots ${i + 1}`, snippet: '' })),
    peopleAlsoAsk: [{ question: 'Should hiking boots be a size bigger?' }],
    relatedSearches: [],
    adsCount: null,
    retrievedAt: '2026-10-27T14:05:12.000Z',
    billedUnits: 1,
    ...over,
  };
}

const PAGE = '<html><head><title>Boots</title></head><body><main><h1>Boots</h1><h2>Sizing</h2><p>Words here.</p></main></body></html>';

beforeEach(() => {
  for (const m of [searchSerp, keywordMetrics, keywordIdeas, fetchHtml, renderMarkdownArtifact, chargeUsage, getArtifact, updateArtifact, emit]) {
    m.mockReset();
  }
  clearSerpRunCache();
  keywordIdeas.mockResolvedValue({ ok: false, reason: 'No keyword ideas: keyword ideas are not available on Serper, which has no keyword data.' });
  renderMarkdownArtifact.mockResolvedValue({ artifactId: 41, receipt: 'Rendered markdown' });
  fetchHtml.mockImplementation(async (url: string) => ({ url, html: PAGE }));
});

describe('the SERP tools', () => {
  it('are granted as a group or by name, and absent otherwise', () => {
    expect(serpTools(ctx([])).map(t => t.name)).toEqual([]);
    expect(serpTools(ctx(['serp'])).map(t => t.name)).toEqual(['serp_search', 'serp_compare', 'keyword_cluster', 'keyword_metrics']);
    expect(serpTools(ctx(['keyword_metrics'])).map(t => t.name)).toEqual(['keyword_metrics']);
    expect(expandGrants(['serp'])).toEqual(['serp', 'serp_search', 'serp_compare', 'keyword_cluster', 'keyword_metrics']);
  });
});

describe('serp_search', () => {
  it('returns the page with an id, and charges what the vendor billed to seo.research', async () => {
    searchSerp.mockResolvedValue(serp());
    const [search] = serpTools(ctx(['serp']));
    const out = JSON.parse(await search!.invoke({ query: 'wide hiking boots', country: 'us', language: 'en' }) as string);

    expect(out.serpResultId).toMatch(/^serp_[0-9a-f]{12}$/);
    expect(out.serp.organic).toHaveLength(3);
    expect(searchSerp).toHaveBeenCalledWith(expect.objectContaining({ query: 'wide hiking boots', country: 'us', language: 'en', num: 10 }), { orgId: 'org_seo' });
    expect(chargeUsage).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_seo', agentSlug: 'serp-analyst', feature: 'seo.research', model: 'serp/serper', usage: { inputTokens: 1 } }));
  });

  it('charges nothing on the web search fallback, and passes its label through', async () => {
    searchSerp.mockResolvedValue(serp(2, { provider: 'web_search:brave', isGoogleRanking: false, note: 'Brave results, not Google\'s ranking.', billedUnits: 0 }));
    const [search] = serpTools(ctx(['serp']));
    const out = JSON.parse(await search!.invoke({ query: 'q' }) as string);

    expect(out.serp.note).toBe('Brave results, not Google\'s ranking.');
    expect(chargeUsage).not.toHaveBeenCalled();
  });
});

describe('serp_compare', () => {
  it('reads the top pages from an earlier search, at most four at once, and files the brief in seo/serp', async () => {
    searchSerp.mockResolvedValue(serp(8));
    const [search, compare] = serpTools(ctx(['serp']));
    const { serpResultId } = JSON.parse(await search!.invoke({ query: 'wide hiking boots' }) as string);
    searchSerp.mockClear();
    let inFlight = 0;
    let most = 0;
    fetchHtml.mockImplementation(async (url: string) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return url.includes('site-3') ? null : { url, html: PAGE };
    });

    const out = JSON.parse(await compare!.invoke({ serp_result_id: serpResultId, top: 6 }) as string);

    expect(searchSerp).not.toHaveBeenCalled();
    expect(fetchHtml).toHaveBeenCalledTimes(6);
    expect(most).toBeLessThanOrEqual(4);
    expect(out.briefArtifactId).toBe(41);
    expect(out.pages[0]).toMatchObject({ position: 1, title: 'Boots', outline: ['H1 Boots', 'H2 Sizing'] });
    expect(out.pages[2]).toEqual({ position: 3, url: 'https://site-3.example/boots', domain: 'site-3.example', couldNotRead: 'not an HTML page' });
    expect(out.next).toMatch(/brief_id 41/);

    const [, title, md, folder] = renderMarkdownArtifact.mock.calls[0]!;

    expect(title).toBe('SERP brief: wide hiking boots');
    expect(folder).toBe('seo/serp');
    expect(md).toContain('| 1 | [Boots](https://site-1.example/boots)');
  });

  it('writes the synthesis into the brief it filed, cited to the brief\'s own rows', async () => {
    getArtifact.mockResolvedValue({ id: 41, spec: { md: '| 1 | [Boots](https://site-1.example/boots) · site-1.example |\n## Synthesis\n\n<!-- serp-synthesis -->\n_Not written yet._\n<!-- /serp-synthesis -->\n' } });
    updateArtifact.mockResolvedValue({ artifact: { id: 41, title: 'SERP brief: wide hiking boots' }, version: { version: 2 } });
    const [, compare] = serpTools(ctx(['serp']));

    const out = await compare!.invoke({ brief_id: 41, synthesis: { intent: 'Buying wide boots.', common_subtopics: [{ point: 'Sizing', sources: [1] }], gaps: [] } }) as string;

    expect(out).toMatch(/^Wrote the synthesis/);
    expect(updateArtifact.mock.calls[0]![0].contentMarkdown).toContain('- Sizing · [#1](https://site-1.example/boots)');
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});

describe('serp_compare on SEO evidence', () => {
  const page = (text: string, h2: string) => `<html><head><title>Repair</title></head><body><main><h1>Repair</h1><h2>${h2}</h2><p>${text}</p></main></body></html>`;

  it('refuses web search results: a brief built on another engine\'s order is not Google\'s ranking', async () => {
    searchSerp.mockResolvedValue(serp(3, { provider: 'web_search:brave', isGoogleRanking: false, note: 'Brave results, not Google\'s ranking.', billedUnits: 0 }));
    const [search, compare] = serpTools(ctx(['serp']));
    const { serpResultId } = JSON.parse(await search!.invoke({ query: 'wide hiking boots' }) as string);

    const out = await compare!.invoke({ serp_result_id: serpResultId }) as string;

    expect(out).toMatch(/^Not compared: .* brave web search results, not Google's ranking\. .*add a Serper key/);
    expect(fetchHtml).not.toHaveBeenCalled();
    expect(renderMarkdownArtifact).not.toHaveBeenCalled();
  });

  it('asks for Google only when it searches itself, and says to add a Serper key when there is none', async () => {
    searchSerp.mockRejectedValue(new ProviderNotConfiguredError('serp', 'serper', ['SERPER_API_KEY']));
    const [, compare] = serpTools(ctx(['serp']));

    const out = await compare!.invoke({ query: 'water heater repair fairview' }) as string;

    expect(searchSerp).toHaveBeenCalledWith(expect.objectContaining({ query: 'water heater repair fairview' }), { orgId: 'org_seo', googleOnly: true });
    expect(out).toMatch(/needs Google's own ranking.*Serper key/);
  });

  it('flags directories, hands over each business page\'s text, the local pack and the terms three pages share', async () => {
    const domains = ['www.yelp.com', 'northwind-home.example', 'angi.com', 'lakeside-plumbing.example', 'contoso-supply.example'];
    searchSerp.mockResolvedValue(serp(5, {
      query: 'water heater repair fairview',
      organic: domains.map((d, i) => ({ position: i + 1, url: `https://${d}/fairview`, domain: d.replace(/^www\./, ''), title: d, snippet: '' })),
      localPack: [{ position: 1, name: 'Northwind Home Services', rating: 4.8, reviews: 212 }],
    }));
    fetchHtml.mockImplementation(async (url: string) => ({ url, html: page(`We flush the tank and replace the anode rod in Fairview. ${'More words here. '.repeat(400)}`, 'Our process') }));
    const [, compare] = serpTools(ctx(['serp']));

    const out = JSON.parse(await compare!.invoke({ query: 'water heater repair fairview', top: 5 }) as string);

    expect(out.pages.filter((p: { directory?: boolean }) => p.directory).map((p: { position: number }) => p.position)).toEqual([1, 3]);
    expect(out.pages[0].text).toBeUndefined();
    expect(out.pages[1].text.startsWith('Repair Our process We flush the tank')).toBe(true);
    expect(out.pages[1].text.length).toBeLessThanOrEqual(3_002);
    expect(out.localPack[0]).toMatchObject({ name: 'Northwind Home Services' });
    expect(out.sharedHeadings).toEqual([{ heading: 'Our process', positions: [2, 4, 5], variants: ['Our process'] }]);
    expect(out.sharedTerms.find((t: { term: string }) => t.term === 'anode rod').positions).toEqual([2, 4, 5]);
    expect(out.next).toMatch(/not from headings alone/);
    expect(out.next).toMatch(/`directory`/);
  });
});

describe('the synthesis', () => {
  it('refuses common subtopics cited to a directory', async () => {
    getArtifact.mockResolvedValue({ id: 42, spec: { md: '| 1 | [Best 10](https://www.yelp.com/search) · yelp.com · directory | 300 |\n| 2 | [Repair](https://northwind-home.example/fairview) · northwind-home.example | 1,200 |\n<!-- serp-synthesis -->\n_Not written yet._\n<!-- /serp-synthesis -->\n' } });
    const [, compare] = serpTools(ctx(['serp']));

    const out = await compare!.invoke({ brief_id: 42, synthesis: { intent: 'Find a plumber today.', common_subtopics: [{ point: 'Reviews', sources: [1, 2] }], gaps: [{ point: 'Nobody lists prices', sources: [1, 2] }] } }) as string;

    expect(out).toMatch(/^Not written: "Reviews" cites #1, which is a directory\./);
    expect(updateArtifact).not.toHaveBeenCalled();
  });
});

describe('keyword_cluster', () => {
  it('groups keywords whose top tens share three URLs, reads each page once per run, and hands the ids on', async () => {
    const shared = ['northwind-home.example/fairview', 'lakeside-plumbing.example/heaters', 'contoso-supply.example/repair'];
    searchSerp.mockImplementation(async (q: { query: string }) => serp(0, {
      query: q.query,
      organic: (q.query.includes('tankless') ? ['acme.example/tankless', 'acme.example/b', shared[0]!] : [...shared, `acme.example/${q.query.length}`]).map((u, i) => ({ position: i + 1, url: `https://${u}`, domain: u.split('/')[0]!, title: u, snippet: '' })),
    }));
    const [, compare, cluster] = serpTools(ctx(['serp']));

    const out = JSON.parse(await cluster!.invoke({ keywords: ['water heater repair fairview', 'water heater repair near fairview', 'tankless water heater fairview'], location: 'Fairview, Oregon, United States' }) as string);

    expect(out.clusters.map((c: { page: string; keywords: Array<{ keyword: string }> }) => [c.page, c.keywords.map(k => k.keyword)])).toEqual([
      ['water heater repair fairview', ['water heater repair fairview', 'water heater repair near fairview']],
      ['tankless water heater fairview', ['tankless water heater fairview']],
    ]);
    expect(out.clusters[0].keywords[1]).toMatchObject({ sharedWithHead: 3 });
    expect(searchSerp).toHaveBeenCalledTimes(3);
    expect(searchSerp).toHaveBeenCalledWith(expect.objectContaining({ location: 'Fairview, Oregon, United States' }), { orgId: 'org_seo', googleOnly: true });
    expect(chargeUsage).toHaveBeenCalledTimes(3);

    // Comparing one of them later in the run reads no results page again.
    fetchHtml.mockResolvedValue(null);
    await compare!.invoke({ query: 'water heater repair fairview', location: 'Fairview, Oregon, United States' });

    expect(searchSerp).toHaveBeenCalledTimes(3);
    expect(chargeUsage).toHaveBeenCalledTimes(3);

    const again = JSON.parse(await cluster!.invoke({ keywords: ['water heater repair fairview', 'tankless water heater fairview'], location: 'Fairview, Oregon, United States' }) as string);

    expect(again).toMatchObject({ searchesRead: 0, searchesReused: 2 });
  });

  it('refuses without Google results, and needs two keywords', async () => {
    searchSerp.mockRejectedValue(new ProviderNotConfiguredError('serp', 'serper', ['SERPER_API_KEY']));
    const [, , cluster] = serpTools(ctx(['serp']));

    expect(await cluster!.invoke({ keywords: ['a', 'b'] })).toMatch(/needs Google's own ranking/);
    expect(await cluster!.invoke({ keywords: ['a', 'A '] })).toMatch(/at least two different keywords/);
  });
});

describe('keyword_metrics', () => {
  it('says it could not establish volume rather than estimating', async () => {
    keywordMetrics.mockResolvedValue({ ok: false, reason: 'Could not establish volume: Serper gives no search volume.' });
    const [metrics] = serpTools(ctx(['keyword_metrics']));
    const out = JSON.parse(await metrics!.invoke({ keywords: ['wide hiking boots', 'wide hiking boots '] }) as string);

    expect(out).toEqual({ ok: false, keywords: ['wide hiking boots'], reason: 'Could not establish volume: Serper gives no search volume.', ideas: null, ideasUnavailable: 'No keyword ideas: keyword ideas are not available on Serper, which has no keyword data.' });
    expect(chargeUsage).not.toHaveBeenCalled();
  });

  it('charges one DataForSEO task for the numbers', async () => {
    keywordMetrics.mockResolvedValue({ ok: true, result: { provider: 'dataforseo', location: 'United States', language: 'en', metrics: [{ keyword: 'wide hiking boots', searchVolume: 9900 }], retrievedAt: '2026-10-27T14:05:12.000Z', billedUnits: 1 } });
    keywordIdeas.mockResolvedValue({ ok: true, result: { provider: 'dataforseo', location: 'United States', language: 'en', seeds: ['wide hiking boots'], ideas: [{ keyword: 'wide hiking boots women', searchVolume: 2900, cpc: null, competition: null, competitionIndex: null }], retrievedAt: '2026-10-27T14:05:12.000Z', billedUnits: 1 } });
    const [metrics] = serpTools(ctx(['serp'])).slice(3);
    const out = JSON.parse(await metrics!.invoke({ keywords: ['wide hiking boots'] }) as string);

    expect(out.metrics[0].searchVolume).toBe(9900);
    expect(out.ideas[0]).toMatchObject({ keyword: 'wide hiking boots women', searchVolume: 2900 });
    expect(chargeUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'serp/dataforseo-search-volume', usage: { inputTokens: 1 } }));
    expect(chargeUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'serp/dataforseo-keyword-ideas', usage: { inputTokens: 1 } }));
  });

  it('skips the ideas call when asked to', async () => {
    keywordMetrics.mockResolvedValue({ ok: false, reason: 'Could not establish volume.' });
    const [metrics] = serpTools(ctx(['keyword_metrics']));
    const out = JSON.parse(await metrics!.invoke({ keywords: ['wide hiking boots'], ideas: false }) as string);

    expect(keywordIdeas).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty('ideas');
  });
});
