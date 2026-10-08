/**
 * LINKEDIN ADS — a provider of the ads family (`../provider.ts`).
 *
 * LinkedIn's words differ from the family's by one level: a campaign GROUP
 * is the family's `campaign` (spend toward one objective), and a LinkedIn
 * campaign is the family's `ad_set` (budget, schedule, audience). Read-only:
 * the login asks for `r_ads` and `r_ads_reporting`, so there is no
 * `setState`, and `ads.set_status` refuses on this connection with the reason.
 *
 * The token is the source's: a pasted access token, or a LinkedIn login,
 * renewed through `usableLoginGrant` when LinkedIn issued a refresh token
 * and saved back to the source it came from.
 */

import type { AdsEntity, AdsLevel, AdsPerformanceRow, AdsProvider, AdsState } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { LinkedinResult } from '@/libs/linkedin/client';
import { isLoginGrant, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshLinkedinGrant } from '@/libs/connect/providers/linkedin';
import { dayOf, idOfUrn, linkedinGet, linkedinTokenFrom, restliDateRange, urn } from '@/libs/linkedin/client';
import { linkedinAdsConfigSchema } from '@/libs/sources/linkedinAds';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';
import { ratesOf } from '../provider';

type Money = { amount?: string; currencyCode?: string } | undefined;
type LinkedinEntity = {
  id?: number | string;
  name?: string;
  status?: string;
  campaignGroup?: string;
  objectiveType?: string;
  dailyBudget?: Money;
  totalBudget?: Money;
};
type SearchPage = { elements?: LinkedinEntity[]; metadata?: { nextPageToken?: string | null } };
type AnalyticsElement = {
  pivotValues?: string[];
  dateRange?: { start?: { year?: number; month?: number; day?: number } };
  impressions?: number;
  clicks?: number;
  costInLocalCurrency?: string | number;
  externalWebsiteConversions?: number;
};
type AdAccount = { id?: number | string; name?: string; currency?: string; status?: string };

const PATH: Record<AdsLevel, string> = { campaign: 'adCampaignGroups', ad_set: 'adCampaigns' };
const PIVOT: Record<AdsLevel | 'account', string> = { account: 'ACCOUNT', campaign: 'CAMPAIGN_GROUP', ad_set: 'CAMPAIGN' };
const FACET: Record<AdsLevel, { name: string; kind: 'sponsoredCampaignGroup' | 'sponsoredCampaign' }> = {
  campaign: { name: 'campaignGroups', kind: 'sponsoredCampaignGroup' },
  ad_set: { name: 'campaigns', kind: 'sponsoredCampaign' },
};
const PAGE = 1000;

/**
 * LinkedIn's status word as the family's state.
 * @param status - LinkedIn's status (ACTIVE, PAUSED, ARCHIVED, DRAFT, …).
 */
export function linkedinState(status: string | undefined): AdsState {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'PAUSED':
      return 'paused';
    case 'ARCHIVED':
    case 'COMPLETED':
    case 'CANCELED':
    case 'REMOVED':
      return 'archived';
    default:
      return 'other';
  }
}

function money(value: Money): number | null {
  const n = value?.amount === undefined ? Number.NaN : Number(value.amount);
  return Number.isFinite(n) ? n : null;
}

