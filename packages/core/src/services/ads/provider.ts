/**
 * THE ADS FAMILY — an ad platform as an agent reads it.
 *
 * "What did we spend on LinkedIn last month and what did it buy", "which ad
 * sets are burning budget with no clicks" are one question on every ad
 * platform, so the agent has one pair of tools (`ads_campaigns`,
 * `ads_performance`) and one write (`ads.set_status`, pause or resume), and
 * this interface is what each vendor fills in. The source a workspace
 * connected decides which provider answers; the agent never names a vendor.
 *
 * Two levels, named for what they are rather than for one vendor's words:
 * a **campaign** groups spend toward one objective (Meta's campaign,
 * LinkedIn's campaign group) and an **ad set** is where the budget,
 * schedule and audience are set (Meta's ad set, LinkedIn's campaign).
 * `levelNames` carries each vendor's own words so an answer can use them.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { familySourcesForOrg } from '@/libs/connectors/families';

export type AdsLevel = 'campaign' | 'ad_set';
/** The family's word for where something stands; `status` keeps the vendor's own. */
export type AdsState = 'active' | 'paused' | 'archived' | 'other';

/** One campaign or ad set. */
export type AdsEntity = {
  id: string;
  name: string;
  level: AdsLevel;
  /** The vendor's own status word (ACTIVE, PAUSED, DRAFT, …). */
  status: string;
  state: AdsState;
  /** The campaign an ad set belongs to; null for a campaign. */
  parentId: string | null;
  objective: string | null;
  /** Budgets in the account's currency units (not cents), when set at this level. */
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: string | null;
  /** The entity in the vendor's own manager, when there is a stable link. */
  url: string | null;
};

/** What one campaign, ad set or the account did over a range or one day. */
export type AdsPerformanceRow = {
  id: string;
  name: string;
  level: AdsLevel | 'account';
  /** The day, when broken down by day; null for the whole range. */
  date: string | null;
  impressions: number;
  clicks: number;
  /** Spend in the account's currency units. */
  spend: number;
  /** Conversions as the platform counts them, when it reports any. */
  conversions: number | null;
  /** clicks / impressions, 0–1. */
  ctr: number | null;
  /** spend / clicks. */
  cpc: number | null;
  /** spend per 1000 impressions. */
  cpm: number | null;
  currency: string | null;
};

export type AdsProvider = {
  /** The connector kind behind this provider (`meta-ads`). */
  kind: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** The vendor, as a person knows it: "Meta Ads". */
  vendor: string;
  /** The ad account read, as the vendor numbers it. */
  accountId: string;
  /** The account in the vendor's own manager. */
  accountUrl: string | null;
  /** What the vendor calls each level: `{ campaign: 'campaign group', ad_set: 'campaign' }` on LinkedIn. */
  levelNames: Record<AdsLevel, string>;
  /** Campaigns or ad sets, newest first. */
  list: (input: { level: AdsLevel; state: 'active' | 'paused' | 'all'; limit: number }) => Promise<AdsEntity[]>;
  /** Delivery and spend over a range, inclusive, by level; per day when `daily`. */
  performance: (input: { level: AdsLevel | 'account'; from: string; to: string; daily: boolean; ids?: string[] }) => Promise<AdsPerformanceRow[]>;
  /** One campaign or ad set as it stands now. */
  read: (level: AdsLevel, id: string) => Promise<AdsEntity>;
  /**
   * Pause or resume a campaign or ad set. Absent when this connection may
   * only read (a LinkedIn login asks for `r_ads` and nothing more), so the
   * `ads.set_status` action can refuse with a sentence before anything runs.
   */
  setState?: (level: AdsLevel, id: string, state: 'active' | 'paused') => Promise<AdsEntity>;
};

/**
 * The provider for an ads source, or the only one.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - The source to use, when the caller names one.
 * @param opts.slugs - Only these sources: an agent's own, narrowed by the person's ACL.
 */
export async function adsProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<AdsProvider> {
  const sources = await familySourcesForOrg(orgId, 'ads', opts.slugs);
  if (sources.length === 0) {
    throw new Error('No ad platform is connected for this agent. Connect one (LinkedIn Ads or Meta Ads) at /dashboard/connectors and give this agent the source.');
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No ads source named ${opts.sourceSlug}. Connected: ${sources.map(s => `${s.slug} (${s.kind})`).join(', ')}.`);
    }
  } else if (sources.length > 1) {
    throw new Error(`There are ${sources.length} ad platform sources; name one (source). Connected: ${sources.map(s => `${s.slug} (${s.kind})`).join(', ')}.`);
  } else {
    chosen = sources[0]!;
  }
  switch (chosen.kind) {
    case 'linkedin-ads':
      return (await import('./providers/linkedin')).linkedinAdsProvider(orgId, chosen);
    case 'meta-ads':
      return (await import('./providers/meta')).metaAdsProvider(orgId, chosen);
    default:
      throw new Error(`${chosen.slug} is a ${chosen.kind} source, which no ads provider serves yet.`);
  }
}

/**
 * The rates a row carries, from its counts, so every provider computes them
 * the same way rather than trusting each vendor's rounding.
 * @param row - Impressions, clicks and spend.
 * @param row.impressions - Impressions.
 * @param row.clicks - Clicks.
 * @param row.spend - Spend.
 */
export function ratesOf(row: { impressions: number; clicks: number; spend: number }): { ctr: number | null; cpc: number | null; cpm: number | null } {
  const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
  return {
    ctr: row.impressions > 0 ? round(row.clicks / row.impressions, 5) : null,
    cpc: row.clicks > 0 ? round(row.spend / row.clicks, 4) : null,
    cpm: row.impressions > 0 ? round(row.spend / row.impressions * 1000, 4) : null,
  };
}
