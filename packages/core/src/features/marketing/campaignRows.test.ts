import type { CampaignRow } from '@/services/marketing/marketingReads';
import { describe, expect, it } from 'vitest';
import { rangeFor, rangeParam } from '@/services/marketing/marketingReads';
import { money, nextSort, percent, sortCampaigns, totalsOf } from './campaignRows';

const row = (over: Partial<CampaignRow>): CampaignRow => ({ id: '1', name: 'Alpha', status: 'ENABLED', serving: null, bidding: null, dailyBudget: 50, spend: 0, clicks: 0, impressions: 0, ctr: null, cpc: null, conversions: 0, costPerConversion: null, ...over });

describe('the Marketing lists', () => {
  it('sorts by spend biggest first, and a campaign with no cost per conversion always last', () => {
    const rows = [row({ id: '1', name: 'Alpha', spend: 10, costPerConversion: 5 }), row({ id: '2', name: 'Bravo', spend: 40, costPerConversion: null }), row({ id: '3', name: 'Charlie', spend: 25, costPerConversion: 2 })];

    expect(sortCampaigns(rows, 'spend', 'desc').map(r => r.id)).toEqual(['2', '3', '1']);
    expect(sortCampaigns(rows, 'cpa', 'asc').map(r => r.id)).toEqual(['3', '1', '2']);
    expect(sortCampaigns(rows, 'cpa', 'desc').map(r => r.id)).toEqual(['1', '3', '2']);
  });

  it('a first click sorts names A–Z and money biggest first; a second click reverses', () => {
    expect(nextSort({ sort: 'spend', dir: 'desc' }, 'name')).toEqual({ sort: 'name', dir: 'asc' });
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'clicks')).toEqual({ sort: 'clicks', dir: 'desc' });
    expect(nextSort({ sort: 'clicks', dir: 'desc' }, 'clicks')).toEqual({ sort: 'clicks', dir: 'asc' });
  });

  it('computes total rates from the totals, never by averaging rates', () => {
    const t = totalsOf([row({ spend: 100, clicks: 10, conversions: 1 }), row({ spend: 20, clicks: 30, conversions: 3 })]);

    expect(t).toMatchObject({ spend: 120, clicks: 40, cpc: 3, conversions: 4, costPerConversion: 30 });
  });

  it('reads money and rates the way a person does', () => {
    expect([money(1240), money(3.42), money(null), percent(0.0423), percent(null)]).toEqual(['$1,240', '$3.42', '—', '4.2%', '—']);
  });

  it('a range ends yesterday, and reads 7 unless the address says 30', () => {
    expect(rangeFor(7, new Date('2026-10-24T15:00:00Z'))).toEqual({ from: '2026-10-17', to: '2026-10-23' });
    expect([rangeParam('30'), rangeParam('90'), rangeParam(undefined)]).toEqual([30, 7, 7]);
  });
});
