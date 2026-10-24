/**
 * GOOGLE ADS WRITES — every change to a Google Ads account is a proposal a
 * person approves (`approvalRequired`), because each one moves money: what a
 * campaign may spend, what it bids on, what it says. A person's own tap on the
 * Marketing app is that approval.
 *
 *   google_ads.set_budget             a campaign's daily budget
 *   google_ads.add_negatives          negative keywords on a campaign
 *   google_ads.add_keywords           keywords in an ad group
 *   google_ads.set_keyword_status     pause or enable one keyword
 *   google_ads.edit_ad_text           a responsive search ad's headlines and descriptions
 *   google_ads.create_search_campaign a whole search campaign from a spec
 *
 * Pausing or resuming a campaign or ad group is the family's `ads.set_status`.
 *
 * Every execute asks Google to validate the whole batch first
 * (`adsValidateThenMutate`), applies it atomically, then reads the result back
 * and reports what is true now. Every action records what it changed so Undo
 * can put it back.
 */

import type { Action } from './types';
import type { GoogleAdsAccess } from '@/libs/googleAds/client';
import { z } from 'zod';

const SOURCE = z.string().optional().describe('The Google Ads source, when the workspace has more than one.');
const ID = z.string().regex(/^\d{1,20}$/, 'Google Ads ids are digits');
const REASON = z.string().max(400).optional().describe('Why, in one sentence the person reads on the card: "spent $84 on 31 clicks for jobs searches".');
const MATCH = z.enum(['EXACT', 'PHRASE', 'BROAD']);
const KEYWORD = z.object({
  text: z.string().trim().min(1).max(80).describe('The keyword text, without match-type punctuation.'),
  match: MATCH.default('PHRASE'),
});

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;

async function accessFor(orgId: string, source: string | undefined): Promise<GoogleAdsAccess> {
  const [{ googleAdsSourceFor }, { googleAdsAccessFor }] = await Promise.all([import('@/services/ads/provider'), import('@/services/ads/providers/google')]);
  return googleAdsAccessFor(orgId, await googleAdsSourceFor(orgId, { sourceSlug: source ?? null }));
}

async function client() {
  return import('@/libs/googleAds/client');
}

function money(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}

type CampaignBudget = { name: string; budgetResource: string; amount: number; shared: boolean; currency: string; status: string };

async function campaignBudget(access: GoogleAdsAccess, campaignId: string): Promise<CampaignBudget> {
  const { adsSearch, microsToUnits } = await client();
  const rows = await adsSearch<{ campaign?: { name?: string; status?: string }; campaignBudget?: { resourceName?: string; amountMicros?: string; explicitlyShared?: boolean }; customer?: { currencyCode?: string } }>(access, `SELECT campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, customer.currency_code FROM campaign WHERE campaign.id = ${campaignId}`, 1);
  const r = rows[0];
  if (!r?.campaignBudget?.resourceName) {
    throw new Error(`No campaign ${campaignId} with a budget in this Google Ads account.`);
  }
  return {
    name: r.campaign?.name ?? campaignId,
    budgetResource: r.campaignBudget.resourceName,
    amount: microsToUnits(r.campaignBudget.amountMicros),
    shared: Boolean(r.campaignBudget.explicitlyShared),
    currency: r.customer?.currencyCode ?? 'USD',
    status: r.campaign?.status ?? 'UNKNOWN',
  };
}

async function campaignName(access: GoogleAdsAccess, campaignId: string): Promise<string> {
  const { adsSearch } = await client();
  const rows = await adsSearch<{ campaign?: { name?: string } }>(access, `SELECT campaign.name FROM campaign WHERE campaign.id = ${campaignId}`, 1);
  return rows[0]?.campaign?.name ?? campaignId;
}

async function adGroupName(access: GoogleAdsAccess, adGroupId: string): Promise<{ adGroup: string; campaign: string }> {
  const { adsSearch } = await client();
  const rows = await adsSearch<{ adGroup?: { name?: string }; campaign?: { name?: string } }>(access, `SELECT ad_group.name, campaign.name FROM ad_group WHERE ad_group.id = ${adGroupId}`, 1);
  return { adGroup: rows[0]?.adGroup?.name ?? adGroupId, campaign: rows[0]?.campaign?.name ?? '' };
}

