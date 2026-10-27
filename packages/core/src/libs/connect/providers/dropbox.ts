/**
 * "Connect with Dropbox" for the Dropbox connector: OAuth 2.0 authorization
 * code with `token_access_type=offline`, so the grant carries a refresh token.
 *
 * The person consents once for their Dropbox account; the grant stores the
 * short-lived access token (four hours), the refresh token and the account it
 * is on. `libs/sources/dropbox.ts` refreshes it with `refreshDropboxGrant`
 * through `usableLoginGrant` (`libs/connect/loginGrant.ts`). Dropbox keeps the
 * same refresh token across refreshes; the grant still saves whatever comes
 * back, so a rotation would be kept.
 *
 * The app is the workspace's own Dropbox login app when an admin saved one,
 * else the server's `DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET`. Its
 * redirect URI is `https://<host>/api/connect/dropbox/callback`.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const ACCOUNT_URL = 'https://api.dropboxapi.com/2/users/get_current_account';
/** Dropbox access tokens live four hours; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 14_400;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** Read the account's name, list files and read their contents. Nothing writes. */
export const DROPBOX_LOGIN_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read'] as const;

/**
 * The Dropbox app a login or refresh runs on: the one the caller chose, else
 * this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function dropboxApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('dropbox');
}

/**
 * The tokens a grant keeps, from a token response. A refresh answers with no
 * refresh token, so the one that was sent is kept.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null): RefreshedTokens {
  const accessToken = body.access_token;
  const returned = body.refresh_token;
  const refreshToken = typeof returned === 'string' && returned ? returned : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('Dropbox', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

/**
 * Mint a new Dropbox access token from a refresh token, on the app the login
 * was made with. Also what a pasted refresh token (with its app key and
 * secret) is exchanged through, with that pasted pair as the client.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login ran on; the server's env app when left out.
 * @throws {TokenRequestError} When Dropbox refuses, cannot be reached, or no app is configured.
 */
export async function refreshDropboxGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = dropboxApp(client);
  if (!app) {
    throw new TokenRequestError('Dropbox', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Dropbox',
    url: DROPBOX_TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * Whose Dropbox a fresh token opens: the account's email, else its display
 * name. Null when Dropbox would not say; the login still works.
 * @param accessToken - The access token just issued.
 */
async function lookUpAccount(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(ACCOUNT_URL, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return null;
    }
    const body = await res.json() as { email?: string; name?: { display_name?: string } };
    return body.email ?? body.name?.display_name ?? null;
  } catch (error) {
    logger.warn('dropbox login could not look up the account', { errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

export const dropboxProvider: ConnectProvider = {
  id: 'dropbox',
  connectorSlugs: ['dropbox'],
  label: 'Dropbox',
  requiredEnv: ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET'],
  configured: () => dropboxApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = dropboxApp(chosen);
    if (!app) {
      throw new Error('Dropbox login is not set up: set DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET, or save a Dropbox login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('scope', DROPBOX_LOGIN_SCOPES.join(' '));
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused' };
    }
    const app = dropboxApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    if (!query.code) {
      return { ok: false, reason: 'missing_code' };
    }
    let body: Record<string, unknown>;
    let tokens: RefreshedTokens;
    try {
      body = await postTokenRequest({
        vendor: 'Dropbox',
        url: DROPBOX_TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', code: query.code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('dropbox login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const account = await lookUpAccount(tokens.accessToken);
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        ...(tokens.scope ? { scope: tokens.scope } : {}),
        accountId: typeof body.account_id === 'string' ? body.account_id : null,
        account,
      },
      displayName: `Dropbox — ${account ?? 'account'}`,
    };
  },

  summarize: (credentials) => {
    const account = typeof credentials.account === 'string' ? credentials.account.trim() : '';
    if (!account || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    return { account: `${account} (Dropbox)` };
  },
};
