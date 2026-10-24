/**
 * What the Marketing app's pages read: the connected Google Ads account,
 * live, through the same reports the Marketing lead reads (`ads/googleReports.ts`).
 * Nothing is stored; every page load asks Google.
 *
 * A workspace with no Google Ads source, or one whose login Google refuses,
 * gets `{ ok: false, reason }` with the sentence that names the fix, so the
 * page says what to do instead of breaking.
 */

import type { GoogleAdsAccess } from '@/libs/googleAds/client';

export const MARKETING_RANGES = [7, 30] as const;
export type MarketingRange = typeof MARKETING_RANGES[number];

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  serving: string | null;
  bidding: string | null;
  dailyBudget: number;
  spend: number;
  clicks: number;
  impressions: number;
  ctr: number | null;
  cpc: number | null;
  conversions: number;
  costPerConversion: number | null;
};

export type SearchTermRow = {
  term: string;
  already: string | null;
  campaignId: string;
  campaign: string;
  adGroupId: string;
  adGroup: string;
  spend: number;
  clicks: number;
  conversions: number;
};

type Read<T> = { ok: true; account: string; from: string; to: string } & T | { ok: false; reason: string };

/**
 * The range a page shows, ending yesterday (today's numbers are still moving).
 * @param days - 7 or 30.
 * @param now - The clock, for tests.
 */
export function rangeFor(days: MarketingRange, now = new Date()): { from: string; to: string } {
  const day = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10);
  return { from: day(days), to: day(1) };
}

/**
 * A range from a search param, 7 unless it says 30.
 * @param value - `?days=`.
 */
export function rangeParam(value: string | string[] | undefined): MarketingRange {
  return value === '30' ? 30 : 7;
}

async function access(orgId: string): Promise<GoogleAdsAccess> {
  const [{ googleAdsSourceFor }, { googleAdsAccessFor }] = await Promise.all([import('@/services/ads/provider'), import('@/services/ads/providers/google')]);
  return googleAdsAccessFor(orgId, await googleAdsSourceFor(orgId));
}

async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; reason: string }> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Every campaign with what it spent and bought over the range.
 * @param orgId - The workspace.
 * @param days - 7 or 30.
 */
export async function readCampaigns(orgId: string, days: MarketingRange): Promise<Read<{ campaigns: CampaignRow[] }>> {
  return guarded(async () => {
    const a = await access(orgId);
    const { runGoogleAdsReport } = await import('@/services/ads/googleReports');
    const range = rangeFor(days);
    const out = await runGoogleAdsReport(a, { report: 'campaigns', ...range, limit: 500 });
    return { ok: true as const, account: a.customerId, ...range, campaigns: out.rows as CampaignRow[] };
  });
}

/**
 * One campaign: its totals, its days, its keywords and its ads.
 * @param orgId - The workspace.
 * @param campaignId - The campaign.
 * @param days - 7 or 30.
 */
export async function readCampaign(orgId: string, campaignId: string, days: MarketingRange): Promise<Read<{ campaign: CampaignRow | null; daily: Array<{ date: string; spend: number; clicks: number; conversions: number }>; keywords: Array<Record<string, unknown>>; ads: Array<Record<string, unknown>> }>> {
  return guarded(async () => {
    const a = await access(orgId);
    const { runGoogleAdsReport } = await import('@/services/ads/googleReports');
    const range = rangeFor(days);
    const ids = [campaignId];
    const [totals, daily, keywords, ads] = await Promise.all([
      runGoogleAdsReport(a, { report: 'campaigns', ...range, campaignIds: ids }),
      runGoogleAdsReport(a, { report: 'campaign_daily', ...range, campaignIds: ids }),
      runGoogleAdsReport(a, { report: 'keywords', ...range, campaignIds: ids, limit: 200 }),
      runGoogleAdsReport(a, { report: 'ads', ...range, campaignIds: ids, limit: 50 }),
    ]);
    return {
      ok: true as const,
      account: a.customerId,
      ...range,
      campaign: (totals.rows[0] as CampaignRow | undefined) ?? null,
      daily: daily.rows.map(r => ({ date: String(r.date), spend: Number(r.spend), clicks: Number(r.clicks), conversions: Number(r.conversions) })),
      keywords: keywords.rows,
      ads: ads.rows,
    };
  });
}

/**
 * What people searched, most spend first, with whether each is already a keyword or a negative.
 * @param orgId - The workspace.
 * @param days - 7 or 30.
 */
export async function readSearchTerms(orgId: string, days: MarketingRange): Promise<Read<{ terms: SearchTermRow[] }>> {
  return guarded(async () => {
    const a = await access(orgId);
    const { runGoogleAdsReport } = await import('@/services/ads/googleReports');
    const range = rangeFor(days);
    const out = await runGoogleAdsReport(a, { report: 'search_terms', ...range, limit: 300 });
    return { ok: true as const, account: a.customerId, ...range, terms: out.rows as SearchTermRow[] };
  });
}
