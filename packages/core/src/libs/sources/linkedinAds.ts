/**
 * LinkedIn Ads connector — the capability carrier for the ads tools on a
 * LinkedIn ad account, and nothing else.
 *
 * Read LIVE (`ads_campaigns`, `ads_performance`) through the LinkedIn
 * Marketing API, never mirrored. Read-only: the login asks for `r_ads` and
 * `r_ads_reporting` and nothing that writes, so `ads.set_status` refuses on
 * this connection with the reason. Auth: "Connect with LinkedIn" (the
 * `linkedin` connect provider) or a pasted access token (`linkedin-ads` platform).
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { isLoginGrant, renewedLoginNote, testConnectionPersistence, usableLoginGrant } from '@/libs/connect/loginGrant';
import { refreshLinkedinGrant } from '@/libs/connect/providers/linkedin';
import { linkedinGet, linkedinTokenFrom, restliDateRange, urn } from '@/libs/linkedin/client';
import { InspectInputError } from './inspect';

export const linkedinAdsConfigSchema = z.object({
  /** The ad account to read — the number in Campaign Manager's URL. */
  accountId: z.union([z.string().regex(/^\d+$/), z.number().int().positive().transform(String)]),
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the ad account (name, currency, status), its campaign
 * groups, and one day of reporting. Read-only and free. Nothing is saved,
 * except an expiring login renewed while re-testing a connected source.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config (`accountId`).
 * @param input.credentials - The credential bag.
 * @param input.savedSource - The connected source being re-tested, if it is one.
 * @param input.savedSource.orgId - Its workspace.
 * @param input.savedSource.sourceId - Its row.
 * @param input.now - The clock, for "yesterday".
 * @param doFetch - The network, injected in tests.
 */
export async function inspectLinkedinAds(input: { config: Record<string, unknown>; credentials: Record<string, unknown>; savedSource?: { orgId: string; sourceId: number }; now?: Date }, doFetch?: typeof fetch): Promise<ConnectorInspection> {
  const config = linkedinAdsConfigSchema.safeParse(input.config);
  if (!config.success) {
    throw new InspectInputError('Enter the ad account id: the number in Campaign Manager\'s URL, after /accounts/.');
  }
  let bag: Record<string, unknown> = input.credentials;
  let renewed = false;
  if (isLoginGrant(bag)) {
    try {
      const grant = await usableLoginGrant({ vendor: 'LinkedIn', provider: 'linkedin', connectorSlug: 'linkedin-ads', grant: bag, persistence: testConnectionPersistence('linkedin-ads', input.savedSource), refresh: refreshLinkedinGrant });
      renewed = grant.accessToken !== bag.accessToken;
      bag = grant;
    } catch (error) {
      throw new InspectInputError(error instanceof Error ? error.message : String(error));
    }
  }
  const token = linkedinTokenFrom(bag);
  if (!token.ok) {
    throw new InspectInputError(token.message);
  }
  const accountId = config.data.accountId;
  const checks: ConnectorCheck[] = [];
  const account = await linkedinGet<{ name?: string; currency?: string; status?: string }>(token.token, `/adAccounts/${accountId}`, doFetch);
  checks.push(check('account', `Reads ad account ${accountId}`, account.ok, account.ok ? `${account.data.name ?? accountId} · ${account.data.currency ?? 'currency unknown'} · ${account.data.status ?? 'status unknown'}` : account.message));
  if (!account.ok) {
    return { reachable: account.status !== 0, authorized: false, checks, note: null, error: account.message };
  }
  const groups = await linkedinGet<{ elements?: unknown[] }>(token.token, `/adAccounts/${accountId}/adCampaignGroups?q=search&pageSize=1`, doFetch);
  checks.push(check('campaigns', 'Lists campaign groups (r_ads)', groups.ok, groups.ok ? `${(groups.data.elements ?? []).length > 0 ? 'Campaign groups are readable.' : 'The account has no campaign group yet.'}` : groups.message));
  const day = new Date((input.now ?? new Date()).getTime() - 86_400_000).toISOString().slice(0, 10);
  const report = await linkedinGet<{ elements?: Array<{ impressions?: number; costInLocalCurrency?: string }> }>(token.token, `/adAnalytics?q=analytics&pivot=ACCOUNT&timeGranularity=ALL&dateRange=${restliDateRange(day, day)}&accounts=List(${urn('sponsoredAccount', accountId)})&fields=impressions,costInLocalCurrency`, doFetch);
  const row = report.ok ? report.data.elements?.[0] : undefined;
  checks.push(check('reporting', 'Reads reporting (r_ads_reporting)', report.ok, report.ok ? `Yesterday (${day}): ${row?.impressions ?? 0} impressions, ${row?.costInLocalCurrency ?? 0} ${account.data.currency ?? ''} spent.`.trim() : report.message));
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: renewed ? renewedLoginNote('LinkedIn') : 'Read-only: Vocion reads campaigns and reporting and changes nothing on LinkedIn. Nothing was saved by this test.',
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const linkedinAdsConnector: SourceConnector<typeof linkedinAdsConfigSchema> = {
  slug: 'linkedin-ads',
  name: 'LinkedIn Ads',
  description: 'A LinkedIn ad account, read live: campaign groups and campaigns with their status and budget, and what they delivered and spent by day. Read-only.',
  icon: 'Megaphone',
  category: 'sales-marketing',
  brand: 'linkedin',
  authKind: 'oauth',
  syncless: true,
  configSchema: linkedinAdsConfigSchema,
  requiredScopes: ['r_ads', 'r_ads_reporting'],
  inspectNote: 'Reads the ad account, its campaign groups and yesterday\'s reporting. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials, savedSource }) {
    return inspectLinkedinAds({ config, credentials, savedSource });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the ads tools, never mirrored.
  },
};
