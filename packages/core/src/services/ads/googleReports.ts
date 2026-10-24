/**
 * GOOGLE ADS REPORTS — the reads a marketer asks of Google Ads beyond the ads
 * family's shared pair: which search terms spent with nothing to show, which
 * keywords carry the account, whether an ad was approved, what converted, and
 * whether a budget will be spent by the end of the month.
 *
 * Each report is fixed GAQL with typed parameters (dates through `gaqlDate`,
 * ids through `idList`), never text a model wrote, so a report can be asked
 * for by name and can only read. Money is in the account's currency units.
 */

import type { GoogleAdsAccess, GoogleAdsReport } from '@/libs/googleAds/client';
import { adsSearch, gaqlDate, microsToUnits } from '@/libs/googleAds/client';
import { idList } from './providers/google';

export type ReportInput = {
  report: GoogleAdsReport;
  from: string;
  to: string;
  /** Narrow to these campaigns. */
  campaignIds?: string[];
  /** Most rows to return (default 200). */
  limit?: number;
};

type Metrics = { impressions?: string; clicks?: string; costMicros?: string; conversions?: number | string; allConversions?: number | string };
type Any = Record<string, any>;

function money(micros: unknown): number {
  return Math.round(microsToUnits(micros) * 100) / 100;
}

/**
 * Counts and the rates computed from them, the same way for every report.
 * @param m - The row's metrics.
 */
export function metricsOf(m: Metrics | undefined): { impressions: number; clicks: number; spend: number; conversions: number; ctr: number | null; cpc: number | null; costPerConversion: number | null } {
  const impressions = Number(m?.impressions ?? 0);
  const clicks = Number(m?.clicks ?? 0);
  const spend = money(m?.costMicros);
  const conversions = Math.round(Number(m?.conversions ?? 0) * 100) / 100;
  return {
    impressions,
    clicks,
    spend,
    conversions,
    ctr: impressions > 0 ? Math.round(clicks / impressions * 10000) / 10000 : null,
    cpc: clicks > 0 ? Math.round(spend / clicks * 100) / 100 : null,
    costPerConversion: conversions > 0 ? Math.round(spend / conversions * 100) / 100 : null,
  };
}

const METRICS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions';

function campaignFilter(ids: string[] | undefined): string {
  return ids && ids.length > 0 ? ` AND campaign.id IN (${idList(ids)})` : '';
}

function limitOf(n: number | undefined): number {
  return Math.max(1, Math.min(n ?? 200, 2000));
}

/**
 * The days of a month and how many have passed, for pacing.
 * @param today - YYYY-MM-DD.
 */
