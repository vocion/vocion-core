/**
 * Meta Ads connector — the capability carrier for the ads tools on a Meta
 * (Facebook and Instagram) ad account, and nothing else.
 *
 * Read LIVE (`ads_campaigns`, `ads_performance`) through the Marketing API,
 * never mirrored. Pausing and resuming is `ads.set_status`, which needs the
 * token to carry `ads_management`; with `ads_read` alone it reads. Auth: a
 * Business Manager system user token (`meta-ads` platform) — no OAuth app.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { actId, metaCall, metaTokenFrom } from '@/libs/meta/client';
import { InspectInputError } from './inspect';

export const metaAdsConfigSchema = z.object({
  /** The ad account to read, as act_<number> or the number alone. */
  accountId: z.string().min(1),
  /** The Graph API version to call. Moved forward as Meta retires old ones. */
  apiVersion: z.string().min(1).default('v23.0'),
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/** Meta's `account_status` numbers, as Ads Manager words them. */
const ACCOUNT_STATUS: Record<number, string> = { 1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending risk review', 8: 'pending settlement', 9: 'in grace period', 100: 'pending closure', 101: 'closed' };

/**
 * Test connection: the ad account (name, currency, status), one page of
 * campaigns, and whether the token may pause — read off the token's granted
 * permissions, never by trying a write. Read-only and free. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config (`accountId`, `apiVersion`).
 * @param input.credentials - The credential bag.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectMetaAds(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: typeof fetch): Promise<ConnectorInspection> {
  const config = metaAdsConfigSchema.safeParse(input.config);
  if (!config.success) {
    throw new InspectInputError('Enter the ad account id, act_ followed by digits, from Ads Manager\'s account menu.');
  }
  let act: string;
  try {
    act = actId(config.data.accountId);
  } catch (error) {
    throw new InspectInputError((error as Error).message);
  }
  const token = metaTokenFrom(input.credentials);
  if (!token.ok) {
    throw new InspectInputError(token.message);
  }
  const call = <T>(path: string, params: Record<string, string>) => metaCall<T>({ token: token.token, version: config.data.apiVersion, path, params, doFetch, pauseMs: 0 });
  const checks: ConnectorCheck[] = [];
  const account = await call<{ name?: string; currency?: string; account_status?: number }>(act, { fields: 'name,currency,account_status' });
  checks.push(check('account', `Reads ad account ${act}`, account.ok, account.ok ? `${account.data.name ?? act} · ${account.data.currency ?? 'currency unknown'} · ${ACCOUNT_STATUS[account.data.account_status ?? 0] ?? 'status unknown'}` : account.message));
  if (!account.ok) {
    return { reachable: account.status !== 0, authorized: false, checks, note: null, error: account.message };
  }
  const campaigns = await call<{ data?: unknown[] }>(`${act}/campaigns`, { fields: 'id,name,status', limit: '1' });
  checks.push(check('campaigns', 'Lists campaigns (ads_read)', campaigns.ok, campaigns.ok ? ((campaigns.data.data ?? []).length > 0 ? 'Campaigns are readable.' : 'The account has no campaign yet.') : campaigns.message));
  const permissions = await call<{ data?: Array<{ permission?: string; status?: string }> }>('me/permissions', {});
  const granted = permissions.ok ? (permissions.data.data ?? []).filter(p => p.status === 'granted').map(p => p.permission) : [];
  const canPause = granted.includes('ads_management');
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: permissions.ok
      ? (canPause ? 'The token has ads_management, so an agent may propose pausing and resuming — each a card a person decides, with Undo.' : 'The token reads only (no ads_management): pausing and resuming will be refused with that reason.')
      : 'Could not read the token\'s permissions, so whether it may pause is unknown until a pause is tried. Nothing was saved by this test.',
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const metaAdsConnector: SourceConnector<typeof metaAdsConfigSchema> = {
  slug: 'meta-ads',
  name: 'Meta Ads',
  description: 'A Meta ad account (Facebook and Instagram), read live: campaigns and ad sets with their status and budget, and what they delivered and spent by day. Pausing and resuming is a card you decide, with Undo.',
  icon: 'Megaphone',
  brand: 'meta',
  authKind: 'apikey',
  syncless: true,
  configSchema: metaAdsConfigSchema,
  inspectNote: 'Reads the ad account, one page of campaigns and the token\'s permissions. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectMetaAds({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the ads tools, never mirrored.
  },
};
