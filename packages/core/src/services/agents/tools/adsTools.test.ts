/**
 * The ads reads: present only for an agent with an ads source, each
 * answering through the source's provider. The provider is mocked; the
 * campaigns are invented.
 */
import type { RuntimeContext } from '../types';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  kind: 'meta-ads',
  sourceSlug: 'meta-ads',
  vendor: 'Meta Ads',
  accountId: 'act_1234567890',
  accountUrl: null,
  levelNames: { campaign: 'campaign', ad_set: 'ad set' },
  list: vi.fn(async (input: { level: string }) => [{ id: '120200000000000001', name: 'Northwind — Q4 launch', level: input.level, status: 'ACTIVE', state: 'active', parentId: null, objective: 'OUTCOME_LEADS', dailyBudget: 50, totalBudget: null, currency: 'USD', url: null }]),
  performance: vi.fn(async () => [
    { id: '120200000000000001', name: 'Northwind — Q4 launch', level: 'campaign', date: null, impressions: 10_000, clicks: 150, spend: 412.5, conversions: 3, ctr: 0.015, cpc: 2.75, cpm: 41.25, currency: 'USD' },
    { id: '120200000000000002', name: 'Acme retargeting', level: 'campaign', date: null, impressions: 2000, clicks: 10, spend: 20.1, conversions: null, ctr: 0.005, cpc: 2.01, cpm: 10.05, currency: 'USD' },
  ]),
  read: vi.fn(),
  setState: vi.fn() as unknown,
}));
const resolved = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock('@/services/ads/provider', () => ({
  adsProviderFor: async (_org: string, opts: unknown) => {
    resolved.args.push(opts);
    return provider;
  },
}));

const { adsTools } = await import('./adsTools');

type Invokable = { name: string; schema: unknown; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'growth', connectorSources: sources, sourceKinds: kinds, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as unknown as RuntimeContext;
}

describe('the ads reads', () => {
  it('exist only for an agent with an ads source, and can be bound to a model', () => {
    expect(adsTools(ctxFor(['google-ads']))).toHaveLength(0);

    const tools = adsTools(ctxFor(['brand-linkedin'], { 'brand-linkedin': 'linkedin-ads' })) as unknown as Invokable[];

    expect(tools.map(t => t.name)).toEqual(['ads_campaigns', 'ads_performance']);

    for (const t of tools) {
      expect(() => toJsonSchema(t.schema as never)).not.toThrow();
    }
  });

  it('lists ad sets in the vendor\'s words and points a writable connection at the action', async () => {
    const [campaigns] = adsTools(ctxFor(['meta-ads'])) as unknown as Invokable[];
    const out = JSON.parse(await campaigns!.invoke({ level: 'ad_set', state: 'active' }));

    expect(provider.list).toHaveBeenLastCalledWith({ level: 'ad_set', state: 'active', limit: 50 });
    expect(out).toMatchObject({ ok: true, level: 'ad_set', vendorCalls: 'ad set', adSets: [{ name: 'Northwind — Q4 launch' }] });
    expect(out.note).toMatch(/ads\.set_status/);
  });

  it('says a read-only connection cannot pause', async () => {
    const setState = provider.setState;
    provider.setState = undefined;
    const [campaigns] = adsTools(ctxFor(['meta-ads'])) as unknown as Invokable[];

    expect(JSON.parse(await campaigns!.invoke({})).note).toMatch(/reads only/);

    provider.setState = setState;
  });

  it('reads performance over the range, scoped to the agent\'s sources, with totals', async () => {
    const [, performance] = adsTools(ctxFor(['meta-ads'])) as unknown as Invokable[];
    const out = JSON.parse(await performance!.invoke({ from: '2026-09-01', to: '2026-09-30', daily: true }));

    expect(resolved.args.at(-1)).toEqual({ sourceSlug: null, slugs: ['meta-ads'] });
    expect(provider.performance).toHaveBeenLastCalledWith({ level: 'campaign', from: '2026-09-01', to: '2026-09-30', daily: true, ids: undefined });
    expect(out).toMatchObject({ ok: true, count: 2, totals: { impressions: 12_000, clicks: 160, spend: 432.6, currency: 'USD' } });
  });
});