export function monthProgress(today: string): { first: string; daysInMonth: number; dayOfMonth: number } {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${today.slice(0, 7)}-01`, daysInMonth, dayOfMonth: d };
}

/**
 * Run one report.
 * @param access - The account and login.
 * @param input - Which report, over which dates.
 */
export async function runGoogleAdsReport(access: GoogleAdsAccess, input: ReportInput): Promise<{ report: GoogleAdsReport; from: string; to: string; rows: Any[]; note?: string }> {
  const range = `segments.date BETWEEN ${gaqlDate(input.from)} AND ${gaqlDate(input.to)}`;
  const limit = limitOf(input.limit);
  const camp = campaignFilter(input.campaignIds);
  const base = { report: input.report, from: input.from, to: input.to };
  switch (input.report) {
    case 'campaigns': {
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status, campaign.bidding_strategy_type, campaign.advertising_channel_type, campaign_budget.amount_micros, ${METRICS} FROM campaign WHERE ${range} AND campaign.status != 'REMOVED'${camp} ORDER BY metrics.cost_micros DESC LIMIT ${limit}`, limit);
      return { ...base, rows: rows.map(r => ({ id: r.campaign?.id, name: r.campaign?.name, status: r.campaign?.status, serving: r.campaign?.primaryStatus ?? r.campaign?.servingStatus, bidding: r.campaign?.biddingStrategyType, channel: r.campaign?.advertisingChannelType, dailyBudget: money(r.campaignBudget?.amountMicros), ...metricsOf(r.metrics) })) };
    }
    case 'campaign_daily': {
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, segments.date, ${METRICS} FROM campaign WHERE ${range}${camp} ORDER BY segments.date`, 5000);
      return { ...base, rows: rows.map(r => ({ date: r.segments?.date, campaignId: r.campaign?.id, campaign: r.campaign?.name, ...metricsOf(r.metrics) })) };
    }
    case 'keywords': {
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ${METRICS} FROM keyword_view WHERE ${range}${camp} ORDER BY metrics.cost_micros DESC LIMIT ${limit}`, limit);
      return { ...base, rows: rows.map(r => ({ campaignId: r.campaign?.id, campaign: r.campaign?.name, adGroupId: r.adGroup?.id, adGroup: r.adGroup?.name, criterionId: r.adGroupCriterion?.criterionId, keyword: r.adGroupCriterion?.keyword?.text, matchType: r.adGroupCriterion?.keyword?.matchType, status: r.adGroupCriterion?.status, ...metricsOf(r.metrics) })) };
    }
    case 'search_terms': {
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term, search_term_view.status, ${METRICS} FROM search_term_view WHERE ${range}${camp} ORDER BY metrics.cost_micros DESC LIMIT ${limit}`, limit);
      return {
        ...base,
        rows: rows.map(r => ({
          term: r.searchTermView?.searchTerm,
          // ADDED: already a keyword; EXCLUDED: already a negative; ADDED_EXCLUDED: both; NONE: neither.
          already: r.searchTermView?.status === 'ADDED' ? 'keyword' : r.searchTermView?.status === 'EXCLUDED' ? 'negative' : r.searchTermView?.status === 'ADDED_EXCLUDED' ? 'keyword and negative' : null,
          campaignId: r.campaign?.id,
          campaign: r.campaign?.name,
          adGroupId: r.adGroup?.id,
          adGroup: r.adGroup?.name,
          ...metricsOf(r.metrics),
        })),
      };
    }
    case 'ads': {
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.policy_topic_entries, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ${METRICS} FROM ad_group_ad WHERE ${range} AND ad_group_ad.status != 'REMOVED'${camp} LIMIT ${limit}`, limit);
      return {
        ...base,
        rows: rows.map((r) => {
          const ad = r.adGroupAd?.ad ?? {};
          const policy = r.adGroupAd?.policySummary ?? {};
          return {
            campaignId: r.campaign?.id,
            campaign: r.campaign?.name,
            adGroupId: r.adGroup?.id,
            adId: ad.id,
            type: ad.type,
            finalUrl: ad.finalUrls?.[0] ?? null,
            status: r.adGroupAd?.status,
            approval: policy.approvalStatus,
            review: policy.reviewStatus,
            policyTopics: (policy.policyTopicEntries ?? []).map((e: Any) => `${e.topic}${e.type ? ` (${e.type})` : ''}`),
            headlines: (ad.responsiveSearchAd?.headlines ?? []).map((h: Any) => h.text),
            descriptions: (ad.responsiveSearchAd?.descriptions ?? []).map((d: Any) => d.text),
            ...metricsOf(r.metrics),
          };
        }),
      };
    }
    case 'conversions': {
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, segments.conversion_action_name, metrics.conversions, metrics.all_conversions, metrics.conversions_value FROM campaign WHERE ${range}${camp}`, 5000);
      const actions = await adsSearch<Any>(access, `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.primary_for_goal, conversion_action.type FROM conversion_action WHERE conversion_action.status != 'REMOVED'`, 500);
      return {
        ...base,
        rows: rows.filter(r => Number(r.metrics?.allConversions ?? 0) > 0).map(r => ({ campaignId: r.campaign?.id, campaign: r.campaign?.name, action: r.segments?.conversionActionName, conversions: Number(r.metrics?.conversions ?? 0), allConversions: Number(r.metrics?.allConversions ?? 0), value: Number(r.metrics?.conversionsValue ?? 0) })),
        note: `Conversion actions: ${actions.map(a => `${a.conversionAction?.name} (${a.conversionAction?.status}${a.conversionAction?.primaryForGoal ? ', primary' : ''})`).join('; ') || 'none'}.`,
      };
    }
    case 'budget_pacing': {
      const today = input.to;
      const { first, daysInMonth, dayOfMonth } = monthProgress(today);
      const rows = await adsSearch<Any>(access, `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN ${gaqlDate(first)} AND ${gaqlDate(today)} AND campaign.status = 'ENABLED'${camp}`, 1000);
      return {
        ...base,
        from: first,
        rows: rows.map((r) => {
          const daily = money(r.campaignBudget?.amountMicros);
          const spent = money(r.metrics?.costMicros);
          const monthBudget = Math.round(daily * daysInMonth * 100) / 100;
          const projected = dayOfMonth > 0 ? Math.round(spent / dayOfMonth * daysInMonth * 100) / 100 : 0;
          return { campaignId: r.campaign?.id, campaign: r.campaign?.name, dailyBudget: daily, monthToDate: spent, monthBudget, projectedMonth: projected, pace: monthBudget > 0 ? Math.round(projected / monthBudget * 100) / 100 : null };
        }),
        note: `Day ${dayOfMonth} of ${daysInMonth}. Google may spend up to twice a campaign's daily budget on one day, and no more than its daily budget times the days in the month.`,
      };
    }
  }
}
