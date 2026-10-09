/**
 * Which OAuth app a vendor login runs on (#1080).
 *
 * A workspace admin can save the workspace's own app for a vendor on the
 * Developers page (the `<vendor> login app` credential: a client ID and
 * secret, encrypted like any other key). A new login runs on that app when
 * there is one, and on the server's env app otherwise, so a workspace can
 * bring its own Google client without a redeploy.
 *
 * A refresh token only works with the client it was issued to, so a refresh
 * must find the same app again. Every login records the client ID it ran on
 * (`loginClientId` in the stored grant), and `loginClientForGrant` looks it
 * up: the workspace's app if it still matches, else the server's. When
 * neither matches, the workspace replaced or removed that app and the person
 * has to log in again (`login_app_changed`).
 */
import type { ConnectProvider, ConnectProviderId } from './provider';
import type { LoginClient } from './serverClients';
import { VaultDecryptionError } from '@/libs/crypto/credentialVault';
import { logger } from '@/libs/Logger';
import { loginAppPlatformFor } from '@/libs/platforms/registry';
import { resolvePlatformCredential } from '@/services/ApiTokenService';
import { withArticle } from '@/utils/withArticle';
import { serverLoginClient, serverLoginClients } from './serverClients';
import { TokenRequestError } from './tokenRequest';

/** The key a stored grant records its app's client ID under. */
export const LOGIN_CLIENT_ID_KEY = 'loginClientId';

/**
 * The workspace's own app for a provider, or null when it saved none (or the
 * provider takes no workspace app, as GitHub and PostHog do not). Throws when
 * the saved app cannot be decrypted, since falling back to the server's app
 * would run the login on an app the admin did not choose.
 * @param orgId - The workspace.
 * @param provider - The connect provider.
 */
export async function workspaceLoginClient(orgId: string, provider: ConnectProviderId): Promise<LoginClient | null> {
  const platform = loginAppPlatformFor(provider);
  if (!platform) {
    return null;
  }
  const values = await resolvePlatformCredential(orgId, platform.id);
  const clientId = values?.clientId?.trim();
  const clientSecret = values?.clientSecret?.trim();
  return clientId && clientSecret ? { clientId, clientSecret, owner: 'workspace' } : null;
}

/**
 * The app a new login runs on: the workspace's own, else the server's, else
 * null when neither is set up.
 * @param orgId - The workspace the login is for.
 * @param provider - The connect provider.
 */
export async function loginClientForNewLogin(orgId: string, provider: ConnectProviderId): Promise<LoginClient | null> {
  return (await workspaceLoginClient(orgId, provider)) ?? serverLoginClient(provider);
}

/**
 * The app a login's callback trades the code on: the one the start sent the
 * person to, whose client ID the signed state carries. The code was issued to
 * that app, so if an admin replaced or removed it mid-login this throws
 * `TokenRequestError` with `login_app_changed` rather than trading the code
 * on another app the vendor would refuse. A state without one (signed before
 * states carried it, or for a provider with no client ID and secret) gets
 * the app a new login would.
 * @param input - The login being finished.
 * @param input.orgId - The workspace.
 * @param input.provider - The connect provider.
 * @param input.vendor - The vendor's name, for the error.
 * @param input.startedOnClientId - The `loginClientId` the state carries, if any.
 */
export async function loginClientForCallback(input: { orgId: string; provider: ConnectProviderId; vendor: string; startedOnClientId: string | undefined }): Promise<LoginClient | null> {
  if (!input.startedOnClientId) {
    return loginClientForNewLogin(input.orgId, input.provider);
  }
  return loginClientForGrant({ orgId: input.orgId, provider: input.provider, vendor: input.vendor, loginClientId: input.startedOnClientId });
}

