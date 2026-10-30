/**
 * Keyword numbers, kept 7 days per keyword, location and language
 * (`keyword_metric_cache`), so a keyword researched on Monday and again on
 * Thursday is bought once.
 *
 * A cached keyword keeps the date the vendor measured it (`checkedAt` on the
 * metric) and the date Vocion read it (`checked_at` on the row): the 7 days
 * count from the read. Market data anyone may reuse (DataForSEO) is kept
 * under scope '' and serves every workspace; numbers bought on a workspace's
 * own licence (Ahrefs) are kept under that workspace's id and serve only it.
 *
 * The database is reached lazily (`await import`), so the SERP registry stays
 * light to import; a store that cannot be read is a miss, never a failure.
 */

import type { KeywordDataSource, KeywordMetric, KeywordMetricsResult } from './types';

/** How long bought numbers are reused. */
export const KEYWORD_CACHE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one cached keyword is kept under, besides the keyword itself. */
export type KeywordCacheKey = {
  source: KeywordDataSource;
  /** '' for market data anyone may reuse; the org id for a workspace's own licence. */
  scope: string;
  location: string;
  language: string;
};

export type CachedKeyword = { keyword: string; data: KeywordMetric; checkedAt: Date };

/** Where cached keywords live; the database in production, a map in tests. */
export type KeywordCacheStore = {
  /** The rows held for these (normalised) keywords, of any age. */
  get: (key: KeywordCacheKey, keywords: string[]) => Promise<CachedKeyword[]>;
  /** Keep these, replacing what was held. */
  put: (key: KeywordCacheKey, rows: CachedKeyword[]) => Promise<void>;
};

/**
 * A keyword as the cache compares it: lower case, spaces collapsed.
 * @param keyword - As searched.
 */
export function normKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The cache key for a location and language, compared loosely.
 * @param source - The vendor.
 * @param scope - '' or the org id.
 * @param location - The vendor's location name.
 * @param language - ISO 639-1.
 */
export function cacheKey(source: KeywordDataSource, scope: string, location: string, language: string): KeywordCacheKey {
  return { source, scope, location: location.trim().toLowerCase().replace(/\s*,\s*/g, ','), language: language.trim().toLowerCase() };
}

/**
 * Whether a row read at `checkedAt` is still reused at `now`.
 * @param checkedAt - When Vocion read it.
 * @param now - Now.
 */
export function isFresh(checkedAt: Date, now: Date): boolean {
  return now.getTime() - checkedAt.getTime() < KEYWORD_CACHE_DAYS * DAY_MS;
}

/** The production store: `keyword_metric_cache`. */
export const dbKeywordCache: KeywordCacheStore = {
  async get(key, keywords) {
    if (keywords.length === 0) {
      return [];
    }
    const [{ db }, { keywordMetricCacheSchema: t }, { and, eq, inArray }] = await Promise.all([
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('drizzle-orm'),
    ]);
    const rows = await db
      .select({ keyword: t.keyword, data: t.data, checkedAt: t.checkedAt })
      .from(t)
      .where(and(eq(t.source, key.source), eq(t.scope, key.scope), eq(t.location, key.location), eq(t.language, key.language), inArray(t.keyword, keywords)));
    return rows.map(r => ({ keyword: r.keyword, data: r.data as KeywordMetric, checkedAt: r.checkedAt }));
  },
  async put(key, rows) {
    if (rows.length === 0) {
      return;
    }
    const [{ db }, { keywordMetricCacheSchema: t }, { sql }] = await Promise.all([
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('drizzle-orm'),
    ]);
    const unique = [...new Map(rows.map(r => [r.keyword, r])).values()];
    await db
      .insert(t)
      .values(unique.map(r => ({ ...key, keyword: r.keyword, data: r.data, checkedAt: r.checkedAt })))
      .onConflictDoUpdate({
        target: [t.source, t.scope, t.location, t.language, t.keyword],
        set: { data: sql`excluded.data`, checkedAt: sql`excluded.checked_at` },
      });
  },
};

/**
 * Keyword numbers for these keywords: the fresh ones from the cache, the
 * rest bought with `buy` (only those) and kept. A keyword the vendor
 * returned nothing for is not kept, and is bought again next time.
 *
 * The result reads as one call: its metrics in the order asked, its
 * `costUsd` and `billedUnits` what was spent now (0 when everything was
 * cached), `cachedKeywords` how many were reused.
 * @param key - Source, scope, location and language.
 * @param keywords - The keywords, as asked.
 * @param buy - Buys the misses.
 * @param store - The cache.
 * @param now - Now (a test seam).
 */
export async function withKeywordCache(
  key: KeywordCacheKey,
  keywords: string[],
  buy: (missing: string[]) => Promise<KeywordMetricsResult>,
  store: KeywordCacheStore = dbKeywordCache,
  now: Date = new Date(),
): Promise<KeywordMetricsResult> {
  const wanted = [...new Map(keywords.map(k => [normKeyword(k), k])).entries()];
  let held: CachedKeyword[] = [];
  try {
    held = await store.get(key, wanted.map(([n]) => n));
  } catch (err) {
    console.warn('[keywords] the cache could not be read; buying every keyword', { error: (err as Error).message });
  }
  const fresh = new Map(held.filter(r => isFresh(r.checkedAt, now)).map(r => [r.keyword, r.data]));
  const missing = wanted.filter(([n]) => !fresh.has(n)).map(([, k]) => k);
  let bought: KeywordMetricsResult | null = null;
  if (missing.length > 0) {
    bought = await buy(missing);
    const rows = bought.metrics.map(m => ({ keyword: normKeyword(m.keyword), data: m, checkedAt: now }));
    try {
      await store.put(key, rows);
    } catch (err) {
      console.warn('[keywords] the cache could not be written', { error: (err as Error).message });
    }
  }
  const boughtBy = new Map((bought?.metrics ?? []).map(m => [normKeyword(m.keyword), m]));
  const metrics = wanted.flatMap(([n, k]) => {
    const m = boughtBy.get(n) ?? fresh.get(n);
    return m ? [{ ...m, keyword: k }] : [];
  });
  return {
    provider: key.source,
    location: bought?.location ?? key.location,
    language: bought?.language ?? key.language,
    metrics,
    retrievedAt: bought?.retrievedAt ?? now.toISOString(),
    billedUnits: bought?.billedUnits ?? 0,
    ...(bought?.costUsd !== undefined ? { costUsd: bought.costUsd } : {}),
    cachedKeywords: wanted.length - missing.length,
  };
}
