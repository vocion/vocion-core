/**
 * The Keywords register's rules, pure: how a keyword's status moves, what a
 * read writes onto its row (each fact only when it is newer, the client's
 * position found by its domains, the Checked date), one row per keyword as
 * it is compared, and which page a row follows. Every client and site here
 * is fictional.
 */
import type { SeoKeywordMeta, SeoKeywordRecord } from './keywords';
import type { SeoPageRecord } from './records';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/BusinessObjectService', () => ({}));
vi.mock('./projects', () => ({}));

const { linkedPage, mergeResearch, nextKeywordStatus, pageLinkPatch, pagesFromKeywords, researchPatch } = await import('./keywords');

const row = (over: Partial<SeoKeywordMeta> = {}): SeoKeywordMeta => ({ projectId: 7, keyword: 'boiler repair', keywordKey: 'boiler repair', status: 'idea', source: 'chat', ...over });

function page(id: number, status: SeoPageRecord['meta']['status'], more: Partial<SeoPageRecord['meta']> = {}): SeoPageRecord {
  return { id, title: 'boiler repair', meta: { projectId: 7, batchId: 3, batchTitle: 'Northwind: Boilers', order: 1, keyword: 'boiler repair', status, ...more } };
}

const READ = '2026-10-20T10:00:00.000Z';
const LATER = '2026-10-27T10:00:00.000Z';
const RESULTS = [
  { position: 1, url: 'https://www.boilerhub.example/repair', title: 'Boiler repair guide', domain: 'boilerhub.example' },
  { position: 2, url: 'https://yelp.example/boiler', title: 'Top boiler repair', domain: 'yelp.example' },
  { position: 3, url: 'https://shop.northwind-home.example/boilers', title: 'Boiler repair | Northwind', domain: 'shop.northwind-home.example' },
];

describe('nextKeywordStatus', () => {
  it('follows its page: in a batch while planned or written, published when live, dropped when the page is discarded', () => {
    expect(nextKeywordStatus('idea', { kind: 'page', pageStatus: 'proposed' })).toBe('in_batch');
    expect(nextKeywordStatus('in_batch', { kind: 'page', pageStatus: 'in_review' })).toBe('in_batch');
    expect(nextKeywordStatus('in_batch', { kind: 'page', pageStatus: 'published' })).toBe('published');
    expect(nextKeywordStatus('in_batch', { kind: 'page', pageStatus: 'rejected' })).toBe('dropped');
    // Planned again after a drop: a new plan takes it.
    expect(nextKeywordStatus('dropped', { kind: 'page', pageStatus: 'proposed' })).toBe('in_batch');
  });

  it('keeps ranking, and a person\'s drop, while the page stays live', () => {
    expect(nextKeywordStatus('ranking', { kind: 'page', pageStatus: 'published' })).toBe('ranking');
    expect(nextKeywordStatus('dropped', { kind: 'page', pageStatus: 'published' })).toBe('dropped');
  });

  it('moves a published keyword to ranking when Google shows the client, and back when it does not', () => {
    expect(nextKeywordStatus('published', { kind: 'serp', clientPosition: 4 })).toBe('ranking');
    expect(nextKeywordStatus('ranking', { kind: 'serp', clientPosition: null })).toBe('published');
    // An idea the client already ranks for stays an idea: ranking is for a page we published.
    expect(nextKeywordStatus('idea', { kind: 'serp', clientPosition: 2 })).toBe('idea');
  });

  it('goes back to an idea when a revised plan leaves it out', () => {
    expect(nextKeywordStatus('in_batch', { kind: 'unplanned' })).toBe('idea');
    expect(nextKeywordStatus('published', { kind: 'unplanned' })).toBe('published');
  });

  it('refuses to drop a keyword whose page is in a batch, and to restore one that was not dropped', () => {
    expect(nextKeywordStatus('idea', { kind: 'drop' })).toBe('dropped');
    expect(nextKeywordStatus('ranking', { kind: 'drop' })).toBe('dropped');
    expect(nextKeywordStatus('in_batch', { kind: 'drop' })).toEqual({ refused: expect.stringContaining('discard the page on its sign-off') });
    expect(nextKeywordStatus('dropped', { kind: 'restore' })).toBe('idea');
    expect(nextKeywordStatus('idea', { kind: 'restore' })).toEqual({ refused: 'it is idea, not dropped' });
  });
});

