import type { RuntimeContext } from '../types';
/**
 * The SEO data tools as the strategist holds them: granted with `serp`; a
 * Search Console read on the client project's own property, the property
 * kept on the project only when the person picked it, the choices offered
 * when none is picked; and a plain sentence, never a guess, when Search
 * Console or Ahrefs is not connected. The services and the network are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchConsoleAccess = vi.fn();
const searchConsoleSites = vi.fn();
const projectSearchConsoleProperty = vi.fn();
const setProjectSearchConsoleProperty = vi.fn();
const querySearchConsole = vi.fn();
const ahrefsOrganicKeywords = vi.fn();

vi.mock('@/services/seo/searchConsole', () => ({
  searchConsoleAccess: (...a: unknown[]) => searchConsoleAccess(...a),
  searchConsoleSites: (...a: unknown[]) => searchConsoleSites(...a),
  projectSearchConsoleProperty: (...a: unknown[]) => projectSearchConsoleProperty(...a),
  setProjectSearchConsoleProperty: (...a: unknown[]) => setProjectSearchConsoleProperty(...a),
}));
vi.mock('@/libs/searchConsole/client', async (importActual) => {
  const actual = await importActual<typeof import('@/libs/searchConsole/client')>();
  return { ...actual, querySearchConsole: (...a: unknown[]) => querySearchConsole(...a) };
});
vi.mock('@/libs/tools/serp/ahrefs', () => ({ ahrefsOrganicKeywords: (...a: unknown[]) => ahrefsOrganicKeywords(...a) }));

const { seoDataTools } = await import('./seoData');
const { ProviderNotConfiguredError } = await import('@/libs/tools/types');
const { saysConnectionMissing } = await import('@/libs/connect/connectionNeeded');

function ctx(grantTools: string[]): RuntimeContext {
  return { orgId: 'org_seo', agentSlug: 'seo-strategist', userId: 'user_1', conversationId: 7, emit: vi.fn(), harnessConfig: { grantTools } } as unknown as RuntimeContext;
}
const tool = (name: string) => seoDataTools(ctx(['serp'])).find(t => t.name === name)!;
const SITES = [{ siteUrl: 'sc-domain:northwind-home.example', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:lakeside-plumbing.example', permissionLevel: 'siteFullUser' }];

beforeEach(() => {
  for (const m of [searchConsoleAccess, searchConsoleSites, projectSearchConsoleProperty, setProjectSearchConsoleProperty, querySearchConsole, ahrefsOrganicKeywords]) {
    m.mockReset();
  }
  searchConsoleAccess.mockResolvedValue({ ok: true, accessToken: 'token', defaultSite: null });
  searchConsoleSites.mockResolvedValue({ sites: SITES });
  setProjectSearchConsoleProperty.mockResolvedValue(true);
  querySearchConsole.mockImplementation(async (_t: string, input: { siteUrl: string; startDate: string; endDate: string; dimensions: string[] }) => ({ ...input, rows: [{ keys: ['water heater repair fairview', 'https://northwind-home.example/water-heater-repair'], clicks: 41, impressions: 980, ctr: 0.0418, position: 4.3 }] }));
});

describe('the SEO data tools', () => {
  it('come with the serp grant, or by name', () => {
    expect(seoDataTools(ctx([]))).toEqual([]);
    expect(seoDataTools(ctx(['serp'])).map(t => t.name)).toEqual(['search_console_queries', 'search_console_pages', 'ahrefs_organic_keywords', 'ahrefs_brand_radar']);
    expect(seoDataTools(ctx(['search_console_pages'])).map(t => t.name)).toEqual(['search_console_pages']);
  });

  it('reads the project\'s own property', async () => {
    projectSearchConsoleProperty.mockResolvedValue({ siteUrl: 'sc-domain:northwind-home.example', setAt: '2026-10-20T00:00:00.000Z' });

    const out = JSON.parse(await tool('search_console_queries').invoke({ project_id: 12, by_page: true }) as string);

    expect(querySearchConsole).toHaveBeenCalledWith('token', expect.objectContaining({ siteUrl: 'sc-domain:northwind-home.example', dimensions: ['query', 'page'], rowLimit: 50 }));
    expect(out).toMatchObject({ source: 'Google Search Console', property: 'sc-domain:northwind-home.example' });
    expect(out.rows[0]).toEqual({ query: 'water heater repair fairview', page: 'https://northwind-home.example/water-heater-repair', clicks: 41, impressions: 980, ctr: 0.0418, position: 4.3 });
  });

  it('offers the properties to ask about when the project has none, and keeps the one picked', async () => {
    projectSearchConsoleProperty.mockResolvedValue(null);

    const ask = JSON.parse(await tool('search_console_pages').invoke({ project_id: 12 }) as string);

    expect(ask.needsProperty).toBe(true);
    expect(ask.properties[0]).toEqual({ site_url: 'sc-domain:northwind-home.example', label: 'northwind-home.example (whole domain)' });
    expect(querySearchConsole).not.toHaveBeenCalled();

    const out = JSON.parse(await tool('search_console_pages').invoke({ project_id: 12, site_url: 'sc-domain:northwind-home.example', page_contains: '/blog/' }) as string);

    expect(setProjectSearchConsoleProperty).toHaveBeenCalledWith('org_seo', 12, 'sc-domain:northwind-home.example', 'user_1');
    expect(querySearchConsole).toHaveBeenCalledWith('token', expect.objectContaining({ dimensions: ['page'], filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }] }));
    expect(out.kept).toBe('Kept sc-domain:northwind-home.example as project #12\'s Search Console property.');
  });

  it('refuses a property the login cannot read', async () => {
    const out = await tool('search_console_queries').invoke({ site_url: 'sc-domain:contoso-supply.example' }) as string;

    expect(out).toMatch(/^sc-domain:contoso-supply\.example is not a Search Console property this login can read\. It reads: /);
    expect(querySearchConsole).not.toHaveBeenCalled();
  });

  it('says Search Console is not connected, in words that bring its connect card', async () => {
    searchConsoleAccess.mockResolvedValue({ ok: false, reason: 'Google Search Console is not connected in this workspace.' });

    const out = await tool('search_console_queries').invoke({ project_id: 12 }) as string;

    expect(out).toBe('Google Search Console is not connected in this workspace.');
    expect(saysConnectionMissing(out)).toBe(true);
  });

  it('says Ahrefs is not connected rather than guessing', async () => {
    ahrefsOrganicKeywords.mockRejectedValue(new ProviderNotConfiguredError('keyword data', 'ahrefs', ['an Ahrefs API key']));

    const out = await tool('ahrefs_organic_keywords').invoke({ domain: 'northwind-home.example' }) as string;

    expect(out).toMatch(/^Ahrefs is not connected in this workspace\./);
    expect(saysConnectionMissing(out)).toBe(true);
  });
});
