/**
 * The ads family's reads — an ad platform (Google Ads, LinkedIn Ads, Meta
 * Ads), read live, in one shape whichever vendor answers.
 *
 *   ads_campaigns    campaigns or ad sets with their status and budget.
 *   ads_performance  impressions, clicks, spend and conversions over a range,
 *                    by campaign, ad set or the whole account, per day if asked.
 *   ads_report       Google Ads only: search terms, keywords, ads and their
 *                    policy status, conversions by action, budget pacing —
 *                    named reports with typed dates, never model-written GAQL
 *                    (`services/ads/googleReports.ts`).
 *
 * Present for any agent whose `connectorSources` include an ads source
 * (`familyInScope`), and only over those sources. Pausing or resuming is the
 * `ads.set_status` action through `propose_action`, so the trust ladder, the
 * ledger and Undo apply.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { rangeFrom } from '@/libs/connectors/dateRange';
import { familyInScope, familySourceSlugs, kindOfSource } from '@/libs/connectors/families';
import { GOOGLE_ADS_REPORTS } from '@/libs/googleAds/client';

export const ADS_CAMPAIGNS_TOOL = 'ads_campaigns';
export const ADS_PERFORMANCE_TOOL = 'ads_performance';
export const ADS_REPORT_TOOL = 'ads_report';

export function adsTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'ads')) {
    return [];
  }
  const google = familySourceSlugs(ctx, 'ads').filter(slug => kindOfSource(ctx, slug) === 'google-ads');
  return [campaignsTool(ctx), performanceTool(ctx), ...(google.length > 0 ? [reportTool(ctx, google)] : [])];
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourceArg = z.string().optional().describe('The ads source, when this agent reads more than one.');

async function provider(ctx: RuntimeContext, source: string | undefined) {
  const { adsProviderFor } = await import('@/services/ads/provider');
  return adsProviderFor(ctx.orgId, { sourceSlug: source ?? null, slugs: familySourceSlugs(ctx, 'ads') });
}

function failure(err: unknown): string {
  return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
}

function campaignsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const p = await provider(ctx, args.source);
        const level = args.level ?? 'campaign';
        const rows = await p.list({ level, state: args.state ?? 'all', limit: args.limit ?? 50 });
        return JSON.stringify({
          ok: true,
          ads: p.vendor,
          source: p.sourceSlug,
          account: p.accountId,
          link: p.accountUrl,
          level,
          vendorCalls: p.levelNames[level],
          count: rows.length,
          [level === 'campaign' ? 'campaigns' : 'adSets']: rows,
          note: p.setState
            ? 'To pause or resume one, propose_action ads.set_status with its level and id.'
            : `This ${p.vendor} connection reads only; pausing needs a connection with write access.`,
        });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ADS_CAMPAIGNS_TOOL,
      description: 'The campaigns or ad sets in the connected ad account (Google Ads, LinkedIn Ads or Meta Ads), with status, objective and budget. A campaign groups spend toward one objective (LinkedIn: campaign group); an ad set holds the budget, schedule and audience (LinkedIn: campaign; Google: ad group).',
      schema: z.object({
        level: z.enum(['campaign', 'ad_set']).optional().describe('campaign (default) or ad_set.'),
        state: z.enum(['active', 'paused', 'all']).optional().describe('Default all.'),
        limit: z.number().int().min(1).max(500).optional().describe('How many (default 50).'),
        source: sourceArg,
      }),
    },
  );
}

function performanceTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const range = rangeFrom(args);
        const p = await provider(ctx, args.source);
        const level = args.level ?? 'campaign';
        const rows = await p.performance({ level, ...range, daily: args.daily ?? false, ids: args.ids });
        const totals = rows.reduce((sum, r) => ({ impressions: sum.impressions + r.impressions, clicks: sum.clicks + r.clicks, spend: Math.round((sum.spend + r.spend) * 100) / 100 }), { impressions: 0, clicks: 0, spend: 0 });
        return JSON.stringify({
          ok: true,
          ads: p.vendor,
          source: p.sourceSlug,
          account: p.accountId,
          link: p.accountUrl,
          level,
          ...range,
          count: rows.length,
          rows,
          totals: { ...totals, currency: rows[0]?.currency ?? null },
          note: `Spend in the account's currency, ${range.from} to ${range.to} inclusive, as ${p.vendor} reports it; recent days can still change.`,
        });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ADS_PERFORMANCE_TOOL,
      description: 'What the connected ad account (Google Ads, LinkedIn Ads or Meta Ads) delivered and spent: impressions, clicks, spend, conversions, CTR, CPC and CPM by campaign, ad set or the whole account, over a date range (default the last 30 days, ending yesterday), per day when asked.',
      schema: z.object({
        level: z.enum(['account', 'campaign', 'ad_set']).optional().describe('Default campaign.'),
        from: day.optional().describe('First day, YYYY-MM-DD.'),
        to: day.optional().describe('Last day, YYYY-MM-DD, inclusive.'),
        daily: z.boolean().optional().describe('One row per day per entity (default one row per entity for the range).'),
        ids: z.array(z.string().min(1).max(64)).max(50).optional().describe('Only these campaign or ad set ids, from ads_campaigns.'),
        source: sourceArg,
      }),
    },
  );
}

function reportTool(ctx: RuntimeContext, googleSlugs: string[]): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const range = rangeFrom(args);
        const [{ googleAdsSourceFor }, { googleAdsAccessFor }, { runGoogleAdsReport }] = await Promise.all([
          import('@/services/ads/provider'),
          import('@/services/ads/providers/google'),
          import('@/services/ads/googleReports'),
        ]);
        const source = await googleAdsSourceFor(ctx.orgId, { sourceSlug: args.source ?? null, slugs: googleSlugs });
        const access = await googleAdsAccessFor(ctx.orgId, source);
        const out = await runGoogleAdsReport(access, { report: args.report, ...range, campaignIds: args.campaign_ids, limit: args.limit });
        return JSON.stringify({ ok: true, ads: 'Google Ads', source: source.slug, account: access.customerId, ...out, count: out.rows.length, writes: 'Changes are proposals: propose_action google_ads.set_budget, google_ads.add_negatives, google_ads.add_keywords, google_ads.set_keyword_status, google_ads.edit_ad_text, google_ads.create_search_campaign, or ads.set_status for a campaign or ad group.' });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: ADS_REPORT_TOOL,
      description: 'A named Google Ads report over a date range (default the last 30 days, ending yesterday). campaigns: each campaign\'s status, bidding, daily budget, spend, clicks, CTR, CPC, conversions and cost per conversion. campaign_daily: the same by day. keywords: each keyword with match type and status. search_terms: what people actually searched, with whether each is already a keyword or a negative — the list to find wasted spend in. ads: each ad with its approval and policy status and its headlines. conversions: conversions by action, and which actions exist. budget_pacing: month-to-date spend against each enabled campaign\'s budget (to = today).',
      schema: z.object({
        report: z.enum(GOOGLE_ADS_REPORTS),
        from: day.optional().describe('First day, YYYY-MM-DD.'),
        to: day.optional().describe('Last day, YYYY-MM-DD, inclusive.'),
        campaign_ids: z.array(z.string().regex(/^\d{1,20}$/)).max(50).optional().describe('Only these campaigns.'),
        limit: z.number().int().min(1).max(2000).optional().describe('Most rows (default 200).'),
        source: sourceArg,
      }),
    },
  );
}