function quoted(k: { text: string; match: string }): string {
  return k.match === 'EXACT' ? `[${k.text}]` : k.match === 'PHRASE' ? `"${k.text}"` : k.text;
}

function failed(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- budget

const setBudgetInput = z.object({
  campaign_id: ID.describe('The campaign, from ads_report campaigns.'),
  daily_budget: z.number().positive().max(100_000).describe('The new daily budget in the account currency, e.g. 75.'),
  reason: REASON,
  source: SOURCE,
});

export const googleAdsSetBudgetAction: Action<typeof setBudgetInput> = {
  id: 'google_ads.set_budget',
  name: 'Change a Google Ads campaign budget',
  description: 'Set a Google Ads campaign\'s average daily budget. Google may spend up to twice it on one day and no more than it times the days in the month. Undo puts the old budget back.',
  inputSchema: setBudgetInput,
  grant: 'manage_ads',
  external: true,
  approvalRequired: true,
  dedupKeyFor: input => `google_ads.set_budget:${input.source ?? ''}:${input.campaign_id}:${input.daily_budget}`,
  async precheck(ctx, input) {
    try {
      const b = await campaignBudget(await accessFor(ctx.orgId, input.source), input.campaign_id);
      if (b.shared) {
        return `${b.name} uses a shared budget, which other campaigns spend from too; change it in Google Ads, where every campaign on it is listed.`;
      }
    } catch (err) {
      return failed(err);
    }
    return undefined;
  },
  async reviewCard(ctx, input) {
    let now: CampaignBudget | null = null;
    try {
      now = await campaignBudget(await accessFor(ctx.orgId, input.source), input.campaign_id);
    } catch {
      // The card still reads with the ids.
    }
    const currency = now?.currency ?? 'USD';
    return {
      title: `Set ${now?.name ?? `campaign ${input.campaign_id}`} to ${money(input.daily_budget, currency)} a day`,
      system: 'Google Ads',
      headline: now ? `${money(now.amount, currency)} a day now; ${money(input.daily_budget, currency)} a day after. About ${money(input.daily_budget * 30.4, currency)} a month.` : `${money(input.daily_budget, currency)} a day.`,
      badges: [{ label: 'Google Ads' }, { label: 'Changes spend', tone: 'warn' }, { label: 'Undo puts it back' }],
      fields: [
        { label: 'Campaign', value: now?.name ?? input.campaign_id },
        ...(now ? [{ label: 'Now', value: `${money(now.amount, currency)} a day` }] : []),
        { label: 'After', value: `${money(input.daily_budget, currency)} a day` },
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      nextAction: 'Approving changes what the campaign may spend from now on.',
      verbs: { approve: 'Set budget', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const access = await accessFor(ctx.orgId, input.source);
    const { adsValidateThenMutate, unitsToMicros } = await client();
    const before = await campaignBudget(access, input.campaign_id);
    if (before.shared) {
      throw new Error(`${before.name} uses a shared budget; change it in Google Ads.`);
    }
    await adsValidateThenMutate(access, [{ campaignBudgetOperation: { update: { resourceName: before.budgetResource, amountMicros: unitsToMicros(input.daily_budget) }, updateMask: 'amount_micros' } }]);
    const after = await campaignBudget(access, input.campaign_id);
    return {
      campaignId: input.campaign_id,
      name: after.name,
      from: before.amount,
      to: after.amount,
      budgetResource: before.budgetResource,
      line: `${after.name}: ${money(before.amount, after.currency)} → ${money(after.amount, after.currency)} a day${input.reason ? `, because ${input.reason}` : ''}.`,
    };
  },
  async undo(ctx, input, result) {
    const from = typeof result?.from === 'number' ? result.from : null;
    const resource = typeof result?.budgetResource === 'string' ? result.budgetResource : null;
    if (from === null || !resource) {
      return { restored: false, note: 'The old budget was not recorded; set it in Google Ads.' };
    }
    const access = await accessFor(ctx.orgId, input.source);
    const { adsValidateThenMutate, unitsToMicros } = await client();
    await adsValidateThenMutate(access, [{ campaignBudgetOperation: { update: { resourceName: resource, amountMicros: unitsToMicros(from) }, updateMask: 'amount_micros' } }]);
    return { restored: true, line: `Budget back to ${money(from)} a day.` };
  },
};

// ---------------------------------------------------------------- negatives

const addNegativesInput = z.object({
  campaign_id: ID.describe('The campaign the negatives keep searches out of.'),
  terms: z.array(KEYWORD).min(1).max(50).describe('The searches to stop showing for. PHRASE (default) blocks any search containing the words in order; EXACT only that search.'),
  reason: REASON,
  source: SOURCE,
});

export const googleAdsAddNegativesAction: Action<typeof addNegativesInput> = {
  id: 'google_ads.add_negatives',
  name: 'Add negative keywords to a Google Ads campaign',
  description: 'Stop a Google Ads campaign showing for searches it wastes money on, as campaign-level negative keywords. Undo removes exactly the ones added.',
  inputSchema: addNegativesInput,
  grant: 'manage_ads',
  external: true,
  approvalRequired: true,
  recordCount: input => input.terms.length,
  dedupKeyFor: input => `google_ads.add_negatives:${input.source ?? ''}:${input.campaign_id}:${input.terms.map(t => `${t.match}:${t.text.toLowerCase()}`).sort().join('|')}`,
  async reviewCard(ctx, input) {
    let name = input.campaign_id;
    try {
      name = await campaignName(await accessFor(ctx.orgId, input.source), input.campaign_id);
    } catch {
      // Ids alone.
    }
    return {
      title: `Add ${input.terms.length} negative keyword${input.terms.length === 1 ? '' : 's'} to ${name}`,
      system: 'Google Ads',
      headline: `${name} stops showing for these searches.`,
      badges: [{ label: 'Google Ads' }, { label: 'Undo removes them' }],
      fields: [
        { label: 'Campaign', value: name },
        { label: 'Negatives', value: input.terms.map(quoted).join(', ') },
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      verbs: { approve: 'Add negatives', reject: 'Leave them' },
    };
  },
  async execute(ctx, input) {
    const access = await accessFor(ctx.orgId, input.source);
    const { adsValidateThenMutate, createdNames } = await client();
    const campaign = `customers/${access.customerId}/campaigns/${input.campaign_id}`;
    const res = await adsValidateThenMutate(access, input.terms.map(t => ({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: t.text, matchType: t.match } } } })));
    const created = createdNames(res);
    return { campaignId: input.campaign_id, created, count: created.length, line: `Added ${created.length} negative${created.length === 1 ? '' : 's'}: ${input.terms.map(quoted).join(', ')}.` };
  },
  async undo(ctx, input, result) {
    const created = Array.isArray(result?.created) ? result.created.filter((r): r is string => typeof r === 'string') : [];
    if (created.length === 0) {
      return { restored: false, note: 'Nothing was recorded as added.' };
    }
    const access = await accessFor(ctx.orgId, input.source);
    const { adsValidateThenMutate } = await client();
    await adsValidateThenMutate(access, created.map(resourceName => ({ campaignCriterionOperation: { remove: resourceName } })));
    return { restored: true, line: `Removed the ${created.length} negatives.` };
  },
};

// ---------------------------------------------------------------- keywords

const addKeywordsInput = z.object({
  ad_group_id: ID.describe('The ad group the keywords join, from ads_report keywords.'),
  keywords: z.array(KEYWORD).min(1).max(50),
  reason: REASON,
  source: SOURCE,
});

export const googleAdsAddKeywordsAction: Action<typeof addKeywordsInput> = {
  id: 'google_ads.add_keywords',
  name: 'Add keywords to a Google Ads ad group',
  description: 'Add keywords to a Google Ads ad group, so its ads can show for those searches. New keywords can spend; Undo removes exactly the ones added.',
  inputSchema: addKeywordsInput,
  grant: 'manage_ads',
  external: true,
  approvalRequired: true,
  recordCount: input => input.keywords.length,
  dedupKeyFor: input => `google_ads.add_keywords:${input.source ?? ''}:${input.ad_group_id}:${input.keywords.map(t => `${t.match}:${t.text.toLowerCase()}`).sort().join('|')}`,
  async reviewCard(ctx, input) {
    let where = { adGroup: input.ad_group_id, campaign: '' };
    try {
      where = await adGroupName(await accessFor(ctx.orgId, input.source), input.ad_group_id);
    } catch {
      // Ids alone.
    }
    return {
      title: `Add ${input.keywords.length} keyword${input.keywords.length === 1 ? '' : 's'} to ${where.adGroup}`,
      system: 'Google Ads',
      headline: `${where.campaign ? `${where.campaign} · ` : ''}${where.adGroup} starts bidding on these searches.`,
      badges: [{ label: 'Google Ads' }, { label: 'Can spend', tone: 'warn' }, { label: 'Undo removes them' }],
      fields: [
        { label: 'Ad group', value: where.adGroup },
        { label: 'Keywords', value: input.keywords.map(quoted).join(', ') },
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      verbs: { approve: 'Add keywords', reject: 'Leave them' },
    };
  },
  async execute(ctx, input) {
    const access = await accessFor(ctx.orgId, input.source);
    const { adsValidateThenMutate, createdNames } = await client();
    const adGroup = `customers/${access.customerId}/adGroups/${input.ad_group_id}`;
    const res = await adsValidateThenMutate(access, input.keywords.map(k => ({ adGroupCriterionOperation: { create: { adGroup, status: 'ENABLED', keyword: { text: k.text, matchType: k.match } } } })));
    const created = createdNames(res);
    return { adGroupId: input.ad_group_id, created, count: created.length, line: `Added ${created.length} keyword${created.length === 1 ? '' : 's'}: ${input.keywords.map(quoted).join(', ')}.` };
  },
  async undo(ctx, input, result) {
    const created = Array.isArray(result?.created) ? result.created.filter((r): r is string => typeof r === 'string') : [];
    if (created.length === 0) {
      return { restored: false, note: 'Nothing was recorded as added.' };
    }
    const access = await accessFor(ctx.orgId, input.source);
    const { adsValidateThenMutate } = await client();
    await adsValidateThenMutate(access, created.map(resourceName => ({ adGroupCriterionOperation: { remove: resourceName } })));
    return { restored: true, line: `Removed the ${created.length} keywords.` };
  },
};

// ---------------------------------------------------------------- keyword status

const keywordStatusInput = z.object({
  ad_group_id: ID,
  criterion_id: ID.describe('The keyword\'s criterionId, from ads_report keywords.'),
  state: z.enum(['paused', 'active']),
  reason: REASON,
  source: SOURCE,
});

async function keywordRow(access: GoogleAdsAccess, adGroupId: string, criterionId: string): Promise<{ text: string; match: string; status: string }> {
  const { adsSearch } = await client();
  const rows = await adsSearch<{ adGroupCriterion?: { status?: string; keyword?: { text?: string; matchType?: string } } }>(access, `SELECT ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.criterion_id = ${criterionId}`, 1);
  const c = rows[0]?.adGroupCriterion;
  if (!c) {
    throw new Error(`No keyword ${criterionId} in ad group ${adGroupId}.`);
  }
  return { text: c.keyword?.text ?? criterionId, match: c.keyword?.matchType ?? '', status: c.status ?? 'UNKNOWN' };
}

async function setKeywordStatus(access: GoogleAdsAccess, adGroupId: string, criterionId: string, status: 'PAUSED' | 'ENABLED') {
  const { adsValidateThenMutate } = await client();
  await adsValidateThenMutate(access, [{ adGroupCriterionOperation: { update: { resourceName: `customers/${access.customerId}/adGroupCriteria/${adGroupId}~${criterionId}`, status }, updateMask: 'status' } }]);
}

export const googleAdsSetKeywordStatusAction: Action<typeof keywordStatusInput> = {
  id: 'google_ads.set_keyword_status',
  name: 'Pause or enable a Google Ads keyword',
  description: 'Pause a keyword that spends without converting, or enable one again. Undo puts it back.',
  inputSchema: keywordStatusInput,
  grant: 'manage_ads',
  external: true,
  approvalRequired: true,
  dedupKeyFor: input => `google_ads.set_keyword_status:${input.source ?? ''}:${input.ad_group_id}~${input.criterion_id}:${input.state}`,
  async reviewCard(ctx, input) {
    let kw = { text: input.criterion_id, match: '', status: '' };
    try {
      kw = await keywordRow(await accessFor(ctx.orgId, input.source), input.ad_group_id, input.criterion_id);
    } catch {
      // Ids alone.
    }
    const verb = input.state === 'paused' ? 'Pause' : 'Enable';
    return {
      title: `${verb} keyword ${quoted({ text: kw.text, match: kw.match })}`,
      system: 'Google Ads',
      headline: `${verb} it now; Undo puts it back.`,
      badges: [{ label: 'Google Ads' }, { label: 'Undo puts it back' }],
      fields: [
        { label: 'Keyword', value: quoted({ text: kw.text, match: kw.match }) },
        ...(kw.status ? [{ label: 'Now', value: kw.status }] : []),
        { label: 'After', value: input.state === 'paused' ? 'PAUSED' : 'ENABLED' },
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      verbs: { approve: verb, reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const access = await accessFor(ctx.orgId, input.source);
    const before = await keywordRow(access, input.ad_group_id, input.criterion_id);
    await setKeywordStatus(access, input.ad_group_id, input.criterion_id, input.state === 'paused' ? 'PAUSED' : 'ENABLED');
    const after = await keywordRow(access, input.ad_group_id, input.criterion_id);
    return { from: before.status, to: after.status, line: `${quoted({ text: after.text, match: after.match })}: ${before.status} → ${after.status}.` };
  },
  async undo(ctx, input, result) {
    const from = result?.from;
    if (from !== 'PAUSED' && from !== 'ENABLED') {
      return { restored: false, note: 'Its earlier state cannot be set from here.' };
    }
    await setKeywordStatus(await accessFor(ctx.orgId, input.source), input.ad_group_id, input.criterion_id, from);
    return { restored: true, line: `Keyword back to ${from}.` };
  },
};

// ---------------------------------------------------------------- ad text

const editAdTextInput = z.object({
  ad_id: ID.describe('The responsive search ad, from ads_report ads.'),
  headlines: z.array(z.string().trim().min(1).max(HEADLINE_MAX)).min(3).max(15).describe(`3 to 15 headlines, each at most ${HEADLINE_MAX} characters.`),
  descriptions: z.array(z.string().trim().min(1).max(DESCRIPTION_MAX)).min(2).max(4).describe(`2 to 4 descriptions, each at most ${DESCRIPTION_MAX} characters.`),
  reason: REASON,
  source: SOURCE,
});

async function adText(access: GoogleAdsAccess, adId: string): Promise<{ headlines: string[]; descriptions: string[] }> {
  const { adsSearch } = await client();
  const rows = await adsSearch<{ adGroupAd?: { ad?: { responsiveSearchAd?: { headlines?: Array<{ text?: string }>; descriptions?: Array<{ text?: string }> } } } }>(access, `SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`, 1);
  const rsa = rows[0]?.adGroupAd?.ad?.responsiveSearchAd;
  if (!rsa) {
    throw new Error(`No responsive search ad ${adId}.`);
  }
  return { headlines: (rsa.headlines ?? []).map(h => h.text ?? '').filter(Boolean), descriptions: (rsa.descriptions ?? []).map(d => d.text ?? '').filter(Boolean) };
}

async function writeAdText(access: GoogleAdsAccess, adId: string, text: { headlines: string[]; descriptions: string[] }) {
  const { adsValidateThenMutate } = await client();
  await adsValidateThenMutate(access, [{ adOperation: { update: { resourceName: `customers/${access.customerId}/ads/${adId}`, responsiveSearchAd: { headlines: text.headlines.map(t => ({ text: t })), descriptions: text.descriptions.map(t => ({ text: t })) } }, updateMask: 'responsive_search_ad.headlines,responsive_search_ad.descriptions' } }]);
}

export const googleAdsEditAdTextAction: Action<typeof editAdTextInput> = {
  id: 'google_ads.edit_ad_text',
  name: 'Edit a Google Ads search ad',
  description: 'Replace a responsive search ad\'s headlines and descriptions. Google reviews the new text before it shows; pins are cleared. Undo puts the old text back.',
  inputSchema: editAdTextInput,
  grant: 'manage_ads',
  external: true,
  approvalRequired: true,
  dedupKeyFor: input => `google_ads.edit_ad_text:${input.source ?? ''}:${input.ad_id}:${[...input.headlines, ...input.descriptions].join('|').length}`,
  async reviewCard(ctx, input) {
    let now: { headlines: string[]; descriptions: string[] } | null = null;
    try {
      now = await adText(await accessFor(ctx.orgId, input.source), input.ad_id);
    } catch {
      // New text alone.
    }
    return {
      title: `Rewrite search ad ${input.ad_id}`,
      system: 'Google Ads',
      headline: 'Google reviews the new text before it shows.',
      badges: [{ label: 'Google Ads' }, { label: 'Undo puts the old text back' }],
      fields: [
        { label: 'New headlines', value: input.headlines.join(' · ') },
        { label: 'New descriptions', value: input.descriptions.join(' · ') },
        ...(now ? [{ label: 'Replaces', value: now.headlines.join(' · ') }] : []),
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      verbs: { approve: 'Update ad', reject: 'Keep the old text' },
    };
  },
  async execute(ctx, input) {
    const access = await accessFor(ctx.orgId, input.source);
    const before = await adText(access, input.ad_id);
    await writeAdText(access, input.ad_id, { headlines: input.headlines, descriptions: input.descriptions });
    const after = await adText(access, input.ad_id);
    return { adId: input.ad_id, before, after, line: `Updated ad ${input.ad_id}: ${after.headlines.length} headlines, ${after.descriptions.length} descriptions, in review at Google.` };
  },
  async undo(ctx, input, result) {
    const before = result?.before as { headlines?: unknown; descriptions?: unknown } | undefined;
    const headlines = Array.isArray(before?.headlines) ? before.headlines.filter((t): t is string => typeof t === 'string') : [];
    const descriptions = Array.isArray(before?.descriptions) ? before.descriptions.filter((t): t is string => typeof t === 'string') : [];
    if (headlines.length < 3 || descriptions.length < 2) {
      return { restored: false, note: 'The old text was not recorded; edit it in Google Ads.' };
    }
    await writeAdText(await accessFor(ctx.orgId, input.source), input.ad_id, { headlines, descriptions });
    return { restored: true, line: 'The old ad text is back, in review at Google.' };
  },
};

// ---------------------------------------------------------------- new campaign

const createCampaignInput = z.object({
  name: z.string().trim().min(3).max(120),
  daily_budget: z.number().positive().max(100_000).describe('Average daily budget in the account currency.'),
  final_url: z.string().url().describe('The landing page every ad goes to.'),
  url_suffix: z.string().max(400).optional().describe('Tracking added to every click, e.g. utm_source=google&utm_medium=cpc&utm_campaign=…'),
  keywords: z.array(KEYWORD).min(1).max(100),
  negatives: z.array(KEYWORD).max(200).default([]),
  headlines: z.array(z.string().trim().min(1).max(HEADLINE_MAX)).min(3).max(15),
  descriptions: z.array(z.string().trim().min(1).max(DESCRIPTION_MAX)).min(2).max(4),
  path1: z.string().max(15).optional(),
  path2: z.string().max(15).optional(),
  locations: z.array(z.number().int().positive()).min(1).max(50).default([2840]).describe('Geo target constant ids; 2840 is the United States.'),
  language: z.number().int().positive().default(1000).describe('Language constant id; 1000 is English.'),
  max_cpc: z.number().positive().max(1000).optional().describe('Bid ceiling per click under Maximize clicks. Omit to let Google bid without a ceiling.'),
  conversion_action_ids: z.array(ID).max(10).optional().describe('Count only these conversion actions for this campaign (a campaign-level goal), instead of the account\'s defaults.'),
  callouts: z.array(z.string().trim().min(1).max(25)).max(20).default([]),
  sitelinks: z.array(z.object({ text: z.string().trim().min(1).max(25), url: z.string().url(), line1: z.string().max(35).optional(), line2: z.string().max(35).optional() })).max(20).default([]),
  start_paused: z.boolean().default(false).describe('Create it paused instead of live.'),
  reason: REASON,
  source: SOURCE,
});

type CreateInput = z.infer<typeof createCampaignInput>;

/**
 * The atomic batch that builds a search campaign: budget, campaign, targeting,
 * negatives, one ad group with its keywords and responsive search ad, then
 * callouts and sitelinks, all linked by temporary resource names.
 * @param customerId - The account.
 * @param input - The spec.
 */
export function campaignOperations(customerId: string, input: CreateInput): unknown[] {
  const c = `customers/${customerId}`;
  const budget = `${c}/campaignBudgets/-1`;
  const campaign = `${c}/campaigns/-2`;
  const adGroup = `${c}/adGroups/-3`;
  const ops: unknown[] = [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${input.name} budget`, amountMicros: Math.round(input.daily_budget * 100) * 10_000, deliveryMethod: 'STANDARD', explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: campaign,
      name: input.name,
      status: input.start_paused ? 'PAUSED' : 'ENABLED',
      advertisingChannelType: 'SEARCH',
      campaignBudget: budget,
      ...(input.url_suffix ? { finalUrlSuffix: input.url_suffix } : {}),
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      targetSpend: input.max_cpc ? { cpcBidCeilingMicros: Math.round(input.max_cpc * 100) * 10_000 } : {},
    } } },
    ...input.locations.map(id => ({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${id}` } } } })),
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${input.language}` } } } },
    ...input.negatives.map(k => ({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: k.text, matchType: k.match } } } })),
    { adGroupOperation: { create: { resourceName: adGroup, campaign, name: input.name, status: 'ENABLED', type: 'SEARCH_STANDARD' } } },
    ...input.keywords.map(k => ({ adGroupCriterionOperation: { create: { adGroup, status: 'ENABLED', keyword: { text: k.text, matchType: k.match } } } })),
    { adGroupAdOperation: { create: { adGroup, status: 'ENABLED', ad: {
      finalUrls: [input.final_url],
      responsiveSearchAd: {
        headlines: input.headlines.map(text => ({ text })),
        descriptions: input.descriptions.map(text => ({ text })),
        ...(input.path1 ? { path1: input.path1 } : {}),
        ...(input.path2 ? { path2: input.path2 } : {}),
      },
    } } } },
  ];
  let next = -10;
  for (const text of input.callouts) {
    const asset = `${c}/assets/${next--}`;
    ops.push({ assetOperation: { create: { resourceName: asset, calloutAsset: { calloutText: text } } } });
    ops.push({ campaignAssetOperation: { create: { campaign, asset, fieldType: 'CALLOUT' } } });
  }
  for (const s of input.sitelinks) {
    const asset = `${c}/assets/${next--}`;
    ops.push({ assetOperation: { create: { resourceName: asset, finalUrls: [s.url], sitelinkAsset: { linkText: s.text, ...(s.line1 ? { description1: s.line1 } : {}), ...(s.line2 ? { description2: s.line2 } : {}) } } } });
    ops.push({ campaignAssetOperation: { create: { campaign, asset, fieldType: 'SITELINK' } } });
  }
  return ops;
}

export const googleAdsCreateSearchCampaignAction: Action<typeof createCampaignInput> = {
  id: 'google_ads.create_search_campaign',
  name: 'Launch a Google Ads search campaign',
  description: 'Build and launch a Google Search campaign from a spec: budget, keywords, negatives, one responsive search ad, callouts, sitelinks, locations and Maximize clicks with an optional bid ceiling. Google checks the whole campaign before anything is created. Undo removes the campaign.',
  inputSchema: createCampaignInput,
  grant: 'manage_ads',
  external: true,
  approvalRequired: true,
  dedupKeyFor: input => `google_ads.create_search_campaign:${input.source ?? ''}:${input.name.toLowerCase()}`,
  async precheck(ctx, input) {
    try {
      const access = await accessFor(ctx.orgId, input.source);
      const { adsMutate, adsSearch, gaqlString } = await client();
      const existing = await adsSearch(access, `SELECT campaign.id FROM campaign WHERE campaign.name = ${gaqlString(input.name)} AND campaign.status != 'REMOVED'`, 1);
      if (existing.length > 0) {
        return `A campaign named "${input.name}" already exists in this account; name the new one differently or change that one.`;
      }
      await adsMutate(access, campaignOperations(access.customerId, input), { validateOnly: true });
    } catch (err) {
      return failed(err);
    }
    return undefined;
  },
  async reviewCard(_ctx, input) {
    return {
      title: `Launch "${input.name}" at ${money(input.daily_budget)} a day`,
      system: 'Google Ads',
      headline: `${input.start_paused ? 'Created paused' : 'Goes live on approval'}: ${input.keywords.length} keywords, ${input.negatives.length} negatives, ${input.headlines.length} headlines, Google Search only.`,
      badges: [{ label: 'Google Ads' }, { label: 'Spends money', tone: 'warn' }, { label: 'Undo removes it' }],
      fields: [
        { label: 'Budget', value: `${money(input.daily_budget)} a day, about ${money(input.daily_budget * 30.4)} a month` },
        { label: 'Bidding', value: input.max_cpc ? `Maximize clicks, at most ${money(input.max_cpc)} a click` : 'Maximize clicks' },
        { label: 'Landing page', value: input.final_url, href: input.final_url },
        { label: 'Keywords', value: input.keywords.map(quoted).join(', ') },
        ...(input.negatives.length > 0 ? [{ label: 'Negatives', value: input.negatives.map(quoted).join(', ') }] : []),
        { label: 'Headlines', value: input.headlines.join(' · ') },
        { label: 'Descriptions', value: input.descriptions.join(' · ') },
        ...(input.conversion_action_ids?.length ? [{ label: 'Counts', value: `${input.conversion_action_ids.length} conversion action${input.conversion_action_ids.length === 1 ? '' : 's'} only` }] : []),
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      nextAction: input.start_paused ? 'Approving creates it paused; nothing spends until it is enabled.' : 'Approving launches it; it starts spending today.',
      verbs: { approve: input.start_paused ? 'Create paused' : 'Launch', reject: 'Don\'t launch' },
    };
  },
  async execute(ctx, input) {
    const access = await accessFor(ctx.orgId, input.source);
    const { adsSearch, adsValidateThenMutate, createdNames, adsUiUrl } = await client();
    const res = await adsValidateThenMutate(access, campaignOperations(access.customerId, input));
    const campaignResource = createdNames(res).find(n => /\/campaigns\/\d+$/.test(n)) ?? '';
    const campaignId = campaignResource.split('/').pop() ?? '';
    if (input.conversion_action_ids?.length && campaignId) {
      const goal = `customers/${access.customerId}/customConversionGoals/-1`;
      await adsValidateThenMutate(access, [
        { customConversionGoalOperation: { create: { resourceName: goal, name: `${input.name} goal`, conversionActions: input.conversion_action_ids.map(id => `customers/${access.customerId}/conversionActions/${id}`), status: 'ENABLED' } } },
        { conversionGoalCampaignConfigOperation: { update: { resourceName: `customers/${access.customerId}/conversionGoalCampaignConfigs/${campaignId}`, goalConfigLevel: 'CAMPAIGN', customConversionGoal: goal }, updateMask: 'goal_config_level,custom_conversion_goal' } },
      ]);
    }
    const rows = campaignId ? await adsSearch<{ campaign?: { status?: string; primaryStatus?: string } }>(access, `SELECT campaign.status, campaign.primary_status FROM campaign WHERE campaign.id = ${campaignId}`, 1) : [];
    const status = rows[0]?.campaign?.status ?? 'UNKNOWN';
    return {
      campaignId,
      campaignResource,
      status,
      serving: rows[0]?.campaign?.primaryStatus ?? null,
      url: campaignId ? adsUiUrl(access.customerId, campaignId) : null,
      line: `Created "${input.name}" (${status}), ${money(input.daily_budget)} a day, ${input.keywords.length} keywords. Google reviews the ad before it shows.`,
    };
  },
  async undo(ctx, input, result) {
    const resource = typeof result?.campaignResource === 'string' ? result.campaignResource : '';
    if (!resource) {
      return { restored: false, note: 'The campaign was not recorded; remove it in Google Ads.' };
    }
    const { adsValidateThenMutate } = await client();
    await adsValidateThenMutate(await accessFor(ctx.orgId, input.source), [{ campaignOperation: { remove: resource } }]);
    return { restored: true, line: `Removed "${input.name}".` };
  },
};

export const GOOGLE_ADS_ACTIONS = [
  googleAdsSetBudgetAction,
  googleAdsAddNegativesAction,
  googleAdsAddKeywordsAction,
  googleAdsSetKeywordStatusAction,
  googleAdsEditAdTextAction,
  googleAdsCreateSearchCampaignAction,
] as const;
