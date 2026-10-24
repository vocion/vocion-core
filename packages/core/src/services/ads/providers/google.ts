/**
 * GOOGLE ADS — a provider of the ads family (`../provider.ts`).
 *
 * The family's levels are Google's: a **campaign** holds the budget and the
 * bidding, an **ad group** (the family's `ad_set`) holds keywords and ads.
 * The login is a Google OAuth grant with the `adwords` scope
 * (`libs/sources/googleAuth.ts`); since developer tokens were retired
 * (2026-09-09) what that login may touch is decided by the Cloud project that
 * owns its OAuth client, so a project still on Test access is refused on a
 * real account with the sentence that names the fix (`libs/googleAds/client.ts`).
 *
 * `googleAdsAccessFor` is the shared door: the reports (`../googleReports.ts`)
 * and the Google Ads actions (`libs/actions/google-ads.ts`) open it too.
 */

import type { AdsEntity, AdsLevel, AdsPerformanceRow, AdsProvider, AdsState } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { GoogleAdsAccess } from '@/libs/googleAds/client';
import { adsMutate, adsSearch, adsUiUrl, customerDigits, gaqlDate, microsToUnits } from '@/libs/googleAds/client';
import { googleAdsConfigSchema } from '@/libs/sources/googleAds';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';
import { ratesOf } from '../provider';

type Row = {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string };
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string; resourceName?: string };
  adGroup?: { id?: string; name?: string; status?: string; type?: string; resourceName?: string };
  campaignBudget?: { amountMicros?: string };
  metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number | string };
  segments?: { date?: string };
};

/**
 * Google's status as the family's state.
 * @param status - ENABLED, PAUSED, REMOVED.
 */
export function googleState(status: string | undefined): AdsState {
  switch (status) {
    case 'ENABLED':
      return 'active';
    case 'PAUSED':
      return 'paused';
    case 'REMOVED':
      return 'archived';
    default:
      return 'other';
  }
}

/**
 * Ids for a GAQL `IN (…)`: digits only, so nothing a model passes can leave the list.
 * @param ids - Campaign or ad group ids.
 */
export function idList(ids: readonly string[]): string {
  const clean = ids.map(id => id.trim());
  if (clean.some(id => !/^\d{1,20}$/.test(id))) {
    throw new Error('Google Ads ids are digits; one of those is not.');
  }
  return clean.join(', ');
}

const FROM: Record<AdsLevel, { resource: string; field: 'campaign' | 'adGroup' }> = {
  campaign: { resource: 'campaign', field: 'campaign' },
  ad_set: { resource: 'ad_group', field: 'adGroup' },
};

/**
 * The family's reads and pause/resume over one Google Ads account.
 * @param input - The account and how to reach it.
 * @param input.sourceSlug - The source this answers for.
 * @param input.access - The login and account (`googleAdsAccessFor`).
 */
