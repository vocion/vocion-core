/**
 * "Connect with LinkedIn" for the LinkedIn Ads connector: OAuth 2.0
 * authorization code, asking for `r_ads` and `r_ads_reporting` and nothing
 * that writes. The person consents once; the grant stores the access token
 * (60 days), the refresh token when LinkedIn issues one (programmatic refresh
 * is enabled per app by LinkedIn), and the ad accounts it reaches, by name.
 *
 * A grant with a refresh token is a login grant (`libs/connect/loginGrant.ts`)
 * and renews itself through `refreshLinkedinGrant`. One without is stored as
 * `{ accessToken, expiresAt }`: it works until LinkedIn's expiry and then the
 * connector says to log in again, which is the most LinkedIn allows that app.
 *
 * The app is the workspace's own LinkedIn login app when it saved one
 * (`linkedin-login-app`), else this server's `LINKEDIN_CLIENT_ID` /
 * `LINKEDIN_CLIENT_SECRET`. Its redirect URL is
 * `https://<host>/api/connect/linkedin/callback`.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { LINKEDIN_API_BASE, linkedinHeaders } from '@/libs/linkedin/client';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
/** LinkedIn access tokens live 60 days; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 5_184_000;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;
/** The most ad account names a grant keeps for its summary. */
const MAX_ACCOUNT_NAMES = 25;

/** What the LinkedIn Ads source reads: ad accounts and campaigns, and their reporting. Nothing that writes. */
export const LINKEDIN_LOGIN_SCOPES = ['r_ads', 'r_ads_reporting'] as const;

/**
 * The LinkedIn app a login or refresh runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function linkedinApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('linkedin');
}

/**
 * Mint a new LinkedIn access token from a refresh token. LinkedIn keeps the
 * refresh token's own expiry and returns it again; a response without one
 * keeps the one that was sent.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login was made on.
 * @throws {TokenRequestError} TokenRequestError when LinkedIn refuses or cannot be reached, or no app is configured.
 */
export async function refreshLinkedinGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = linkedinApp(client);
  if (!app) {
    throw new TokenRequestError('LinkedIn', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'LinkedIn',
    url: TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret },
  });
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new TokenRequestError('LinkedIn', 'no_token', null);
  }
  const returned = body.refresh_token;
  return {
    accessToken,
    refreshToken: typeof returned === 'string' && returned ? returned : refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS),
  };
}

/**
 * The names of the ad accounts a fresh token reaches, for the connector card.
 * Empty when LinkedIn would not say; the login still works.
 * @param accessToken - The access token just issued.
 */
async function adAccountNames(accessToken: string): Promise<string[]> {
  try {
    const response = await fetch(`${LINKEDIN_API_BASE}/adAccounts?q=search&pageSize=${MAX_ACCOUNT_NAMES}`, {
      headers: linkedinHeaders(accessToken),
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('linkedin login could not list ad accounts', { status: response.status });
      return [];
    }
    const body = await response.json() as { elements?: Array<{ name?: unknown }> };
    return (body.elements ?? []).map(a => (typeof a.name === 'string' ? a.name.trim() : '')).filter(Boolean).slice(0, MAX_ACCOUNT_NAMES);
  } catch (error) {
    logger.warn('linkedin login could not list ad accounts', { errorName: error instanceof Error ? error.name : 'unknown' });
    return [];
  }
}

/**
 * LinkedIn's refusal on the callback as a short code safe to show, never free text.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const linkedinProvider: ConnectProvider = {
  id: 'linkedin',
  connectorSlugs: ['linkedin-ads'],
  label: 'LinkedIn',
  requiredEnv: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  configured: () => linkedinApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = linkedinApp(chosen);
    if (!app) {
      throw new Error('LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, or save a LinkedIn login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', LINKEDIN_LOGIN_SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = linkedinApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    let body: Record<string, unknown>;
    try {
      body = await postTokenRequest({
        vendor: 'LinkedIn',
        url: TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: app.clientId, client_secret: app.clientSecret },
      });
    } catch (error) {
      logger.warn('linkedin login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const accessToken = body.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      return { ok: false, reason: 'no_token' };
    }
    const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null;
    const accounts = await adAccountNames(accessToken);
    return {
      ok: true,
      credentials: {
        accessToken,
        // Only a grant LinkedIn lets refresh carries a refresh token; one
        // without it is still a working token until `expiresAt`.
        ...(refreshToken ? { refreshToken } : {}),
        expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS),
        accounts,
      },
      displayName: `LinkedIn — ${accounts.length === 1 ? accounts[0] : accounts.length > 1 ? `${accounts.length} ad accounts` : 'ad accounts'}`,
    };
  },

  summarize: (credentials) => {
    if (typeof credentials.accessToken !== 'string' || !Array.isArray(credentials.accounts)) {
      return null;
    }
    const names = credentials.accounts.filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    return {
      account: 'LinkedIn Campaign Manager',
      ...(names.length > 0 ? { granted: { label: 'Ad accounts', items: names } } : {}),
    };
  },
};
