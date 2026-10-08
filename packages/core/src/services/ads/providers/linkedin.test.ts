/**
 * LinkedIn Ads against recorded-shape Marketing API answers: levels mapped to
 * the family's words, money and rates computed once, a 429 retried once, and
 * each workspace calling with its own token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const credentials = vi.hoisted(() => ({ byOrg: {} as Record<string, Record<string, unknown> | null> }));
vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => credentials.byOrg[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { linkedinAdsProvider, linkedinAdsReader, linkedinState } = await import('./linkedin');

const ACCOUNT = '508000001';

type Answer = { status?: number; body: unknown };

function network(answer: (url: string) => Answer) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    const a = answer(String(url));
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  });
  return { calls, doFetch: doFetch as unknown as typeof fetch };
}

const ACCOUNT_BODY = { id: Number(ACCOUNT), name: 'Northwind Brand', currency: 'USD', status: 'ACTIVE' };
const GROUPS = { elements: [{ id: 640000001, name: 'Q4 Pipeline', status: 'ACTIVE', totalBudget: { amount: '5000.00', currencyCode: 'USD' } }, { id: 640000002, name: 'Hiring', status: 'PAUSED' }], metadata: {} };
const CAMPAIGNS = { elements: [{ id: 720000001, name: 'Q4 Pipeline — CFOs', status: 'ACTIVE', campaignGroup: 'urn:li:sponsoredCampaignGroup:640000001', objectiveType: 'LEAD_GENERATION', dailyBudget: { amount: '150', currencyCode: 'USD' } }], metadata: {} };

afterEach(() => vi.unstubAllGlobals());

describe('linkedin ads reader', () => {
  it('maps campaign groups to campaigns and LinkedIn campaigns to ad sets', async () => {
    const { calls, doFetch } = network(url => (url.includes('/adCampaignGroups') ? { body: GROUPS } : url.includes('/adCampaigns') ? { body: CAMPAIGNS } : { body: ACCOUNT_BODY }));
    const p = linkedinAdsReader({ sourceSlug: 'linkedin-ads', token: 'tok', accountId: ACCOUNT, doFetch });

    const groups = await p.list({ level: 'campaign', state: 'all', limit: 10 });
    const sets = await p.list({ level: 'ad_set', state: 'active', limit: 10 });

    expect(groups.map(g => [g.name, g.state, g.totalBudget])).toEqual([['Q4 Pipeline', 'active', 5000], ['Hiring', 'paused', null]]);
    expect(sets[0]).toMatchObject({ level: 'ad_set', parentId: '640000001', dailyBudget: 150, currency: 'USD', objective: 'LEAD_GENERATION' });
    expect(calls.find(c => c.url.includes('/adCampaigns?'))!.url).toContain('search=(status:(values:List(ACTIVE)))');
    expect(p.setState).toBeUndefined();
    expect(p.levelNames).toEqual({ campaign: 'campaign group', ad_set: 'campaign' });
  });

  it('reads performance by day with names, decimal cost and computed rates', async () => {
    const analytics = {
      elements: [
        { pivotValues: ['urn:li:sponsoredCampaign:720000001'], dateRange: { start: { year: 2026, month: 9, day: 1 }, end: { year: 2026, month: 9, day: 1 } }, impressions: 2000, clicks: 40, costInLocalCurrency: '120.456', externalWebsiteConversions: 3 },
      ],
    };
    const { calls, doFetch } = network(url => (url.includes('/adAnalytics') ? { body: analytics } : url.includes('/adCampaigns') ? { body: CAMPAIGNS } : { body: ACCOUNT_BODY }));
    const p = linkedinAdsReader({ sourceSlug: 'linkedin-ads', token: 'tok', accountId: ACCOUNT, doFetch });

    const rows = await p.performance({ level: 'ad_set', from: '2026-09-01', to: '2026-09-30', daily: true });

    expect(rows).toEqual([{ id: '720000001', name: 'Q4 Pipeline — CFOs', level: 'ad_set', date: '2026-09-01', impressions: 2000, clicks: 40, spend: 120.46, conversions: 3, ctr: 0.02, cpc: 3.0114, cpm: 60.228, currency: 'USD' }]);

    const url = calls.find(c => c.url.includes('/adAnalytics'))!.url;

    expect(url).toContain('pivot=CAMPAIGN&timeGranularity=DAILY');
    expect(url).toContain('dateRange=(start:(year:2026,month:9,day:1),end:(year:2026,month:9,day:30))');
    expect(url).toContain('accounts=List(urn%3Ali%3AsponsoredAccount%3A508000001)');
  });

  it('retries a throttled call once, then answers with a sentence', async () => {
    let n = 0;
    const { doFetch } = network(() => (++n <= 2 ? { status: 429, body: { code: 'TOO_MANY_REQUESTS' } } : { body: ACCOUNT_BODY }));
    const p = linkedinAdsReader({ sourceSlug: 'linkedin-ads', token: 'tok', accountId: ACCOUNT, doFetch });

    vi.useFakeTimers();
    const pending = p.read('campaign', '640000001').catch((e: Error) => e);
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(String(await pending)).toMatch(/throttling/);
    expect(n).toBe(2);
  });

  it('keeps LinkedIn\'s status word and maps it to the family\'s state', () => {
    expect(linkedinState('ACTIVE')).toBe('active');
    expect(linkedinState('PAUSED')).toBe('paused');
    expect(linkedinState('COMPLETED')).toBe('archived');
    expect(linkedinState('DRAFT')).toBe('other');
  });
});

describe('linkedinAdsProvider', () => {
  it('calls LinkedIn with each workspace\'s own token, in sequence', async () => {
    credentials.byOrg = { org_northwind: { token: 'tok-northwind' }, org_kestrel: { token: 'tok-kestrel' } };
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(JSON.stringify(ACCOUNT_BODY));
    }));
    const source = (slug: string) => ({ id: 1, slug, kind: 'linkedin-ads', config: { accountId: ACCOUNT }, apiTokenId: null });

    await (await linkedinAdsProvider('org_northwind', source('linkedin-ads'))).read('campaign', '640000001').catch(() => null);
    await (await linkedinAdsProvider('org_kestrel', source('linkedin-ads'))).read('campaign', '640000001').catch(() => null);

    expect(seen[0]).toBe('Bearer tok-northwind');
    expect(seen.at(-1)).toBe('Bearer tok-kestrel');
    expect(seen.filter(s => s === 'Bearer tok-northwind')).toHaveLength(seen.length / 2);
  });

  it('says so when no credential is stored, and when a non-refreshing login has expired', async () => {
    credentials.byOrg = { org_empty: null, org_expired: { accessToken: 'old', expiresAt: '2020-01-01T00:00:00.000Z' } };
    const source = { id: 1, slug: 'linkedin-ads', kind: 'linkedin-ads', config: { accountId: ACCOUNT }, apiTokenId: null };

    await expect(linkedinAdsProvider('org_empty', source)).rejects.toThrow(/no LinkedIn credential/);
    await expect(linkedinAdsProvider('org_expired', source)).rejects.toThrow(/Log in with LinkedIn again/);
  });
});

describe('linkedin ads Test connection', () => {
  it('reads the account, its campaign groups and yesterday\'s reporting', async () => {
    const { inspectLinkedinAds } = await import('@/libs/sources/linkedinAds');
    const { doFetch } = network(url => (url.includes('/adAnalytics') ? { body: { elements: [{ impressions: 900, costInLocalCurrency: '44.10' }] } } : url.includes('/adCampaignGroups') ? { body: GROUPS } : { body: ACCOUNT_BODY }));

    const result = await inspectLinkedinAds({ config: { accountId: ACCOUNT }, credentials: { token: 'tok' }, now: new Date('2026-10-02T12:00:00Z') }, doFetch);

    expect(result).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(result.checks.map(c => c.detail)).toEqual(['Northwind Brand · USD · ACTIVE', 'Campaign groups are readable.', 'Yesterday (2026-10-01): 900 impressions, 44.10 USD spent.']);
  });

  it('says a refused token plainly, and asks for the account id when it is missing', async () => {
    const { inspectLinkedinAds } = await import('@/libs/sources/linkedinAds');
    const { doFetch } = network(() => ({ status: 401, body: { code: 'EMPTY_ACCESS_TOKEN' } }));

    await expect(inspectLinkedinAds({ config: { accountId: ACCOUNT }, credentials: { token: 'tok' } }, doFetch)).resolves.toMatchObject({ authorized: false, error: expect.stringMatching(/expired or was revoked/) });
    await expect(inspectLinkedinAds({ config: {}, credentials: { token: 'tok' } }, doFetch)).rejects.toThrow(/ad account id/);
  });
});
