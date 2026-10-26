/**
 * "Log in with Facebook" for the Meta Ads connector: Facebook Login, OAuth
 * 2.0 authorization code, asking for `ads_read` (campaigns and insights),
 * `ads_management` (an approved pause or resume) and `business_management`
 * (the ad accounts a business owns, for the account picker). The person
 * consents once; no system user token is pasted.
 *
 * Meta issues a short-lived user token (about two hours), which the exchange
 * trades at once for a long-lived one (about 60 days). Meta has no refresh
 * token: the long-lived token is stored as both `accessToken` and
 * `refreshToken`, so it is a login grant (`libs/connect/loginGrant.ts`) and
 * `refreshMetaGrant` trades it for a fresh long-lived token while it is
 * still valid. Once it has lapsed, the connector says to log in again.
 *
 * The app is the workspace's own Meta login app when it saved one
 * (`meta-login-app`), else this server's `META_APP_ID` / `META_APP_SECRET`.
 * Its redirect URL is `https://<host>/api/connect/meta/callback`
 * (docs/deployment/connect-apps.md).
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { META_GRAPH_VERSION } from '@/libs/meta/client';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const AUTHORIZE_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
const TOKEN_URL = `${GRAPH}/oauth/access_token`;
/** A long-lived user token lasts about 60 days; used when a response omits `expires_in`. */
const LONG_LIVED_SECONDS = 5_184_000;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;
/** The most ad accounts a grant keeps for its picker and summary. */
const MAX_ACCOUNTS = 50;

/** What the Meta Ads source needs: reading, an approved pause or resume, and the business's ad accounts. */
export const META_LOGIN_SCOPES = ['ads_read', 'ads_management', 'business_management'] as const;

/** One ad account a login reaches: its `act_` id and its name. Not secret. */
export type MetaAdAccount = { id: string; name: string };

/**
 * The Meta app a login or refresh runs on: the one the caller chose, else
 * this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function metaApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('meta');
}

/**
 * Trade a token Meta issued (short-lived, or a long-lived one still valid)
 * for a long-lived one.
 * @param token - The token to trade.
 * @param app - The app the login was made on.
 * @throws {TokenRequestError} TokenRequestError when Meta refuses or cannot be reached.
 */
async function longLived(token: string, app: LoginClient): Promise<{ accessToken: string; expiresAt: string }> {
  const body = await postTokenRequest({
    vendor: 'Meta',
    url: TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'fb_exchange_token', client_id: app.clientId, client_secret: app.clientSecret, fb_exchange_token: token },
  });
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new TokenRequestError('Meta', 'no_token', null);
  }
  return { accessToken, expiresAt: grantExpiresAt(body.expires_in, LONG_LIVED_SECONDS) };
}

/**
 * Renew a Meta login while its long-lived token is still valid: Meta has no
 * refresh token, so the stored token is traded for a fresh long-lived one.
 * @param refreshToken - The stored long-lived token.
 * @param client - The app the login was made on.
 * @throws {TokenRequestError} TokenRequestError when Meta refuses (an expired or revoked token: log in again) or no app is configured.
 */
export async function refreshMetaGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = metaApp(client);
  if (!app) {
    throw new TokenRequestError('Meta', 'not_configured', null);
  }
  const fresh = await longLived(refreshToken, app);
  return { accessToken: fresh.accessToken, refreshToken: fresh.accessToken, expiresAt: fresh.expiresAt };
}

/**
 * The ad accounts a fresh token reaches, for the account picker and the
 * connector card. Empty when Meta would not say; the login still works.
 * @param accessToken - The token just issued.
 */
async function adAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  try {
    const url = new URL(`${GRAPH}/me/adaccounts`);
    url.searchParams.set('fields', 'account_id,name');
    url.searchParams.set('limit', String(MAX_ACCOUNTS));
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn('meta login could not list ad accounts', { status: response.status });
      return [];
    }
    const body = await response.json() as { data?: Array<{ account_id?: unknown; id?: unknown; name?: unknown }> };
    return (body.data ?? []).flatMap((a) => {
      const raw = typeof a.account_id === 'string' ? a.account_id : typeof a.id === 'string' ? a.id.replace(/^act_/, '') : '';
      if (!/^\d+$/.test(raw)) {
        return [];
      }
      return [{ id: `act_${raw}`, name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : `act_${raw}` }];
    }).slice(0, MAX_ACCOUNTS);
  } catch (error) {
    logger.warn('meta login could not list ad accounts', { errorName: error instanceof Error ? error.name : 'unknown' });
    return [];
  }
}

/**
 * Meta's refusal on the callback as a short code safe to show, never free text.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  const reason = query.error_reason || query.error;
  return reason && SAFE_REFUSAL.test(reason) ? reason : 'authorization_refused';
}

export const metaProvider: ConnectProvider = {
  id: 'meta',
  connectorSlugs: ['meta-ads'],
  label: 'Facebook',
  requiredEnv: ['META_APP_ID', 'META_APP_SECRET'],
  configured: () => metaApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = metaApp(chosen);
    if (!app) {
      throw new Error('Meta login is not configured. Set META_APP_ID and META_APP_SECRET, or save a Meta login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', META_LOGIN_SCOPES.join(','));
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error || query.error_reason) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = metaApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    let token: { accessToken: string; expiresAt: string };
    try {
      const body = await postTokenRequest({
        vendor: 'Meta',
        url: TOKEN_URL,
        encoding: 'form',
        params: { code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret },
      });
      const shortLived = body.access_token;
      if (typeof shortLived !== 'string' || !shortLived) {
        return { ok: false, reason: 'no_token' };
      }
      token = await longLived(shortLived, app);
    } catch (error) {
      logger.warn('meta login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const accounts = await adAccounts(token.accessToken);
    return {
      ok: true,
      credentials: {
        accessToken: token.accessToken,
        // Meta has no refresh token: the long-lived token renews itself.
        refreshToken: token.accessToken,
        expiresAt: token.expiresAt,
        adAccounts: accounts,
        accounts: accounts.map(a => a.name),
      },
      displayName: `Meta — ${accounts.length === 1 ? accounts[0]!.name : accounts.length > 1 ? `${accounts.length} ad accounts` : 'ad accounts'}`,
    };
  },

  summarize: (credentials) => {
    if (typeof credentials.accessToken !== 'string' || !Array.isArray(credentials.accounts)) {
      return null;
    }
    const names = credentials.accounts.filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    return {
      account: 'Meta Ads Manager',
      ...(names.length > 0 ? { granted: { label: 'Ad accounts', items: names } } : {}),
    };
  },
};
