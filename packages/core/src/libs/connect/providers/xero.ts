/**
 * "Connect with Xero" for the Xero connector: OAuth 2.0 authorization code
 * with read-only accounting scopes. The person picks the organisation(s) on
 * Xero's consent screen; the grant stores the access token (30 minutes), the
 * refresh token and the first organisation it was granted (`tenantId`,
 * `tenantName`), read from Xero's connections list.
 *
 * Xero ROTATES the refresh token: every refresh returns a new one and the old
 * one stops working. `services/finance/providers/xero.ts` refreshes an
 * expiring grant through `usableLoginGrant`, which saves the rotated token
 * compare-and-swap. A Xero custom connection (a client ID and secret, no
 * redirect) is the paste path and never comes through here.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
/** Xero access tokens live 30 minutes; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 1800;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** What the Xero login asks for: identity, a refresh token, and read-only accounting. */
export const XERO_LOGIN_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.transactions.read',
  'accounting.contacts.read',
  'accounting.reports.read',
  'accounting.settings.read',
] as const;

/**
 * The Xero app a login or refresh runs on: the one the caller chose, else
 * this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function xeroApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('xero');
}

/**
 * Turn a token response into the tokens a grant keeps; a rotated refresh
 * token replaces the one sent.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens {
  const accessToken = body.access_token;
  const returnedRefresh = body.refresh_token;
  const refreshToken = typeof returnedRefresh === 'string' && returnedRefresh ? returnedRefresh : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('Xero', 'no_token', null);
  }
  return { accessToken, refreshToken, expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS, now) };
}

/**
 * Mint a new Xero access token from a refresh token. Xero returns a new
 * refresh token every time, after which the old one no longer works.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login was made on.
 * @throws {TokenRequestError} TokenRequestError when Xero refuses or cannot be reached, or no Xero app is configured.
 */
export async function refreshXeroGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = xeroApp(client);
  if (!app) {
    throw new TokenRequestError('Xero', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Xero',
    url: XERO_TOKEN_URL,
    encoding: 'form',
    basicAuth: app,
    params: { grant_type: 'refresh_token', refresh_token: refreshToken },
  });
  return tokensFrom(body, refreshToken);
}

/** One organisation an access token reaches, from Xero's connections list. */
export type XeroTenant = { tenantId: string; tenantName: string | null; tenantType: string | null };

/**
 * The organisations an access token reaches, organisations first. Empty when
 * Xero would not say.
 * @param accessToken - A Xero access token.
 */
export async function xeroConnections(accessToken: string): Promise<XeroTenant[]> {
  try {
    const response = await fetch(XERO_CONNECTIONS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const body = await response.json() as unknown;
    const rows = Array.isArray(body) ? body as Array<Record<string, unknown>> : [];
    const tenants = rows
      .filter(row => typeof row.tenantId === 'string' && row.tenantId)
      .map(row => ({
        tenantId: String(row.tenantId),
        tenantName: typeof row.tenantName === 'string' && row.tenantName.trim() ? row.tenantName.trim() : null,
        tenantType: typeof row.tenantType === 'string' ? row.tenantType : null,
      }));
    return [...tenants.filter(t => t.tenantType === 'ORGANISATION'), ...tenants.filter(t => t.tenantType !== 'ORGANISATION')];
  } catch (error) {
    logger.warn('xero login could not list its organisations', { errorName: error instanceof Error ? error.name : 'unknown' });
    return [];
  }
}

/**
 * Xero's refusal on the callback as a short code safe to show.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const xeroProvider: ConnectProvider = {
  id: 'xero',
  connectorSlugs: ['xero'],
  label: 'Xero',
  requiredEnv: ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'],
  configured: () => xeroApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = xeroApp(chosen);
    if (!app) {
      throw new Error('Xero OAuth is not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', XERO_LOGIN_SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = xeroApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    let tokens: RefreshedTokens;
    try {
      const body = await postTokenRequest({
        vendor: 'Xero',
        url: XERO_TOKEN_URL,
        encoding: 'form',
        basicAuth: app,
        params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('xero login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const [tenant] = await xeroConnections(tokens.accessToken);
    if (!tenant) {
      // Every read names an organisation; a login that reaches none reads nothing.
      return { ok: false, reason: 'missing_organisation' };
    }
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
      },
      displayName: `Xero — ${tenant.tenantName ?? `organisation ${tenant.tenantId}`}`,
    };
  },

  summarize: (credentials) => {
    const tenantId = typeof credentials.tenantId === 'string' ? credentials.tenantId : '';
    if (!tenantId || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    const name = typeof credentials.tenantName === 'string' && credentials.tenantName.trim() ? credentials.tenantName.trim() : 'Xero organisation';
    return { account: `${name} (Xero)` };
  },
};
