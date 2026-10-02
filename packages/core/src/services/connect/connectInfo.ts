/**
 * What the Connectors page needs to know per connector, as plain data (#1080):
 * the account of a live login, the provider's button name, and the newest
 * attempt when it failed. Only connectors that declare a login get an entry
 * for the login half; any connector with a failed newest attempt gets one for
 * the attempt.
 */

import type { ConnectInfo } from '@/features/dashboard/ConnectByLogin';
import { lastConnectAttempts } from '@/libs/connect/attempts';
import { connectOptionFor } from '@/libs/connect/registry';
import { howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';
import { listConnectors } from '@/libs/sources/registry';
import { newestLiveCredential } from './createSourceOnLogin';

/**
 * The account a live login is for, or null. A pasted key is a live
 * credential too, but nobody "logged in" with it, so it never reads as a login.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 */
async function loginAccount(orgId: string, connector: string): Promise<string | null> {
  const platform = platformForConnectorSlug(connector);
  if (!platform || !howToConnectFor(connector)?.login) {
    return null;
  }
  const credential = await newestLiveCredential(orgId, platform.id);
  return credential?.obtainedVia === 'login' ? (credential.account ?? 'your account') : null;
}

/**
 * The page's per-connector login state and last failed attempt.
 * @param orgId - The workspace.
 */
export async function connectInfoForOrg(orgId: string): Promise<Record<string, ConnectInfo>> {
  const attempts = await lastConnectAttempts(orgId);
  const info: Record<string, ConnectInfo> = {};
  for (const connector of listConnectors()) {
    const slug = connector.slug;
    const loggedInAs = await loginAccount(orgId, slug);
    const attempt = attempts.get(slug);
    const failed = attempt && !attempt.ok && attempt.summary
      ? { at: attempt.at.toISOString(), summary: attempt.summary }
      : null;
    if (!loggedInAs && !failed && !howToConnectFor(slug)?.login) {
      continue;
    }
    info[slug] = { providerLabel: connectOptionFor(slug)?.label ?? null, loggedInAs, lastAttempt: failed };
  }
  return info;
}
