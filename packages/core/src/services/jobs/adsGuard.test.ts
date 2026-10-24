import { describe, expect, it } from 'vitest';
import { guardEvents } from './adsGuard';

const BASE = { customerId: '1234567890', today_: '2026-11-03', ads: [], yesterday: [], today: [], conversions: [] };
const usd = (n: number) => String(n * 1_000_000);

describe('the ads guard raises an event only when something changed (ADR 0008)', () => {
  it('raises nothing for a healthy account', () => {
    expect(guardEvents({
      ...BASE,
      ads: [{ campaign: { id: '11', name: 'Kestrel · Search' }, adGroupAd: { ad: { id: '501' }, policySummary: { approvalStatus: 'APPROVED' } } }],
      yesterday: [{ campaign: { id: '11', name: 'Kestrel · Search' }, campaignBudget: { amountMicros: usd(50) }, metrics: { costMicros: usd(42) } }],
      today: [{ campaign: { id: '11' }, campaignBudget: { amountMicros: usd(50) }, metrics: { costMicros: usd(10) } }],
      conversions: [{ campaign: { id: '11', startDate: '2026-10-24' }, metrics: { conversions: 0 } }],
    })).toEqual([]);
  });

  it('rings once per limited ad and status', () => {
    const [e] = guardEvents({ ...BASE, ads: [{ campaign: { id: '11', name: 'Kestrel · Search' }, adGroupAd: { ad: { id: '501' }, policySummary: { approvalStatus: 'APPROVED_LIMITED', policyTopicEntries: [{ topic: 'TRADEMARKS_IN_AD_TEXT' }] } } }] });

    expect(e).toEqual({ type: 'ads.ad_limited', dedupeKey: 'ads.ad_limited:1234567890:501:APPROVED_LIMITED', payload: expect.objectContaining({ adId: '501', status: 'APPROVED_LIMITED', topics: ['TRADEMARKS_IN_AD_TEXT'] }) });
  });

  it('flags yesterday under a quarter or over 1.5× its budget, and today over 1.5× — never today under, which is only the morning', () => {
    const events = guardEvents({
      ...BASE,
      yesterday: [
        { campaign: { id: '11', name: 'Quiet' }, campaignBudget: { amountMicros: usd(50) }, metrics: { costMicros: usd(5) } },
        { campaign: { id: '12', name: 'Hot' }, campaignBudget: { amountMicros: usd(50) }, metrics: { costMicros: usd(90) } },
      ],
      today: [
        { campaign: { id: '11', name: 'Quiet' }, campaignBudget: { amountMicros: usd(50) }, metrics: { costMicros: usd(1) } },
        { campaign: { id: '13', name: 'Spike' }, campaignBudget: { amountMicros: usd(20) }, metrics: { costMicros: usd(41) } },
      ],
    });

    expect(events.map(e => e.dedupeKey)).toEqual([
      'ads.pacing_off:1234567890:11:2026-11-03:yesterday:under',
      'ads.pacing_off:1234567890:12:2026-11-03:yesterday:over',
      'ads.pacing_off:1234567890:13:2026-11-03:today:over',
    ]);
  });

  it('calls a first conversion only for a young campaign, once per campaign', () => {
    const events = guardEvents({
      ...BASE,
      conversions: [
        { campaign: { id: '11', name: 'New', startDate: '2026-10-24' }, metrics: { conversions: 1 } },
        { campaign: { id: '12', name: 'Old', startDate: '2025-01-10' }, metrics: { conversions: 40 } },
      ],
    });

    expect(events).toEqual([{ type: 'ads.first_conversion', dedupeKey: 'ads.first_conversion:1234567890:11', payload: { campaignId: '11', campaign: 'New', conversions: 1 } }]);
  });
});
