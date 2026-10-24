import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ads/provider', () => ({ googleAdsSourceFor: vi.fn(async () => ({ id: 1, slug: 'fixture-ads', kind: 'google-ads', config: { customerId: '1234567890' }, apiTokenId: null })) }));
vi.mock('@/services/ads/providers/google', () => ({ googleAdsAccessFor: vi.fn(async () => ({ accessToken: 'ya29.fixture', customerId: '1234567890' })) }));

const { campaignOperations, googleAdsAddNegativesAction, googleAdsCreateSearchCampaignAction, googleAdsSetBudgetAction, GOOGLE_ADS_ACTIONS } = await import('./google-ads');

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function bodies(f: ReturnType<typeof vi.spyOn>): Array<Record<string, any>> {
  return f.mock.calls.map((c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body)));
}

const SPEC = googleAdsCreateSearchCampaignAction.inputSchema.parse({
  name: 'Fixture · Search',
  daily_budget: 50,
  final_url: 'https://fixture.example/landing',
  keywords: [{ text: 'fixture alternative', match: 'EXACT' }, { text: 'cheaper than fixture' }],
  negatives: [{ text: 'jobs' }],
  headlines: ['One', 'Two', 'Three'],
  descriptions: ['First description.', 'Second description.'],
  max_cpc: 6,
  callouts: ['Free plan'],
  sitelinks: [{ text: 'Pricing', url: 'https://fixture.example/pricing' }],
});

afterEach(() => vi.restoreAllMocks());

describe('the Google Ads writes', () => {
  it('every one waits for a person, whoever proposes it', () => {
    expect(GOOGLE_ADS_ACTIONS.every(a => a.approvalRequired && a.external && a.grant === 'manage_ads')).toBe(true);
  });

  it('builds a whole search campaign as one atomic batch linked by temporary names', () => {
    const ops = campaignOperations('1234567890', SPEC) as Array<Record<string, any>>;
    const campaign = ops[1]!.campaignOperation.create;

    expect(ops[0]!.campaignBudgetOperation.create.amountMicros).toBe(50_000_000);
    expect(campaign).toMatchObject({ resourceName: 'customers/1234567890/campaigns/-2', status: 'ENABLED', advertisingChannelType: 'SEARCH', campaignBudget: 'customers/1234567890/campaignBudgets/-1', targetSpend: { cpcBidCeilingMicros: 6_000_000 } });
    expect(campaign.networkSettings).toMatchObject({ targetGoogleSearch: true, targetContentNetwork: false });
    expect(ops.filter(o => o.adGroupCriterionOperation)).toHaveLength(2);
    expect(ops.filter(o => o.campaignCriterionOperation?.create?.negative)).toHaveLength(1);
    expect(ops.filter(o => o.campaignAssetOperation).map(o => o.campaignAssetOperation.create.fieldType)).toEqual(['CALLOUT', 'SITELINK']);
    expect((campaignOperations('1234567890', { ...SPEC, start_paused: true }) as Array<Record<string, any>>)[1]!.campaignOperation.create.status).toBe('PAUSED');
  });

  it('refuses a headline Google would cut, at the proposal', () => {
    expect(googleAdsCreateSearchCampaignAction.inputSchema.safeParse({ ...SPEC, headlines: ['x'.repeat(31), 'Two', 'Three'] }).success).toBe(false);
  });

  it('sets a budget by validating, applying and reading back, and keeps what Undo needs', async () => {
    const budgetRow = (micros: string) => ok({ results: [{ campaign: { name: 'Fixture · Search', status: 'ENABLED' }, campaignBudget: { resourceName: 'customers/1234567890/campaignBudgets/7', amountMicros: micros, explicitlyShared: false }, customer: { currencyCode: 'USD' } }] });
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(budgetRow('50000000'))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(budgetRow('75000000'));
    const result = await googleAdsSetBudgetAction.execute({ orgId: 'org_fixture' }, { campaign_id: '42', daily_budget: 75 }) as Record<string, unknown>;

    const sent = bodies(f);

    expect(sent[1]!.validateOnly).toBe(true);
    expect(sent[2]!.mutateOperations[0].campaignBudgetOperation).toMatchObject({ update: { resourceName: 'customers/1234567890/campaignBudgets/7', amountMicros: 75_000_000 }, updateMask: 'amount_micros' });
    expect(result).toMatchObject({ from: 50, to: 75, budgetResource: 'customers/1234567890/campaignBudgets/7' });
  });

  it('undoes negatives by removing exactly the ones it added', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({})).mockResolvedValueOnce(ok({}));
    const out = await googleAdsAddNegativesAction.undo!({ orgId: 'org_fixture' }, { campaign_id: '42', terms: [{ text: 'jobs', match: 'PHRASE' }] }, { created: ['customers/1234567890/campaignCriteria/42~9'] });

    expect(bodies(f)[1]!.mutateOperations).toEqual([{ campaignCriterionOperation: { remove: 'customers/1234567890/campaignCriteria/42~9' } }]);
    expect(out).toMatchObject({ restored: true });
  });
});
