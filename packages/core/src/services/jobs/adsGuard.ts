/**
 * THE ADS GUARD (ADR 0008): a cheap read of the Google Ads account between
 * mornings that wakes the Marketing lead only when something changed. It is a
 * job, not an agent — three GAQL reads and no model — so the four-hourly
 * checks that find nothing cost nothing but the reads.
 *
 * It raises an event for each thing worth waking someone for, and the event's
 * dedupe key makes each one ring once:
 * - `ads.ad_limited` — an enabled ad Google disapproved or limited (once per ad and status);
 * - `ads.pacing_off` — yesterday's spend under a quarter or over 1.5× the daily
 *   budget, or today's already over 1.5× (once per campaign, day and direction);
 * - `ads.first_conversion` — a campaign younger than 60 days records its first
 *   conversion (once per campaign, ever).
 *
 * The Marketing plugin's `marketing-alert` automation answers those events
 * with a mission check that explains and proposes.
 */

import type { GoogleAdsAccess } from '@/libs/googleAds/client';
import { adsSearch, microsToUnits } from '@/libs/googleAds/client';

export const ADS_GUARD_JOB = 'ads-guard';

/** An event the guard raises: its type, its once-only key and what the check needs to know. */
export type GuardEvent = { type: 'ads.ad_limited' | 'ads.pacing_off' | 'ads.first_conversion'; dedupeKey: string; payload: Record<string, unknown> };

type AdRow = { campaign?: { id?: string; name?: string }; adGroupAd?: { ad?: { id?: string }; policySummary?: { approvalStatus?: string; policyTopicEntries?: Array<{ topic?: string }> } } };
type SpendRow = { campaign?: { id?: string; name?: string }; campaignBudget?: { amountMicros?: string }; metrics?: { costMicros?: string } };
type ConversionRow = { campaign?: { id?: string; name?: string; startDate?: string }; metrics?: { conversions?: number | string } };

const LIMITED = new Set(['DISAPPROVED', 'APPROVED_LIMITED', 'AREA_OF_INTEREST_ONLY']);
const UNDER = 0.25;
const OVER = 1.5;
const YOUNG_DAYS = 60;

/**
 * The events in what the account reads like now. Pure: the reads are passed in.
 * @param reads - The three reads.
 * @param reads.ads - Enabled ads with their policy status.
 * @param reads.yesterday - Enabled campaigns' budget and yesterday's spend.
 * @param reads.today - Enabled campaigns' budget and today's spend so far.
 * @param reads.conversions - Enabled campaigns' start date and conversions to date.
 * @param reads.customerId - The account.
 * @param reads.today_ - Today's date in the account's zone, YYYY-MM-DD.
 */
export function guardEvents(reads: { ads: AdRow[]; yesterday: SpendRow[]; today: SpendRow[]; conversions: ConversionRow[]; customerId: string; today_: string }): GuardEvent[] {
  const out: GuardEvent[] = [];
  for (const row of reads.ads) {
    const status = row.adGroupAd?.policySummary?.approvalStatus ?? '';
    const adId = row.adGroupAd?.ad?.id;
    if (!adId || !LIMITED.has(status)) {
      continue;
    }
    const topics = (row.adGroupAd?.policySummary?.policyTopicEntries ?? []).map(t => t.topic).filter(Boolean);
    out.push({
      type: 'ads.ad_limited',
      dedupeKey: `ads.ad_limited:${reads.customerId}:${adId}:${status}`,
      payload: { campaignId: row.campaign?.id, campaign: row.campaign?.name, adId, status, topics },
    });
  }
  const pacing = (rows: SpendRow[], day: 'yesterday' | 'today') => {
    for (const row of rows) {
      const id = row.campaign?.id;
      const budget = microsToUnits(row.campaignBudget?.amountMicros);
      const spend = microsToUnits(row.metrics?.costMicros);
      if (!id || budget <= 0) {
        continue;
      }
      const ratio = spend / budget;
      const direction = ratio > OVER ? 'over' : day === 'yesterday' && ratio < UNDER ? 'under' : null;
      if (!direction) {
        continue;
      }
      out.push({
        type: 'ads.pacing_off',
        dedupeKey: `ads.pacing_off:${reads.customerId}:${id}:${reads.today_}:${day}:${direction}`,
        payload: { campaignId: id, campaign: row.campaign?.name, day, direction, spend, dailyBudget: budget, ratio: Math.round(ratio * 100) / 100 },
      });
    }
  };
  pacing(reads.yesterday, 'yesterday');
  pacing(reads.today, 'today');
  const youngSince = Date.parse(`${reads.today_}T00:00:00Z`) - YOUNG_DAYS * 86_400_000;
  for (const row of reads.conversions) {
    const id = row.campaign?.id;
    const conversions = Number(row.metrics?.conversions ?? 0);
    const started = row.campaign?.startDate ? Date.parse(`${row.campaign.startDate}T00:00:00Z`) : Number.NaN;
    if (!id || conversions <= 0 || !(started >= youngSince)) {
      continue;
    }
    out.push({
      type: 'ads.first_conversion',
      dedupeKey: `ads.first_conversion:${reads.customerId}:${id}`,
      payload: { campaignId: id, campaign: row.campaign?.name, conversions },
    });
  }
  return out;
}

/**
 * Read the account and raise what changed.
 * @param orgId - The workspace.
 * @param input - Unused; the account is the workspace's Google Ads source.
 */
export async function runAdsGuardJob(orgId: string, input: Record<string, unknown> = {}): Promise<{ checked: boolean; raised: string[]; reason?: string }> {
  void input;
  let access: GoogleAdsAccess;
  try {
    const [{ googleAdsSourceFor }, { googleAdsAccessFor }] = await Promise.all([import('@/services/ads/provider'), import('@/services/ads/providers/google')]);
    access = await googleAdsAccessFor(orgId, await googleAdsSourceFor(orgId));
  } catch (err) {
    return { checked: false, raised: [], reason: (err as Error).message };
  }
  const enabled = `campaign.status = 'ENABLED'`;
  const [ads, yesterday, today, conversions, zone] = await Promise.all([
    adsSearch<AdRow>(access, `SELECT campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE ${enabled} AND ad_group_ad.status = 'ENABLED'`),
    adsSearch<SpendRow>(access, `SELECT campaign.id, campaign.name, campaign_budget.amount_micros, metrics.cost_micros FROM campaign WHERE ${enabled} AND segments.date DURING YESTERDAY`),
    adsSearch<SpendRow>(access, `SELECT campaign.id, campaign.name, campaign_budget.amount_micros, metrics.cost_micros FROM campaign WHERE ${enabled} AND segments.date DURING TODAY`),
    adsSearch<ConversionRow>(access, `SELECT campaign.id, campaign.name, campaign.start_date, metrics.conversions FROM campaign WHERE ${enabled}`),
    adsSearch<{ customer?: { timeZone?: string } }>(access, 'SELECT customer.time_zone FROM customer', 1),
  ]);
  const timeZone = zone[0]?.customer?.timeZone ?? 'UTC';
  const today_ = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const events = guardEvents({ ads, yesterday, today, conversions, customerId: access.customerId, today_ });
  const { emitEvent } = await import('@/services/EventService');
  const raised: string[] = [];
  for (const e of events) {
    const res = await emitEvent({ orgId, type: e.type, payload: e.payload, dedupeKey: e.dedupeKey, invokedBy: `job:${ADS_GUARD_JOB}` });
    if (!res.deduped) {
      raised.push(e.dedupeKey);
    }
  }
  return { checked: true, raised };
}