/**
 * The app a stored login has to refresh with: the one whose client ID the
 * login recorded. A login with no record was made before workspace apps
 * existed, and so on the server's app.
 *
 * Throws `TokenRequestError` with `not_configured` when the server's app is
 * gone and nothing replaced it (an admin fixes the server), and with
 * `login_app_changed` when the app the login ran on was replaced or removed
 * (an admin logs in again on the current app).
 * @param input - Where the login lives and what it recorded.
 * @param input.orgId - The workspace.
 * @param input.provider - The connect provider.
 * @param input.vendor - The vendor's name, for the error.
 * @param input.loginClientId - The `loginClientId` the stored grant holds, if any.
 */
export async function loginClientForGrant(input: { orgId: string; provider: ConnectProviderId; vendor: string; loginClientId: unknown }): Promise<LoginClient> {
  const server = serverLoginClient(input.provider);
  const recorded = typeof input.loginClientId === 'string' && input.loginClientId ? input.loginClientId : null;
  if (!recorded && server) {
    // The common case for older logins, answered without reading the store.
    return server;
  }
  // Workspace first: when an admin saved the server's own client ID as the
  // workspace app, the secret they saved is the one they mean.
  const workspace = await workspaceLoginClient(input.orgId, input.provider);
  if (!recorded) {
    throw new TokenRequestError(input.vendor, workspace ? 'login_app_changed' : 'not_configured', null);
  }
  if (workspace?.clientId === recorded) {
    return workspace;
  }
  // The connectors' app, or one a person's own connection ran on
  // (`personalLoginClient`): whichever issued this login.
  const issuer = serverLoginClients(input.provider).find(client => client.clientId === recorded);
  if (issuer) {
    return issuer;
  }
  throw new TokenRequestError(input.vendor, 'login_app_changed', null);
}

/**
 * The sentence a refresh ends with when it cannot find the app its login was
 * made on, or null when the lookup failed for a passing reason (the database
 * did not answer) and trying again later is the fix. Every refresh path
 * (`loginGrant`, `googleAuth`, `jira`) words these the same way through here.
 *
 * Each sentence names a fix that works whatever is left: logging in again
 * only helps once some app exists, so the sentence says where to save one.
 * @param vendor - The vendor's name, for the sentence.
 * @param error - What `loginClientForGrant` threw.
 */
export function loginAppLookupFailure(vendor: string, error: unknown): string | null {
  if (error instanceof VaultDecryptionError) {
    return `The saved ${vendor} login app could not be read, so this login cannot be refreshed. An admin needs to save the ${vendor} login app again on the Developers page.`;
  }
  if (!(error instanceof TokenRequestError)) {
    return null;
  }
  if (error.code === 'login_app_changed') {
    // Also reached when the server's own client ID was changed, so the
    // sentence does not say whose app went away.
    return `This ${vendor} login was made with ${withArticle(`${vendor} app`)} that is no longer set up (it was replaced or removed), so it cannot be refreshed. An admin needs to log in with ${vendor} again on the Connectors page, first saving ${withArticle(`${vendor} login app`)} on the Developers page if there is none.`;
  }
  if (error.code === 'not_configured') {
    return `No ${vendor} app is set up any more, on this server or on the Developers page, so this login cannot be refreshed. An admin needs to save ${withArticle(`${vendor} login app`)} on the Developers page (or set the ${vendor} app up on the server), then log in with ${vendor} again.`;
  }
  return null;
}

/**
 * Whether the Connectors form and the chat card should offer a login with
 * this provider: the server's env sets it up, or the workspace saved its own
 * app. A saved app that cannot be read offers none, and is logged, rather
 * than breaking the page that asked.
 * @param orgId - The workspace being shown the offer.
 * @param provider - The connect provider.
 */
export async function loginOffered(orgId: string, provider: ConnectProvider): Promise<boolean> {
  if (provider.configured()) {
    return true;
  }
  try {
    return (await workspaceLoginClient(orgId, provider.id)) !== null;
  } catch (error) {
    logger.error('loginOffered: the workspace login app could not be read', { orgId, provider: provider.id, errorName: error instanceof Error ? error.name : 'unknown' });
    return false;
  }
}
