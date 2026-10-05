/**
 * What the Connectors page needs to know per connector, as plain data (#1080):
 * the account of a live login, the provider's button name, the stored login or
 * key the add form can keep (account and masked tail only, never the value),
 * and the newest attempt when it failed. A connector gets an entry when it
 * declares a login, holds a keepable credential, or has a failed newest attempt.
 */

import type { ConnectInfo } from '@/features/dashboard/ConnectByLogin';
import { lastConnectAttempts } from '@/libs/connect/attempts';
import { connectOptionFor } from '@/libs/connect/registry';
import { howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';
import { listConnectors } from '@/libs/sources/registry';
import { LOGIN_WITHOUT_TOKEN_HINT } from '@/services/ApiTokenService';
import { connectorHoldingCredential } from '@/services/SourceCredentialService';
import { newestLiveCredential } from './createSourceOnLogin';
import { loginCannotServe } from './loginCannotServe';

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
 * The stored login or key the add form can keep, as the page may see it: the
 * account and the masked tail, never the value. A key issued for one place that
 * another source already holds is left out, because keeping it would only be
 * refused at save.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 * @param credential - The connector's newest live credential.
 */
async function keepableCredential(orgId: string, connector: string, credential: Awaited<ReturnType<typeof newestLiveCredential>>): Promise<ConnectInfo['stored']> {
  if (!credential) {
    return null;
  }
  const platform = platformForConnectorSlug(connector);
  if (credential.obtainedVia === 'paste' && platform?.credentialsShareable === false && await connectorHoldingCredential(orgId, credential.id) !== null) {
    return null;
  }
  const hint = credential.keyHint ?? '…';
  return {
    kind: credential.obtainedVia,
    account: credential.account,
    hint,
    revealable: credential.obtainedVia === 'paste' || hint !== LOGIN_WITHOUT_TOKEN_HINT,
  };
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
    const newest = await liveCredentialOf(orgId, slug);
    // A login this connector cannot use (a Drive login, on Gmail's row) is
    // not shown as "logged in" or offered to keep: the form offers a new login.
    const credential = newest && await loginCannotServe(orgId, newest, slug) ? null : newest;
    const loggedInAs = loginAccount(slug, credential);
    const attempt = attempts.get(slug);
    // A credential saved after the failure (a paste, a later login) supersedes it: the line would only mislead.
    const supersededByCredential = Boolean(attempt && credential && credential.createdAt > attempt.at);
    const failed = attempt && !attempt.ok && attempt.summary && !supersededByCredential
      ? { at: attempt.at.toISOString(), summary: attempt.summary }
      : null;
    const stored = await keepableCredential(orgId, slug, credential);
    if (!loggedInAs && !failed && !stored && !howToConnectFor(slug)?.login) {
      continue;
    }
    // A login this server has no app for (no client ID set) would be a button
    // that only errors, so the page is told there is none and offers paste.
    const option = connectOptionFor(slug);
    info[slug] = { providerLabel: option?.configured ? option.label : null, loggedInAs, stored, lastAttempt: failed };
  }
  return info;
}