function unwrap<T>(result: LinkedinResult<T>): T {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

/**
 * The provider over one ad account, given a working token. Split from the
 * factory so tests drive it with a token and a fake network.
 * @param input - Who, which account, and the network.
 * @param input.sourceSlug - The source it answers for.
 * @param input.token - A working access token.
 * @param input.accountId - The sponsored ad account id.
 * @param input.doFetch - The network, injected in tests.
 */
export function linkedinAdsReader(input: { sourceSlug: string; token: string; accountId: string; doFetch?: typeof fetch }): AdsProvider {
  const { token, accountId, doFetch } = input;
  const accountUrl = `https://www.linkedin.com/campaignmanager/accounts/${accountId}`;
  const get = <T>(path: string) => linkedinGet<T>(token, path, doFetch);
  let account: Promise<AdAccount> | null = null;
  const readAccount = () => (account ??= get<AdAccount>(`/adAccounts/${accountId}`).then(unwrap));

  const toEntity = (level: AdsLevel, e: LinkedinEntity, currency: string | null): AdsEntity => ({
    id: String(e.id ?? ''),
    name: e.name ?? String(e.id ?? ''),
    level,
    status: e.status ?? 'UNKNOWN',
    state: linkedinState(e.status),
    parentId: level === 'ad_set' && e.campaignGroup ? idOfUrn(e.campaignGroup) : null,
    objective: e.objectiveType ?? null,
    dailyBudget: money(e.dailyBudget),
    totalBudget: money(e.totalBudget),
    currency: e.dailyBudget?.currencyCode ?? e.totalBudget?.currencyCode ?? currency,
    url: accountUrl,
  });

  async function list({ level, state, limit }: { level: AdsLevel; state: 'active' | 'paused' | 'all'; limit: number }): Promise<AdsEntity[]> {
    const { currency = null } = await readAccount();
    const filter = state === 'all' ? '' : `&search=(status:(values:List(${state === 'active' ? 'ACTIVE' : 'PAUSED'})))`;
    const out: AdsEntity[] = [];
    let pageToken: string | null = null;
    do {
      const page: SearchPage = unwrap(await get<SearchPage>(`/adAccounts/${accountId}/${PATH[level]}?q=search${filter}&sortOrder=DESCENDING&pageSize=${Math.min(PAGE, limit)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`));
      out.push(...(page.elements ?? []).map(e => toEntity(level, e, currency)));
      pageToken = page.metadata?.nextPageToken ?? null;
    } while (pageToken && out.length < limit);
    return out.slice(0, limit);
  }

  return {
    kind: 'linkedin-ads',
    sourceSlug: input.sourceSlug,
    vendor: 'LinkedIn Ads',
    accountId,
    accountUrl,
    levelNames: { campaign: 'campaign group', ad_set: 'campaign' },
    list,

    async read(level, id) {
      const { currency = null } = await readAccount();
      return toEntity(level, unwrap(await get<LinkedinEntity>(`/adAccounts/${accountId}/${PATH[level]}/${encodeURIComponent(id)}`)), currency);
    },

    async performance({ level, from, to, daily, ids }) {
      const acct = await readAccount();
      const currency = acct.currency ?? null;
      const facet = level !== 'account' && ids && ids.length > 0
        ? `${FACET[level].name}=List(${ids.map(id => urn(FACET[level].kind, id)).join(',')})`
        : `accounts=List(${urn('sponsoredAccount', accountId)})`;
      const query = [
        'q=analytics',
        `pivot=${PIVOT[level]}`,
        `timeGranularity=${daily ? 'DAILY' : 'ALL'}`,
        `dateRange=${restliDateRange(from, to)}`,
        facet,
        'fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,dateRange,pivotValues',
      ].join('&');
      const elements = unwrap(await get<{ elements?: AnalyticsElement[] }>(`/adAnalytics?${query}`)).elements ?? [];
      const names = new Map<string, string>();
      if (level === 'account') {
        names.set(accountId, acct.name ?? accountId);
      } else {
        for (const e of await list({ level, state: 'all', limit: 5000 })) {
          names.set(e.id, e.name);
        }
      }
      return elements.map((el): AdsPerformanceRow => {
        const id = idOfUrn(el.pivotValues?.[0] ?? accountId);
        const counts = { impressions: Number(el.impressions ?? 0), clicks: Number(el.clicks ?? 0), spend: Number(el.costInLocalCurrency ?? 0) };
        return {
          id,
          name: names.get(id) ?? id,
          level,
          date: daily ? dayOf(el.dateRange?.start) : null,
          ...counts,
          spend: Math.round(counts.spend * 100) / 100,
          conversions: el.externalWebsiteConversions ?? null,
          ...ratesOf(counts),
          currency,
        };
      });
    },
  };
}

/**
 * The LinkedIn Ads provider for a source: its ad account, and the token the
 * source's credential holds (a login renewed and saved when it is expiring).
 * @param orgId - The workspace.
 * @param source - The `linkedin-ads` source.
 */
export async function linkedinAdsProvider(orgId: string, source: FamilySource): Promise<AdsProvider> {
  const config = linkedinAdsConfigSchema.parse(source.config);
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, 'LinkedIn'));
  }
  let usable: Record<string, unknown> = bag;
  if (isLoginGrant(bag)) {
    usable = await usableLoginGrant({
      vendor: 'LinkedIn',
      provider: 'linkedin',
      connectorSlug: source.kind,
      grant: bag,
      persistence: { kind: 'persist', orgId, sourceId: source.id, warn: message => console.warn('[ads/linkedin]', message) },
      refresh: refreshLinkedinGrant,
    });
  }
  const token = linkedinTokenFrom(usable);
  if (!token.ok) {
    throw new Error(token.message);
  }
  return linkedinAdsReader({ sourceSlug: source.slug, token: token.token, accountId: config.accountId });
}
