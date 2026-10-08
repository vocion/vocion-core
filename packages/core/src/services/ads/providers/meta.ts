/**
 * META ADS — a provider of the ads family (`../provider.ts`).
 *
 * Meta's levels are the family's: a campaign, and an ad set under it. The
 * token is a Business Manager system user token (`meta-ads` platform); with
 * `ads_read` it reads, and with `ads_management` as well `setState` pauses
 * and resumes. A token without it is refused by Meta with code 200, which
 * comes back as the sentence saying so.
 */

import type { AdsEntity, AdsLevel, AdsPerformanceRow, AdsProvider, AdsState } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { MetaResult } from '@/libs/meta/client';
import { actId, budgetUnits, metaCall, metaTokenFrom } from '@/libs/meta/client';
import { metaAdsConfigSchema } from '@/libs/sources/metaAds';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';
import { ratesOf } from '../provider';

type MetaEntity = {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  optimization_goal?: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};
type Page<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };
type InsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  account_id?: string;
  account_name?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  conversions?: Array<{ action_type?: string; value?: string }>;
  date_start?: string;
  account_currency?: string;
};
type MetaAccount = { name?: string; currency?: string; account_status?: number };

const EDGE: Record<AdsLevel, string> = { campaign: 'campaigns', ad_set: 'adsets' };
const ENTITY_FIELDS: Record<AdsLevel, string> = {
  campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget',
  ad_set: 'id,name,status,effective_status,optimization_goal,campaign_id,daily_budget,lifetime_budget',
};
const INSIGHT_LEVEL: Record<AdsLevel | 'account', { level: string; id: keyof InsightRow; name: keyof InsightRow; filter: string | null }> = {
  account: { level: 'account', id: 'account_id', name: 'account_name', filter: null },
  campaign: { level: 'campaign', id: 'campaign_id', name: 'campaign_name', filter: 'campaign.id' },
  ad_set: { level: 'adset', id: 'adset_id', name: 'adset_name', filter: 'adset.id' },
};
const PAGE = 500;

/**
 * Meta's status as the family's state. `status` is what was set; the
 * delivery the person sees is `effective_status`, kept beside it.
 * @param status - ACTIVE, PAUSED, ARCHIVED, DELETED.
 */
export function metaState(status: string | undefined): AdsState {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'PAUSED':
      return 'paused';
    case 'ARCHIVED':
    case 'DELETED':
      return 'archived';
    default:
      return 'other';
  }
}

