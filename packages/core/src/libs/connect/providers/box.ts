/**
 * "Connect with Box" for the Box connector: OAuth 2.0 authorization code.
 *
 * The person consents once for their Box account with `root_readonly`; the
 * grant stores the access token (about an hour), the refresh token and the
 * account it is on. Box ROTATES the refresh token on every refresh and
 * retires the old one, so `libs/sources/box.ts` refreshes through
 * `usableLoginGrant` (`libs/connect/loginGrant.ts`), which saves the new one
 * at once, compare-and-swap, with one caller refreshing at a time.
 *
 * The app is the workspace's own Box login app when an admin saved one, else
 * the server's `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET`. Its redirect URI is
 * `https://<host>/api/connect/box/callback`.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://account.box.com/api/oauth2/authorize';
export const BOX_TOKEN_URL = 'https://api.box.com/oauth2/token';
const ME_URL = 'https://api.box.com/2.0/users/me';
/** Box access tokens live about an hour; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 3600;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** Read every file and folder the person can see, and nothing else. */
export const BOX_LOGIN_SCOPES = ['root_readonly'] as const;

/**
 * The Box app a login or refresh runs on: the one the caller chose, else this
 * server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function boxApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('box');
}

/**
 * The tokens a grant keeps, from a token response.
 * @param body - The parsed token response.
 */
function tokensFrom(body: Record<string, unknown>): RefreshedTokens {
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) {
    throw new TokenRequestError('Box', 'no_token', null);
  }
  return { accessToken, refreshToken, expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS) };
}

/**
 * Mint a new Box access token, and with it a new refresh token, on the app
 * the login was made with. The caller must save both at once.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login ran on; the server's env app when left out.
 * @throws {TokenRequestError} When Box refuses, cannot be reached, or no app is configured.
 */
export async function refreshBoxGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = boxApp(client);
  if (!app) {
    throw new TokenRequestError('Box', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Box',
    url: BOX_TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret },
  });
  return tokensFrom(body);
}

/**
 * Whose Box a fresh token opens: the user's login (an email), else their
 * name. Null when Box would not say; the login still works.
 * @param accessToken - The access token just issued.
 */
async function lookUpAccount(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(ME_URL, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return null;
    }
    const body = await res.json() as { login?: string; name?: string };
    return body.login ?? body.name ?? null;
  } catch (error) {
    logger.warn('box login could not look up the account', { errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

export const boxProvider: ConnectProvider = {
  id: 'box',
  connectorSlugs: ['box'],
  label: 'Box',
  requiredEnv: ['BOX_CLIENT_ID', 'BOX_CLIENT_SECRET'],
  configured: () => boxApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = boxApp(chosen);
    if (!app) {
      throw new Error('Box login is not set up: set BOX_CLIENT_ID and BOX_CLIENT_SECRET, or save a Box login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', BOX_LOGIN_SCOPES.join(' '));
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused' };
    }
    const app = boxApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    if (!query.code) {
      return { ok: false, reason: 'missing_code' };
    }
    let tokens: RefreshedTokens;
    try {
      const body = await postTokenRequest({
        vendor: 'Box',
        url: BOX_TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', code: query.code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret },
      });
      tokens = tokensFrom(body);
    } catch (error) {
      logger.warn('box login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const account = await lookUpAccount(tokens.accessToken);
    return {
      ok: true,
      credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, account },
      displayName: `Box — ${account ?? 'account'}`,
    };
  },

  summarize: (credentials) => {
    const account = typeof credentials.account === 'string' ? credentials.account.trim() : '';
    if (!account || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    return { account: `${account} (Box)` };
  },
};