describe('researchPatch', () => {
  it('keeps the top results with the date they were read, and finds the client by its domains, subdomains included', () => {
    const patch = researchPatch(row(), { keyword: 'boiler repair', serp: { checkedAt: READ, results: RESULTS, location: 'Riverton, Ohio, United States' } }, ['northwind-home.example']);

    expect(patch).toMatchObject({
      topResults: [
        { position: 1, url: 'https://www.boilerhub.example/repair', title: 'Boiler repair guide' },
        { position: 2, url: 'https://yelp.example/boiler', title: 'Top boiler repair' },
        { position: 3, url: 'https://shop.northwind-home.example/boilers', title: 'Boiler repair | Northwind' },
      ],
      serpCheckedAt: READ,
      clientPosition: 3,
      clientUrl: 'https://shop.northwind-home.example/boilers',
      location: 'Riverton, Ohio, United States',
      checkedAt: READ,
    });
    expect(patch.topResults![0]).not.toHaveProperty('domain');
  });

  it('clears the client\'s position when a newer read does not show them, keeping the date it was read', () => {
    const before = row({ status: 'ranking', clientPosition: 3, clientUrl: 'https://northwind-home.example/boilers', serpCheckedAt: READ, checkedAt: READ });
    const patch = researchPatch(before, { keyword: 'boiler repair', serp: { checkedAt: LATER, results: RESULTS.slice(0, 2) } }, ['northwind-home.example']);

    expect(patch).toMatchObject({ serpCheckedAt: LATER, checkedAt: LATER, status: 'published', statusLabel: 'Published' });
    expect('clientPosition' in patch && patch.clientPosition === undefined).toBe(true);
  });

  it('never lets an older read overwrite a newer one', () => {
    const before = row({ serpCheckedAt: LATER, metricsCheckedAt: LATER, volume: 900, checkedAt: LATER });

    expect(researchPatch(before, { keyword: 'boiler repair', serp: { checkedAt: READ, results: RESULTS }, metrics: { checkedAt: READ, volume: 10, competition: 'LOW', competitionIndex: 3, cpc: 1 } }, [])).toEqual({});
  });

  it('keeps volume, competition and cost per click with the date read, and drops a volume the provider no longer gives', () => {
    expect(researchPatch(row(), { keyword: 'boiler repair', metrics: { checkedAt: READ, volume: 1300, competition: 'MEDIUM', competitionIndex: 45, cpc: 6.2 } }, [])).toEqual({
      volume: 1300,
      competition: 'medium',
      competitionIndex: 45,
      cpc: 6.2,
      metricsCheckedAt: READ,
      checkedAt: READ,
    });

    const patch = researchPatch(row({ volume: 1300, metricsCheckedAt: READ }), { keyword: 'boiler repair', metrics: { checkedAt: LATER, volume: null, competition: null, competitionIndex: null, cpc: null } }, []);

    expect('volume' in patch && patch.volume === undefined).toBe(true);
    expect(patch.metricsCheckedAt).toBe(LATER);
  });

  it('keeps difficulty, the trend, intent and the AI Overview with their source, and never overwrites a person\'s intent', () => {
    const metrics = { checkedAt: READ, volume: 1300, competition: null, competitionIndex: null, cpc: 6.2, kd: 38, intent: 'commercial', trend: [{ year: 2026, month: 9, volume: 1600 }], serpFeatures: ['ai_overview', 'local_pack'], aiOverview: { present: true, citedDomains: null }, source: 'dataforseo' as const };

    expect(researchPatch(row(), { keyword: 'boiler repair', metrics }, [])).toMatchObject({
      volume: 1300,
      kd: 38,
      volumeTrend: [{ year: 2026, month: 9, volume: 1600 }],
      serpFeatures: ['ai_overview', 'local_pack'],
      aiOverview: { present: true, citedDomains: null },
      metricsSource: 'dataforseo',
      intent: 'commercial',
      intentFrom: 'dataforseo',
      metricsCheckedAt: READ,
    });
    // Ahrefs gives no Google Ads competition: a later Ahrefs read clears it.
    const ahrefs = researchPatch(row({ competition: 'high', metricsCheckedAt: READ }), { keyword: 'boiler repair', metrics: { ...metrics, checkedAt: LATER, source: 'ahrefs' } }, []);

    expect('competition' in ahrefs && ahrefs.competition === undefined).toBe(true);
    expect(researchPatch(row({ intent: 'transactional' }), { keyword: 'boiler repair', metrics }, [])).not.toHaveProperty('intent');
    expect(researchPatch(row({ intent: 'informational', intentFrom: 'ahrefs' }), { keyword: 'boiler repair', metrics }, [])).toMatchObject({ intent: 'commercial', intentFrom: 'dataforseo' });
  });

  it('keeps the cluster head with the date it was read', () => {
    expect(researchPatch(row(), { keyword: 'boiler repair', cluster: { head: 'boiler repair near me', checkedAt: READ } }, [])).toEqual({ cluster: 'boiler repair near me', clusterCheckedAt: READ, checkedAt: READ });
  });
});