export function googleAdsReader(input: { sourceSlug: string; access: GoogleAdsAccess }): AdsProvider {
  const { access } = input;
  const customerId = customerDigits(access.customerId);

  function entity(level: AdsLevel, r: Row): AdsEntity {
    const node = level === 'campaign' ? r.campaign : r.adGroup;
    const id = String(node?.id ?? '');
    return {
      id,
      name: String(node?.name ?? id),
      level,
      status: String(node?.status ?? 'UNKNOWN'),
      state: googleState(node?.status),
      parentId: level === 'ad_set' ? String(r.campaign?.id ?? '') || null : null,
      objective: level === 'campaign' ? (r.campaign?.advertisingChannelType ?? null) : (r.adGroup?.type ?? null),
      dailyBudget: level === 'campaign' && r.campaignBudget?.amountMicros ? microsToUnits(r.campaignBudget.amountMicros) : null,
      totalBudget: null,
      currency: r.customer?.currencyCode ?? null,
      url: adsUiUrl(customerId, level === 'campaign' ? id : String(r.campaign?.id ?? '') || null),
    };
  }

  function selectFor(level: AdsLevel): string {
    return level === 'campaign'
      ? 'campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, customer.currency_code'
      : 'ad_group.id, ad_group.name, ad_group.status, ad_group.type, campaign.id, customer.currency_code';
  }

  async function readOne(level: AdsLevel, id: string): Promise<AdsEntity> {
    const { resource } = FROM[level];
    const rows = await adsSearch<Row>(access, `SELECT ${selectFor(level)} FROM ${resource} WHERE ${resource}.id = ${idList([id])}`, 1);
    if (rows.length === 0) {
      throw new Error(`No ${level === 'campaign' ? 'campaign' : 'ad group'} ${id} in Google Ads account ${customerId}.`);
    }
    return entity(level, rows[0]!);
  }

  return {
    kind: 'google-ads',
    sourceSlug: input.sourceSlug,
    vendor: 'Google Ads',
    accountId: customerId,
    accountUrl: adsUiUrl(customerId),
    levelNames: { campaign: 'campaign', ad_set: 'ad group' },

    async list({ level, state, limit }) {
      const { resource } = FROM[level];
      const where = [`${resource}.status != 'REMOVED'`];
      if (state === 'active') {
        where.push(`${resource}.status = 'ENABLED'`);
      } else if (state === 'paused') {
        where.push(`${resource}.status = 'PAUSED'`);
      }
      const rows = await adsSearch<Row>(access, `SELECT ${selectFor(level)} FROM ${resource} WHERE ${where.join(' AND ')} ORDER BY ${resource}.id DESC LIMIT ${Math.max(1, Math.min(limit, 1000))}`, limit);
      return rows.map(r => entity(level, r));
    },

    read: readOne,

    async performance({ level, from, to, daily, ids }) {
      const where = [`segments.date BETWEEN ${gaqlDate(from)} AND ${gaqlDate(to)}`];
      let select: string;
      let resource: string;
      if (level === 'account') {
        resource = 'customer';
        select = 'customer.id, customer.descriptive_name, customer.currency_code';
      } else {
        resource = FROM[level].resource;
        select = level === 'campaign' ? 'campaign.id, campaign.name, customer.currency_code' : 'ad_group.id, ad_group.name, customer.currency_code';
        if (ids && ids.length > 0) {
          where.push(`${resource}.id IN (${idList(ids)})`);
        }
      }
      const fields = `${select}, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions${daily ? ', segments.date' : ''}`;
      const rows = await adsSearch<Row>(access, `SELECT ${fields} FROM ${resource} WHERE ${where.join(' AND ')}`);
      return rows.map((r): AdsPerformanceRow => {
        const node = level === 'account' ? { id: r.customer?.id, name: r.customer?.descriptiveName } : level === 'campaign' ? r.campaign : r.adGroup;
        const counts = { impressions: Number(r.metrics?.impressions ?? 0), clicks: Number(r.metrics?.clicks ?? 0), spend: microsToUnits(r.metrics?.costMicros) };
        return {
          id: String(node?.id ?? customerId),
          name: String(node?.name ?? node?.id ?? customerId),
          level,
          date: daily ? (r.segments?.date ?? null) : null,
          ...counts,
          conversions: r.metrics?.conversions === undefined ? null : Number(r.metrics.conversions),
          ...ratesOf(counts),
          currency: r.customer?.currencyCode ?? null,
        };
      });
    },

    async setState(level, id, state) {
      const op = level === 'campaign' ? 'campaignOperation' : 'adGroupOperation';
      const resource = level === 'campaign' ? 'campaigns' : 'adGroups';
      const operations = [{ [op]: { update: { resourceName: `customers/${customerId}/${resource}/${idList([id])}`, status: state === 'paused' ? 'PAUSED' : 'ENABLED' }, updateMask: 'status' } }];
      await adsMutate(access, operations, { validateOnly: true });
      await adsMutate(access, operations);
      return readOne(level, id);
    },
  };
}

/**
 * How to reach a Google Ads source's account: a fresh access token from its
 * login, the account id and the manager id it is reached through.
 * @param orgId - The workspace.
 * @param source - The `google-ads` source.
 */
export async function googleAdsAccessFor(orgId: string, source: FamilySource): Promise<GoogleAdsAccess> {
  const config = googleAdsConfigSchema.parse(source.config);
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, 'Google Ads'));
  }
  const { resolveGoogleAccessToken } = await import('@/libs/sources/googleAuth');
  const accessToken = await resolveGoogleAccessToken(bag, orgId);
  return {
    accessToken,
    customerId: customerDigits(config.customerId),
    loginCustomerId: config.loginCustomerId ? customerDigits(config.loginCustomerId) : null,
    developerToken: typeof bag.developerToken === 'string' && bag.developerToken ? bag.developerToken : null,
    baseUrl: config.baseUrl,
  };
}

/**
 * The Google Ads provider for a source.
 * @param orgId - The workspace.
 * @param source - The `google-ads` source.
 */
export async function googleAdsProvider(orgId: string, source: FamilySource): Promise<AdsProvider> {
  return googleAdsReader({ sourceSlug: source.slug, access: await googleAdsAccessFor(orgId, source) });
}
