/**
 * "Connect with Gusto" for the Gusto connector: OAuth 2.0 authorization code.
 * The person consents for one Gusto company; the grant stores the access
 * token (two hours), the refresh token and that company (its uuid, read from
 * `/v1/token_info`, and its name).
 *
 * Gusto's refresh token is SINGLE USE: every refresh returns the next one and
 * the one sent stops working. `services/people/providers/gusto.ts` refreshes
 * an expiring grant through `usableLoginGrant`, which saves the rotated token
 * compare-and-swap, so it is never lost. This is also why Gusto has no paste
 * path: a pasted refresh token would die on its first use.
 *
 * Gusto's scopes are the ones its app was approved for; the authorize URL
 * sends none.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

/** Gusto's API host. */
export const GUSTO_API_BASE = 'https://api.gusto.com';
/** The API version every request names. */
export const GUSTO_API_VERSION = '2024-04-01';

const AUTHORIZE_URL = `${GUSTO_API_BASE}/oauth/authorize`;
const TOKEN_URL = `${GUSTO_API_BASE}/oauth/token`;
/** Gusto access tokens live two hours; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 7200;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** What the login asks for, as the connect card shows it: the scopes the Gusto app was approved for. */
export const GUSTO_LOGIN_ACCESS = ['The read scopes your Gusto app was approved for: companies, employees, departments, payrolls, time off'] as const;

/**
 * The Gusto app a login or refresh runs on: the caller's choice, else this server's env app.
 * @param chosen - The app the caller resolved, if it did.
 */
function gustoApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('gusto');
}

/**
 * Turn a token response into the tokens a grant keeps. Gusto rotates the
 * refresh token on every refresh; a response without one keeps the one sent.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null): RefreshedTokens {
  const accessToken = body.access_token;
  const returned = body.refresh_token;
  const refreshToken = typeof returned === 'string' && returned ? returned : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('Gusto', 'no_token', null);
  }
  return { accessToken, refreshToken, expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS) };
}

/**
 * Mint a new Gusto access token from a refresh token. The refresh token sent
 * is spent; the returned one replaces it.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login was made on.
 * @throws {TokenRequestError} When Gusto refuses or cannot be reached, or no Gusto app is configured.
 */
export async function refreshGustoGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = gustoApp(client);
  if (!app) {
    throw new TokenRequestError('Gusto', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Gusto',
    url: TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * The company a fresh token is for, and its name. Nulls when Gusto would not say.
 * @param accessToken - The access token just issued.
 */
async function lookUpCompany(accessToken: string): Promise<{ companyUuid: string | null; companyName: string | null }> {
  const headers = { 'accept': 'application/json', 'authorization': `Bearer ${accessToken}`, 'x-gusto-api-version': GUSTO_API_VERSION };
  try {
    const info = await fetch(`${GUSTO_API_BASE}/v1/token_info`, { headers, signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    if (!info.ok) {
      return { companyUuid: null, companyName: null };
    }
    const body = await info.json() as { resource?: { type?: unknown; uuid?: unknown } };
    const uuid = typeof body.resource?.uuid === 'string' && body.resource.uuid ? body.resource.uuid : null;
    if (!uuid) {
      return { companyUuid: null, companyName: null };
    }
    const company = await fetch(`${GUSTO_API_BASE}/v1/companies/${encodeURIComponent(uuid)}`, { headers, signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    const name = company.ok ? (await company.json() as { name?: unknown; trade_name?: unknown }) : null;
    const companyName = [name?.trade_name, name?.name].find(v => typeof v === 'string' && v.trim());
    return { companyUuid: uuid, companyName: typeof companyName === 'string' ? companyName.trim() : null };
  } catch (error) {
    logger.warn('gusto login could not look up the company', { errorName: error instanceof Error ? error.name : 'unknown' });
    return { companyUuid: null, companyName: null };
  }
}

/**
 * Gusto's refusal on the callback as a short code safe to show.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const gustoProvider: ConnectProvider = {
  id: 'gusto',
  connectorSlugs: ['gusto'],
  label: 'Gusto',
  requiredEnv: ['GUSTO_CLIENT_ID', 'GUSTO_CLIENT_SECRET'],
  configured: () => gustoApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = gustoApp(chosen);
    if (!app) {
      throw new Error('Gusto OAuth is not configured. Set GUSTO_CLIENT_ID and GUSTO_CLIENT_SECRET.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = gustoApp(chosen);
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
        vendor: 'Gusto',
        url: TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('gusto login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const company = await lookUpCompany(tokens.accessToken);
    if (!company.companyUuid) {
      // Every read names the company; a login that cannot say which one reads nothing.
      return { ok: false, reason: 'missing_company' };
    }
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        companyUuid: company.companyUuid,
        companyName: company.companyName,
      },
      displayName: `Gusto — ${company.companyName ?? 'company'}`,
    };
  },

  summarize: (credentials) => {
    const uuid = typeof credentials.companyUuid === 'string' ? credentials.companyUuid : '';
    if (!uuid || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    const name = typeof credentials.companyName === 'string' && credentials.companyName.trim() ? credentials.companyName.trim() : 'Gusto company';
    return { account: `${name} (Gusto)` };
  },
};