describe('mergeResearch', () => {
  it('is one row per keyword as it is compared, whatever the spelling, each read kept', () => {
    const merged = mergeResearch([
      { keyword: ' Boiler Repair ', serp: { checkedAt: READ, results: [] } },
      { keyword: 'boiler-repair', metrics: { checkedAt: READ, volume: 5, competition: null, competitionIndex: null, cpc: null } },
      { keyword: '   ' },
    ]);

    expect([...merged.keys()]).toEqual(['boiler repair']);
    expect(merged.get('boiler repair')).toMatchObject({ keyword: 'Boiler Repair', serp: { checkedAt: READ }, metrics: { volume: 5 } });
  });
});

describe('which page a row follows', () => {
  it('is the newest page in progress or live, else the discarded page it already follows', () => {
    const discarded = page(11, 'rejected');
    const live = page(12, 'proposed');

    expect(linkedPage([discarded, live])).toBe(live);
    expect(linkedPage([discarded], 11)).toBe(discarded);
    // A keyword restored after its page was discarded is not dropped again by that page.
    expect(linkedPage([discarded])).toBeUndefined();
  });

  it('links the batch, the page and its SERP brief, with the status the page gives', () => {
    expect(pageLinkPatch(row(), page(12, 'researched', { serpArtifactId: 40 }), { id: 3, title: 'Northwind: Boilers' })).toEqual({
      batchId: 3,
      batchTitle: 'Northwind: Boilers',
      pageId: 12,
      serpArtifactId: 40,
      status: 'in_batch',
      statusLabel: 'In a batch',
    });
  });

  it('writes nothing when the row already says what the page does', () => {
    const linked = row({ status: 'in_batch', statusLabel: 'In a batch', batchId: 3, batchTitle: 'Northwind: Boilers', pageId: 12 });

    expect(pageLinkPatch(linked, page(12, 'briefed'), { id: 3, title: 'Northwind: Boilers' })).toBeNull();
  });

  it('unlinks a row whose page is gone and makes it an idea again', () => {
    expect(pageLinkPatch(row({ status: 'in_batch', batchId: 3, pageId: 12, serpArtifactId: 40 }), undefined, undefined)).toEqual({
      batchId: undefined,
      batchTitle: undefined,
      pageId: undefined,
      serpArtifactId: undefined,
      status: 'idea',
      statusLabel: 'Idea',
    });
  });
});

describe('pagesFromKeywords', () => {
  it('makes one page per row, in the order chosen, with what the register knows', () => {
    const rows: SeoKeywordRecord[] = [
      { id: 2, title: 'b', meta: row({ keyword: 'boiler servicing', intent: 'commercial', volume: 480, cluster: 'boiler care' }) },
      { id: 1, title: 'a', meta: row({ keyword: 'why is my boiler losing pressure' }) },
    ];

    expect(pagesFromKeywords(rows)).toEqual([
      { keyword: 'boiler servicing', intent: 'commercial', volume: 480, cluster: 'boiler care' },
      { keyword: 'why is my boiler losing pressure' },
    ]);
  });
});
