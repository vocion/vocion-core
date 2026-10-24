import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGoogleAdsReport } from '../googleReports';
import { googleAdsReader, googleState, idList } from './google';

const ACCESS = { accessToken: 'ya29.fixture', customerId: '1234567890' };

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function queries(f: ReturnType<typeof vi.spyOn>): string[] {
  return f.mock.calls.map((c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body)).query as string);
}

afterEach(() => vi.restoreAllMocks());

describe('the Google Ads provider', () => {
  it('reads Google statuses as the family\'s states', () => {
    expect([googleState('ENABLED'), googleState('PAUSED'), googleState('REMOVED'), googleState('X')]).toEqual(['active', 'paused', 'archived', 'other']);
  });

  it('refuses ids that are not digits before they reach GAQL', () => {
    expect(idList(['1', '22'])).toBe('1, 22');
    expect(() => idList(['1) OR (1=1'])).toThrow(/digits/);
  });

  it('lists campaigns with their daily budget in currency units and a link into Google Ads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({ results: [{ campaign: { id: '42', name: 'Fixture Search', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '50000000' }, customer: { currencyCode: 'USD' } }] }));
    const rows = await googleAdsReader({ sourceSlug: 'ads', access: ACCESS }).list({ level: 'campaign', state: 'active', limit: 10 });

    expect(rows[0]).toMatchObject({ id: '42', state: 'active', dailyBudget: 50, currency: 'USD', objective: 'SEARCH' });
    expect(rows[0]!.url).toContain('campaignId=42');
  });

  it('reads performance over a range, narrowed to the ids asked for', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({ results: [{ campaign: { id: '42', name: 'Fixture Search' }, metrics: { impressions: '1000', clicks: '50', costMicros: '125000000', conversions: 5 }, customer: { currencyCode: 'USD' } }] }));
    const rows = await googleAdsReader({ sourceSlug: 'ads', access: ACCESS }).performance({ level: 'campaign', from: '2026-10-01', to: '2026-10-07', daily: false, ids: ['42'] });

    expect(queries(f)[0]).toContain('segments.date BETWEEN \'2026-10-01\' AND \'2026-10-07\'');
    expect(queries(f)[0]).toContain('campaign.id IN (42)');
    expect(rows[0]).toMatchObject({ spend: 125, clicks: 50, cpc: 2.5, conversions: 5 });
  });

  it('pauses by validating first, then applying, then reading the campaign back', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ results: [{ campaign: { id: '42', name: 'Fixture Search', status: 'PAUSED' } }] }));
    const after = await googleAdsReader({ sourceSlug: 'ads', access: ACCESS }).setState!('campaign', '42', 'paused');

    const bodies = f.mock.calls.map(c => JSON.parse(String((c[1] as RequestInit).body)));

    expect(bodies[0].validateOnly).toBe(true);
    expect(bodies[0].mutateOperations[0].campaignOperation.update.status).toBe('PAUSED');
    expect(bodies[1].validateOnly).toBe(false);
    expect(after.state).toBe('paused');
  });
});

describe('the Google Ads reports', () => {
  it('says whether a search term is already a keyword or a negative', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({ results: [
      { searchTermView: { searchTerm: 'fixture jobs', status: 'NONE' }, metrics: { clicks: '9', costMicros: '27000000', impressions: '90' } },
      { searchTermView: { searchTerm: 'fixture tool', status: 'ADDED' }, metrics: { clicks: '3', costMicros: '6000000', impressions: '30' } },
    ] }));
    const out = await runGoogleAdsReport(ACCESS, { report: 'search_terms', from: '2026-10-01', to: '2026-10-07' });

    expect(out.rows.map(r => [r.term, r.already, r.spend])).toEqual([['fixture jobs', null, 27], ['fixture tool', 'keyword', 6]]);
  });

  it('paces month-to-date spend against each budget', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({ results: [{ campaign: { id: '42', name: 'Fixture Search' }, campaignBudget: { amountMicros: '50000000' }, metrics: { costMicros: '300000000' } }] }));
    const out = await runGoogleAdsReport(ACCESS, { report: 'budget_pacing', from: '2026-10-01', to: '2026-10-10' });

    expect(out.rows[0]).toMatchObject({ dailyBudget: 50, monthToDate: 300, monthBudget: 1550, projectedMonth: 930 });
    expect(out.note).toContain('Day 10 of 31');
  });
});
