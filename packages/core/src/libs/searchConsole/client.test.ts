/**
 * Search Console read from recorded responses (fictional sites): the
 * properties a login reads, domain first and unverified ones left out; the
 * date range its two-day lag allows; the query sent; rows shaped; and a
 * refusal in words a person can act on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSearchConsoleSites, propertyLabel, querySearchConsole, SearchConsoleError, searchConsoleRange, sitesOf } from './client';

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Search Console', () => {
  it('lists the properties a login reads, the domain property first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture('sites.json')))));

    expect(await listSearchConsoleSites('token')).toEqual([
      { siteUrl: 'sc-domain:northwind-home.example', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.northwind-home.example/', permissionLevel: 'siteFullUser' },
    ]);
    expect(sitesOf({})).toEqual([]);
    expect(propertyLabel('sc-domain:northwind-home.example')).toBe('northwind-home.example (whole domain)');
  });

  it('reads 28 days ending two days ago unless told otherwise', () => {
    const now = new Date('2026-10-29T10:00:00Z');

    expect(searchConsoleRange({}, now)).toEqual({ startDate: '2026-09-30', endDate: '2026-10-27' });
    expect(searchConsoleRange({ days: 7 }, now)).toEqual({ startDate: '2026-10-21', endDate: '2026-10-27' });
    expect(searchConsoleRange({ startDate: '2026-01-01', endDate: '2026-01-31' }, now)).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' });
  });

  it('asks for queries by page with the filters, and shapes the rows', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(fixture('query.json'))));
    vi.stubGlobal('fetch', fetchMock);

    const r = await querySearchConsole('token', { siteUrl: 'sc-domain:northwind-home.example', startDate: '2026-09-30', endDate: '2026-10-27', dimensions: ['query', 'page'], filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }], rowLimit: 2 });

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Anorthwind-home.example/searchAnalytics/query');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
    expect(JSON.parse(init.body as string)).toEqual({ startDate: '2026-09-30', endDate: '2026-10-27', dimensions: ['query', 'page'], type: 'web', rowLimit: 2, dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }] }] });
    expect(r.rows[0]).toEqual({ keys: ['water heater repair fairview', 'https://northwind-home.example/water-heater-repair'], clicks: 41, impressions: 980, ctr: 0.0418, position: 4.3 });
  });

  it('says what to do when Google refuses the property', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'User does not have sufficient permission for site' } }), { status: 403 })));

    const err = await querySearchConsole('token', { siteUrl: 'https://www.northwind-home.example/', startDate: '2026-09-30', endDate: '2026-10-27', dimensions: ['page'] }).catch(e => e);

    expect(err).toBeInstanceOf(SearchConsoleError);
    expect(err.message).toMatch(/^This Google login cannot read the Search Console property https:\/\/www\.northwind-home\.example\/\. Google said: "User does not have sufficient permission for site"\./);
  });
});
