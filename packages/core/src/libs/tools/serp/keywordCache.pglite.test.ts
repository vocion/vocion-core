/**
 * The keyword cache on the real schema (PGlite): rows kept under source,
 * scope, location, language and keyword; a second write replaces the first;
 * another workspace's Ahrefs numbers are not read.
 */
import { describe, expect, it, vi } from 'vitest';
import { cacheKey, dbKeywordCache } from './keywordCache';

vi.mock('@/libs/DB');

const metric = (keyword: string, searchVolume: number) => ({ keyword, searchVolume, cpc: null, competition: null, competitionIndex: null, source: 'ahrefs' as const, checkedAt: '2026-10-20T00:00:00.000Z' });

describe('dbKeywordCache', () => {
  it('keeps, replaces and scopes rows', async () => {
    const mine = cacheKey('ahrefs', 'org_a', 'US', 'en');
    const theirs = cacheKey('ahrefs', 'org_b', 'US', 'en');
    const first = new Date('2026-10-27T00:00:00Z');
    const second = new Date('2026-10-28T00:00:00Z');

    await dbKeywordCache.put(mine, [{ keyword: 'wide hiking boots', data: metric('wide hiking boots', 1), checkedAt: first }]);
    await dbKeywordCache.put(mine, [{ keyword: 'wide hiking boots', data: metric('wide hiking boots', 8700), checkedAt: second }]);

    const rows = await dbKeywordCache.get(mine, ['wide hiking boots', 'unknown']);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ keyword: 'wide hiking boots', checkedAt: second });
    expect(rows[0]!.data.searchVolume).toBe(8700);
    expect(await dbKeywordCache.get(theirs, ['wide hiking boots'])).toEqual([]);
  });
});
