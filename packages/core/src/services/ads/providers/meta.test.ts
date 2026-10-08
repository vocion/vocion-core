/**
 * Meta Ads against recorded-shape Graph API answers: budgets out of minor
 * units, insights mapped to the family's rows, pause and resume, a missing
 * permission said plainly, and each workspace calling with its own token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const credentials = vi.hoisted(() => ({ byOrg: {} as Record<string, Record<string, unknown> | null> }));
vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => credentials.byOrg[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { metaAdsProvider, metaAdsReader } = await import('./meta');
const { budgetUnits, actId } = await import('@/libs/meta/client');

type Answer = { status?: number; body: unknown };

function network(answer: (url: string, init?: RequestInit) => Answer) {
  const calls: Array<{ url: string; method: string; body: string; auth: string | null }> = [];
  const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? ''), auth: new Headers(init?.headers).get('authorization') });
    const a = answer(String(url), init);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  });
  return { calls, doFetch: doFetch as unknown as typeof fetch };
}

const ACT = 'act_1000000000000001';
const ACCOUNT_BODY = { id: ACT, name: 'Acme Paid Social', currency: 'USD', account_status: 1 };
const reader = (doFetch: typeof fetch, accountId = ACT) => metaAdsReader({ sourceSlug: 'meta-ads', token: 'tok', accountId, version: 'v23.0', doFetch, pauseMs: 0 });

afterEach(() => vi.unstubAllGlobals());

describe('meta client', () => {
  it('reads budgets out of minor units, except for offset-1 currencies', () => {
    expect(budgetUnits('15000', 'USD')).toBe(150);
    expect(budgetUnits('15000', 'JPY')).toBe(15000);
    expect(budgetUnits('0', 'USD')).toBeNull();
    expect(budgetUnits(undefined, 'USD')).toBeNull();
  });

  it('normalizes an ad account id and refuses one that is not', () => {
    expect(actId('1000000000000001')).toBe('act_1000000000000001');
    expect(actId('act_1000000000000001')).toBe('act_1000000000000001');
    expect(() => actId('northwind')).toThrow(/not a Meta ad account id/);
  });
});

describe('meta ads reader', () => {
  it('lists campaigns with budgets in currency units, following the after cursor, token in the header only', async () => {
    let page = 0;
    const { calls, doFetch } = network((url) => {
      if (url.includes('/campaigns')) {
        page++;
        return page === 1
          ? { body: { data: [{ id: '120000000000000001', name: 'Northwind Spring Sale', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_SALES', daily_budget: '25000' }], paging: { cursors: { after: 'CURSOR1' }, next: 'https://graph.facebook.com/next' } } }
          : { body: { data: [{ id: '120000000000000002', name: 'Retargeting', status: 'PAUSED', effective_status: 'PAUSED' }], paging: { cursors: { after: 'CURSOR2' } } } };
      }
      return { body: ACCOUNT_BODY };
    });

    const rows = await reader(doFetch).list({ level: 'campaign', state: 'all', limit: 10 });

    expect(rows.map(r => [r.name, r.state, r.dailyBudget])).toEqual([['Northwind Spring Sale', 'active', 250], ['Retargeting', 'paused', null]]);
    expect(calls.filter(c => c.url.includes('/campaigns'))[1]!.url).toContain('after=CURSOR1');
    expect(calls.every(c => !c.url.includes('tok') && c.auth === 'Bearer tok')).toBe(true);
  });

  it('maps ad set insights per day, summing conversions and computing rates', async () => {
    const { calls, doFetch } = network(() => ({ body: { data: [{ adset_id: '230000000000000001', adset_name: 'Lookalike 1%', impressions: '10000', clicks: '250', spend: '412.50', conversions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '4' }, { action_type: 'lead', value: '2' }], date_start: '2026-09-02', account_currency: 'USD' }] } }));

    const rows = await reader(doFetch).performance({ level: 'ad_set', from: '2026-09-01', to: '2026-09-07', daily: true, ids: ['230000000000000001'] });

    expect(rows).toEqual([{ id: '230000000000000001', name: 'Lookalike 1%', level: 'ad_set', date: '2026-09-02', impressions: 10000, clicks: 250, spend: 412.5, conversions: 6, ctr: 0.025, cpc: 1.65, cpm: 41.25, currency: 'USD' }]);

    const url = new URL(calls[0]!.url);

    expect(url.pathname).toBe(`/v23.0/${ACT}/insights`);
    expect(url.searchParams.get('level')).toBe('adset');
    expect(url.searchParams.get('time_increment')).toBe('1');
    expect(JSON.parse(url.searchParams.get('time_range')!)).toEqual({ since: '2026-09-01', until: '2026-09-07' });
    expect(JSON.parse(url.searchParams.get('filtering')!)).toEqual([{ field: 'adset.id', operator: 'IN', value: ['230000000000000001'] }]);
  });

  it('pauses with a POST of the status, then reads it back', async () => {
    let status = 'ACTIVE';
    const { calls, doFetch } = network((url, init) => {
      if (init?.method === 'POST') {
        status = new URLSearchParams(String(init.body)).get('status')!;
        return { body: { success: true } };
      }
      return url.includes(`/${ACT}?`) ? { body: ACCOUNT_BODY } : { body: { id: '120000000000000001', name: 'Northwind Spring Sale', status, effective_status: status } };
    });

    const after = await reader(doFetch).setState!('campaign', '120000000000000001', 'paused');

    expect(after).toMatchObject({ state: 'paused', status: 'PAUSED' });
    expect(calls.find(c => c.method === 'POST')).toMatchObject({ url: 'https://graph.facebook.com/v23.0/120000000000000001', body: 'status=PAUSED' });
  });

  it('says the token cannot manage when Meta refuses the write for a permission', async () => {
    const { doFetch } = network((_url, init) => (init?.method === 'POST' ? { status: 403, body: { error: { message: '(#200) Permissions error', code: 200 } } } : { body: ACCOUNT_BODY }));

    await expect(reader(doFetch).setState!('campaign', '120000000000000001', 'paused')).rejects.toThrow(/ads_management/);
  });

  it('retries a throttled read once, then says so', async () => {
    let n = 0;
    const { doFetch } = network(() => {
      n++;
      return { status: 400, body: { error: { message: 'User request limit reached', code: 17 } } };
    });

    await expect(reader(doFetch).read('campaign', '120000000000000001')).rejects.toThrow(/throttling/);
    expect(n).toBe(2);
  });
});

describe('metaAdsProvider', () => {
  it('calls Meta with each workspace\'s own token, in sequence', async () => {
    credentials.byOrg = { org_acme: { token: 'tok-acme' }, org_kestrel: { token: 'tok-kestrel' } };
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(JSON.stringify(ACCOUNT_BODY));
    }));
    const source = { id: 1, slug: 'meta-ads', kind: 'meta-ads', config: { accountId: ACT }, apiTokenId: null };

    await (await metaAdsProvider('org_acme', source)).list({ level: 'campaign', state: 'all', limit: 1 });
    await (await metaAdsProvider('org_kestrel', source)).list({ level: 'campaign', state: 'all', limit: 1 });

    expect(seen.slice(0, seen.length / 2).every(s => s === 'Bearer tok-acme')).toBe(true);
    expect(seen.slice(seen.length / 2).every(s => s === 'Bearer tok-kestrel')).toBe(true);
  });

  it('says so when no credential is stored', async () => {
    credentials.byOrg = {};

    await expect(metaAdsProvider('org_none', { id: 1, slug: 'meta-ads', kind: 'meta-ads', config: { accountId: ACT }, apiTokenId: null })).rejects.toThrow(/no Meta Ads credential/);
  });
});

describe('meta ads Test connection', () => {
  it('reads the account and says whether the token may pause, from its granted permissions', async () => {
    const { inspectMetaAds } = await import('@/libs/sources/metaAds');
    const { calls, doFetch } = network(url => (url.includes('/me/permissions')
      ? { body: { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'ads_management', status: 'declined' }] } }
      : url.includes('/campaigns') ? { body: { data: [] } } : { body: ACCOUNT_BODY }));

    const result = await inspectMetaAds({ config: { accountId: '1000000000000001' }, credentials: { token: 'tok' } }, doFetch);

    expect(result).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(result.checks[0]!.detail).toBe('Acme Paid Social · USD · active');
    expect(result.note).toMatch(/reads only/);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('turns a bad token into a person-readable failure, and bad input into an input error', async () => {
    const { inspectMetaAds } = await import('@/libs/sources/metaAds');
    const { doFetch } = network(() => ({ status: 400, body: { error: { message: 'Invalid OAuth access token', code: 190 } } }));

    await expect(inspectMetaAds({ config: { accountId: ACT }, credentials: { token: 'tok' } }, doFetch)).resolves.toMatchObject({ authorized: false, error: expect.stringMatching(/expired, was revoked/) });
    await expect(inspectMetaAds({ config: { accountId: 'northwind' }, credentials: { token: 'tok' } }, doFetch)).rejects.toThrow(/not a Meta ad account id/);
  });
});
