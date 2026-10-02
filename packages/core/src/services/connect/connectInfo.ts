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
 * The newest live credential of the connector's platform, or null when the
 * connector has none or has no platform.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 */
async function liveCredentialOf(orgId: string, connector: string): Promise<Awaited<ReturnType<typeof newestLiveCredential>>> {
  const platform = platformForConnectorSlug(connector);
  return platform ? newestLiveCredential(orgId, platform.id) : null;
}

/**
 * The account a live login is for, or null. A pasted key is a live
 * credential too, but nobody "logged in" with it, so it never reads as a login.
 * @param connector - Connector slug.
 * @param credential - The connector's newest live credential.
 */
function loginAccount(connector: string, credential: Awaited<ReturnType<typeof newestLiveCredential>>): string | null {
  if (!howToConnectFor(connector)?.login) {
    return null;
  }
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
    const credential = await liveCredentialOf(orgId, slug);
    const loggedInAs = loginAccount(slug, credential);
    const attempt = attempts.get(slug);
    // A credential saved after the failure (a paste, a later login) supersedes it: the line would only mislead.
    const supersededByCredential = Boolean(attempt && credential && credential.createdAt > attempt.at);
    const failed = attempt && !attempt.ok && attempt.summary && !supersededByCredential
      ? { at: attempt.at.toISOString(), summary: attempt.summary }
      : null;
    if (!loggedInAs && !failed && !howToConnectFor(slug)?.login) {
      continue;
    }
    info[slug] = { providerLabel: connectOptionFor(slug)?.label ?? null, loggedInAs, lastAttempt: failed };
  }
  return info;
}
