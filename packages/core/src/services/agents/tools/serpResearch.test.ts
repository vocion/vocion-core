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
const fetchHtml = vi.fn();
const renderMarkdownArtifact = vi.fn();
const chargeUsage = vi.fn();
const getArtifact = vi.fn();
const updateArtifact = vi.fn();

vi.mock('@/libs/tools/serp/registry', () => ({
  searchSerp: (...a: unknown[]) => searchSerp(...a),
  keywordMetrics: (...a: unknown[]) => keywordMetrics(...a),
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

const { serpTools } = await import('./serpResearch');
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
  for (const m of [searchSerp, keywordMetrics, fetchHtml, renderMarkdownArtifact, chargeUsage, getArtifact, updateArtifact, emit]) {
    m.mockReset();
  }
  renderMarkdownArtifact.mockResolvedValue({ artifactId: 41, receipt: 'Rendered markdown' });
  fetchHtml.mockImplementation(async (url: string) => ({ url, html: PAGE }));
});

describe('the SERP tools', () => {
  it('are granted as a group or by name, and absent otherwise', () => {
    expect(serpTools(ctx([])).map(t => t.name)).toEqual([]);
    expect(serpTools(ctx(['serp'])).map(t => t.name)).toEqual(['serp_search', 'serp_compare', 'keyword_metrics']);
    expect(serpTools(ctx(['keyword_metrics'])).map(t => t.name)).toEqual(['keyword_metrics']);
    expect(expandGrants(['serp'])).toEqual(['serp', 'serp_search', 'serp_compare', 'keyword_metrics']);
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

describe('keyword_metrics', () => {
  it('says it could not establish volume rather than estimating', async () => {
    keywordMetrics.mockResolvedValue({ ok: false, reason: 'Could not establish volume: Serper gives no search volume.' });
    const [metrics] = serpTools(ctx(['keyword_metrics']));
    const out = JSON.parse(await metrics!.invoke({ keywords: ['wide hiking boots', 'wide hiking boots '] }) as string);

    expect(out).toEqual({ ok: false, keywords: ['wide hiking boots'], reason: 'Could not establish volume: Serper gives no search volume.' });
    expect(chargeUsage).not.toHaveBeenCalled();
  });

  it('charges one DataForSEO task for the numbers', async () => {
    keywordMetrics.mockResolvedValue({ ok: true, result: { provider: 'dataforseo', location: 'United States', language: 'en', metrics: [{ keyword: 'wide hiking boots', searchVolume: 9900 }], retrievedAt: '2026-10-27T14:05:12.000Z', billedUnits: 1 } });
    const [metrics] = serpTools(ctx(['serp'])).slice(2);
    const out = JSON.parse(await metrics!.invoke({ keywords: ['wide hiking boots'] }) as string);

    expect(out.metrics[0].searchVolume).toBe(9900);
    expect(chargeUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'serp/dataforseo-search-volume', usage: { inputTokens: 1 } }));
  });
});
