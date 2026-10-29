/**
 * The 7-day keyword cache: a keyword bought this week is not bought again,
 * only the keywords the cache lacks are bought, a stale one is bought fresh,
 * and a cache that cannot be read is a miss, never a failure.
 */
import type { CachedKeyword, KeywordCacheStore } from './keywordCache';
import type { KeywordMetricsResult } from './types';
import { describe, expect, it, vi } from 'vitest';
import { cacheKey, isFresh, KEYWORD_CACHE_DAYS, normKeyword, withKeywordCache } from './keywordCache';

const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const KEY = cacheKey('dataforseo', '', 'United States', 'EN');

function memory(seed: CachedKeyword[] = []): KeywordCacheStore & { rows: Map<string, CachedKeyword> } {
  const rows = new Map(seed.map(r => [r.keyword, r]));
  return {
    rows,
    get: async (_k, keywords) => keywords.flatMap(k => (rows.has(k) ? [rows.get(k)!] : [])),
    put: async (_k, list) => {
      for (const r of list) {
        rows.set(r.keyword, r);
      }
    },
  };
}

const metric = (keyword: string, searchVolume: number) => ({ keyword, searchVolume, cpc: null, competition: null, competitionIndex: null, source: 'dataforseo' as const, checkedAt: '2026-10-20T00:00:00.000Z' });

function buyer(volumes: Record<string, number>) {
  return vi.fn(async (missing: string[]): Promise<KeywordMetricsResult> => ({
    provider: 'dataforseo',
    location: 'United States',
    language: 'en',
    metrics: missing.filter(k => k in volumes).map(k => metric(k, volumes[k]!)),
    retrievedAt: NOW.toISOString(),
    billedUnits: 1,
    costUsd: 0.0101,
  }));
}

describe('withKeywordCache', () => {
  it('buys only what the cache lacks, keeps it, and keeps the vendor\'s date', async () => {
    const store = memory([{ keyword: 'wide hiking boots', data: metric('wide hiking boots', 9900), checkedAt: new Date(NOW.getTime() - DAY) }]);
    const buy = buyer({ 'extra wide trail shoes': 70 });

    const r = await withKeywordCache(KEY, ['Wide Hiking Boots', 'extra wide trail shoes'], buy, store, NOW);

    expect(buy).toHaveBeenCalledWith(['extra wide trail shoes']);
    expect(r.metrics.map(m => [m.keyword, m.searchVolume, m.checkedAt])).toEqual([['Wide Hiking Boots', 9900, '2026-10-20T00:00:00.000Z'], ['extra wide trail shoes', 70, '2026-10-20T00:00:00.000Z']]);
    expect(r).toMatchObject({ cachedKeywords: 1, billedUnits: 1, costUsd: 0.0101 });
    expect(store.rows.get('extra wide trail shoes')?.checkedAt).toEqual(NOW);
  });

  it('spends nothing when every keyword is fresh', async () => {
    const store = memory([{ keyword: 'wide hiking boots', data: metric('wide hiking boots', 9900), checkedAt: NOW }]);
    const buy = buyer({});

    const r = await withKeywordCache(KEY, ['wide hiking boots'], buy, store, NOW);

    expect(buy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ billedUnits: 0, cachedKeywords: 1 });
    expect(r.costUsd).toBeUndefined();
  });

  it(`buys a keyword again after ${KEYWORD_CACHE_DAYS} days`, async () => {
    const store = memory([{ keyword: 'wide hiking boots', data: metric('wide hiking boots', 1), checkedAt: new Date(NOW.getTime() - KEYWORD_CACHE_DAYS * DAY) }]);
    const buy = buyer({ 'wide hiking boots': 9900 });

    const r = await withKeywordCache(KEY, ['wide hiking boots'], buy, store, NOW);

    expect(buy).toHaveBeenCalledOnce();
    expect(r.metrics[0]?.searchVolume).toBe(9900);
  });

  it('buys everything when the cache cannot be read, and still answers when it cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: KeywordCacheStore = { get: async () => Promise.reject(new Error('down')), put: async () => Promise.reject(new Error('down')) };

    const r = await withKeywordCache(KEY, ['wide hiking boots'], buyer({ 'wide hiking boots': 9900 }), broken, NOW);

    expect(r.metrics[0]?.searchVolume).toBe(9900);
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it('compares keywords and places loosely', () => {
    expect(normKeyword('  Wide   Hiking Boots ')).toBe('wide hiking boots');
    expect(cacheKey('ahrefs', 'org_a', 'Denver, Colorado, United States', 'EN')).toEqual({ source: 'ahrefs', scope: 'org_a', location: 'denver,colorado,united states', language: 'en' });
    expect(isFresh(new Date(NOW.getTime() - 6 * DAY), NOW)).toBe(true);
  });
});
