/**
 * Which provider answers for each numbers family: the named source, else the
 * only one in scope, else a refusal that names what is connected — and only
 * ever among the sources the caller is scoped to.
 */
import { describe, expect, it, vi } from 'vitest';

type Row = { id: number; slug: string; kind: string; config: Record<string, unknown>; apiTokenId: string | null };
const sources = vi.hoisted(() => ({ rows: [] as Row[], asked: [] as Array<{ family: string; slugs?: readonly string[] }> }));
vi.mock('@/libs/connectors/families', () => ({
  familySourcesForOrg: async (_org: string, family: string, slugs?: readonly string[]) => {
    sources.asked.push({ family, slugs });
    return sources.rows.filter(r => !slugs || slugs.includes(r.slug));
  },
}));
const stub = (family: string) => async (_org: string, source: Row) => ({ family, kind: source.kind, sourceSlug: source.slug });
vi.mock('./providers/snowflake', () => ({ snowflakeWarehouseProvider: stub('warehouse') }));
vi.mock('./providers/bigquery', () => ({ bigqueryWarehouseProvider: stub('warehouse') }));
vi.mock('./providers/databricks', () => ({ databricksWarehouseProvider: stub('warehouse') }));
vi.mock('./providers/redshift', () => ({ redshiftWarehouseProvider: stub('warehouse') }));
vi.mock('@/services/productAnalytics/providers/mixpanel', () => ({ mixpanelAnalyticsProvider: stub('analytics') }));
vi.mock('@/services/productAnalytics/providers/amplitude', () => ({ amplitudeAnalyticsProvider: stub('analytics') }));
vi.mock('@/services/ads/providers/linkedin', () => ({ linkedinAdsProvider: stub('ads') }));
vi.mock('@/services/ads/providers/meta', () => ({ metaAdsProvider: stub('ads') }));

const { warehouseProviderFor, warehouseSourcesFor } = await import('./provider');
const { analyticsProviderFor } = await import('@/services/productAnalytics/provider');
const { adsProviderFor, ratesOf } = await import('@/services/ads/provider');

const row = (slug: string, kind: string, config: Record<string, unknown> = {}): Row => ({ id: 1, slug, kind, config, apiTokenId: null });

describe('warehouseProviderFor', () => {
  it('answers with the only source, the named one, or a refusal naming what is connected', async () => {
    sources.rows = [row('snowflake', 'snowflake', { schemas: ['MARTS'] })];

    await expect(warehouseProviderFor('org')).resolves.toMatchObject({ kind: 'snowflake', sourceSlug: 'snowflake' });

    sources.rows.push(row('finance-dw', 'bigquery', { schemas: ['finance'] }));

    await expect(warehouseProviderFor('org')).rejects.toThrow(/2 warehouse sources; name one.*snowflake \(snowflake: MARTS\); finance-dw \(bigquery: finance\)/);
    await expect(warehouseProviderFor('org', { sourceSlug: 'finance-dw' })).resolves.toMatchObject({ kind: 'bigquery' });
    await expect(warehouseProviderFor('org', { sourceSlug: 'hr-dw' })).rejects.toThrow(/No warehouse source named hr-dw/);

    sources.rows = [];

    await expect(warehouseProviderFor('org')).rejects.toThrow(/No data warehouse is connected/);
  });

  it('looks only among the sources the caller is scoped to', async () => {
    sources.rows = [row('snowflake', 'snowflake'), row('finance-dw', 'bigquery')];

    await expect(warehouseProviderFor('org', { slugs: ['finance-dw'] })).resolves.toMatchObject({ sourceSlug: 'finance-dw' });
    await expect(warehouseProviderFor('org', { slugs: ['finance-dw'], sourceSlug: 'snowflake' })).rejects.toThrow(/No warehouse source named snowflake/);
    expect(sources.asked.at(-1)).toEqual({ family: 'warehouse', slugs: ['finance-dw'] });
  });

  it('dispatches each warehouse kind to its provider', async () => {
    sources.rows = [row('a', 'snowflake'), row('b', 'bigquery'), row('c', 'databricks'), row('d', 'redshift')];
    for (const slug of ['a', 'b', 'c', 'd']) {
      await expect(warehouseProviderFor('org', { sourceSlug: slug })).resolves.toMatchObject({ family: 'warehouse', sourceSlug: slug });
    }

    await expect(warehouseSourcesFor('org')).resolves.toEqual([
      { slug: 'a', kind: 'snowflake', schemas: [] },
      { slug: 'b', kind: 'bigquery', schemas: [] },
      { slug: 'c', kind: 'databricks', schemas: [] },
      { slug: 'd', kind: 'redshift', schemas: [] },
    ]);
  });
});

describe('analyticsProviderFor and adsProviderFor', () => {
  it('resolve the same way, in their own families', async () => {
    sources.rows = [row('mixpanel', 'mixpanel'), row('amplitude', 'amplitude')];

    await expect(analyticsProviderFor('org')).rejects.toThrow(/2 analytics sources/);
    await expect(analyticsProviderFor('org', { sourceSlug: 'amplitude' })).resolves.toMatchObject({ family: 'analytics', kind: 'amplitude' });
    expect(sources.asked.at(-1)?.family).toBe('analytics');

    sources.rows = [row('meta-ads', 'meta-ads')];

    await expect(adsProviderFor('org')).resolves.toMatchObject({ family: 'ads', kind: 'meta-ads' });
    expect(sources.asked.at(-1)?.family).toBe('ads');

    sources.rows = [];

    await expect(analyticsProviderFor('org')).rejects.toThrow(/No product analytics is connected/);
    await expect(adsProviderFor('org')).rejects.toThrow(/No ad platform is connected/);
  });

  it('compute an ad row\'s rates one way for every vendor', () => {
    expect(ratesOf({ impressions: 10_000, clicks: 150, spend: 412.5 })).toEqual({ ctr: 0.015, cpc: 2.75, cpm: 41.25 });
    expect(ratesOf({ impressions: 0, clicks: 0, spend: 0 })).toEqual({ ctr: null, cpc: null, cpm: null });
  });
});