function unwrap<T>(result: MetaResult<T>): T {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

/**
 * The provider over one ad account, given a token. Split from the factory so
 * tests drive it with a token and a fake network.
 * @param input - Who, which account, which version, and the network.
 * @param input.sourceSlug - The source it answers for.
 * @param input.token - The system user token.
 * @param input.accountId - The ad account, with or without act_.
 * @param input.version - The Graph API version.
 * @param input.doFetch - The network, injected in tests.
 * @param input.pauseMs - Throttle pause, injected in tests.
 */
export function metaAdsReader(input: { sourceSlug: string; token: string; accountId: string; version: string; doFetch?: typeof fetch; pauseMs?: number }): AdsProvider {
  const act = actId(input.accountId);
  const digits = act.slice('act_'.length);
  const call = <T>(path: string, params?: Record<string, string>, method: 'GET' | 'POST' = 'GET') =>
    metaCall<T>({ token: input.token, version: input.version, path, params, method, doFetch: input.doFetch, pauseMs: input.pauseMs });
  let account: Promise<MetaAccount> | null = null;
  const readAccount = () => (account ??= call<MetaAccount>(act, { fields: 'name,currency,account_status' }).then(unwrap));
  const accountUrl = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${digits}`;

  const toEntity = (level: AdsLevel, e: MetaEntity, currency: string | null): AdsEntity => ({
    id: String(e.id ?? ''),
    name: e.name ?? String(e.id ?? ''),
    level,
    status: e.effective_status && e.effective_status !== e.status ? `${e.status ?? 'UNKNOWN'} (delivery: ${e.effective_status})` : (e.status ?? 'UNKNOWN'),
    state: metaState(e.status),
    parentId: level === 'ad_set' ? (e.campaign_id ?? null) : null,
    objective: e.objective ?? e.optimization_goal ?? null,
    dailyBudget: budgetUnits(e.daily_budget, currency),
    totalBudget: budgetUnits(e.lifetime_budget, currency),
    currency,
    url: level === 'campaign'
      ? `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${digits}&selected_campaign_ids=${e.id}`
      : `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${digits}&selected_adset_ids=${e.id}`,
  });

  async function readOne(level: AdsLevel, id: string): Promise<AdsEntity> {
    const { currency = null } = await readAccount();
    return toEntity(level, unwrap(await call<MetaEntity>(encodeURIComponent(id), { fields: ENTITY_FIELDS[level] })), currency);
  }

  return {
    kind: 'meta-ads',
    sourceSlug: input.sourceSlug,
    vendor: 'Meta Ads',
    accountId: act,
    accountUrl,
    levelNames: { campaign: 'campaign', ad_set: 'ad set' },

    async list({ level, state, limit }) {
      const { currency = null } = await readAccount();
      const out: AdsEntity[] = [];
      let after: string | undefined;
      do {
        const params: Record<string, string> = { fields: ENTITY_FIELDS[level], limit: String(Math.min(PAGE, limit)) };
        if (state !== 'all') {
          params.filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [state === 'active' ? 'ACTIVE' : 'PAUSED'] }]);
        }
        if (after) {
          params.after = after;
        }
        const page = unwrap(await call<Page<MetaEntity>>(`${act}/${EDGE[level]}`, params));
        out.push(...(page.data ?? []).map(e => toEntity(level, e, currency)));
        after = page.paging?.next ? page.paging.cursors?.after : undefined;
      } while (after && out.length < limit);
      return out.slice(0, limit);
    },

    read: readOne,

    async performance({ level, from, to, daily, ids }) {
      const spec = INSIGHT_LEVEL[level];
      const params: Record<string, string> = {
        level: spec.level,
        fields: [spec.id, spec.name, 'impressions', 'clicks', 'spend', 'conversions', 'account_currency'].join(','),
        time_range: JSON.stringify({ since: from, until: to }),
        time_increment: daily ? '1' : 'all_days',
        limit: String(PAGE),
      };
      if (spec.filter && ids && ids.length > 0) {
        params.filtering = JSON.stringify([{ field: spec.filter, operator: 'IN', value: ids }]);
      }
      const rows: AdsPerformanceRow[] = [];
      let after: string | undefined;
      do {
        const page = unwrap(await call<Page<InsightRow>>(`${act}/insights`, after ? { ...params, after } : params));
        for (const r of page.data ?? []) {
          const counts = { impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend: Number(r.spend ?? 0) };
          const conversions = r.conversions?.length ? r.conversions.reduce((sum, c) => sum + Number(c.value ?? 0), 0) : null;
          rows.push({
            id: String(r[spec.id] ?? digits),
            name: String(r[spec.name] ?? r[spec.id] ?? ''),
            level,
            date: daily ? (r.date_start ?? null) : null,
            ...counts,
            conversions,
            ...ratesOf(counts),
            currency: r.account_currency ?? null,
          });
        }
        after = page.paging?.next ? page.paging.cursors?.after : undefined;
      } while (after);
      return rows;
    },

    async setState(level, id, state) {
      const result = await call<{ success?: boolean }>(encodeURIComponent(id), { status: state === 'paused' ? 'PAUSED' : 'ACTIVE' }, 'POST');
      if (!result.ok) {
        throw new Error(result.code === 200 || result.code === 10
          ? `Meta refused to ${state === 'paused' ? 'pause' : 'resume'} it: the token can read but not manage. Give the system user ads_management on this ad account to pause and resume from Vocion.`
          : result.message);
      }
      return readOne(level, id);
    },
  };
}

/**
 * The Meta Ads provider for a source: its ad account and API version, and
 * the system user token its credential holds.
 * @param orgId - The workspace.
 * @param source - The `meta-ads` source.
 */
export async function metaAdsProvider(orgId: string, source: FamilySource): Promise<AdsProvider> {
  const config = metaAdsConfigSchema.parse(source.config);
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, 'Meta Ads'));
  }
  const token = metaTokenFrom(bag);
  if (!token.ok) {
    throw new Error(token.message);
  }
  return metaAdsReader({ sourceSlug: source.slug, token: token.token, accountId: config.accountId, version: config.apiVersion });
}
