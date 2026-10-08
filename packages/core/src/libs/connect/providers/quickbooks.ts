/**
 * "Connect with QuickBooks" for the QuickBooks Online connector: Intuit's
 * OAuth 2.0 authorization code, read-only accounting scope. The person picks
 * one QuickBooks company on Intuit's consent screen; the grant stores the
 * access token (one hour), the refresh token and that company (`realmId`,
 * sent back on the callback beside the code), with its name.
 *
 * Intuit ROTATES the refresh token: a refresh can return a new one, and once
 * it does the old one stops working. `libs/sources/quickbooks.ts` refreshes an
 * expiring grant through `usableLoginGrant`, which saves the rotated token
 * compare-and-swap, so it is never lost between syncs. This is also why
 * QuickBooks has no paste path: a refresh token pasted by hand would be dead
 * within a day of its first use, with nowhere to keep its successor.
 *
 * Intuit issues sandbox and production apps separately and their companies
 * live on different API hosts. The login finds out which by asking the
 * production host for the company first and the sandbox host second, and
 * records the answer (`environment`), so nobody has to say.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { QUICKBOOKS_API_BASE, QUICKBOOKS_MINOR_VERSION } from '@/libs/quickbooks/client';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
/** Intuit access tokens live one hour; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 3600;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;
/** A QuickBooks company id (realm): digits. */
const REALM_ID = /^\d{1,32}$/;

/** Read-only access to the company's books. QuickBooks has no narrower read scope. */
export const QUICKBOOKS_LOGIN_SCOPES = ['com.intuit.quickbooks.accounting'] as const;

/** Which Intuit environment a company lives in. */
export type QuickbooksEnvironment = 'production' | 'sandbox';

/**
 * The Intuit app a login or refresh runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function quickbooksApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('quickbooks');
}

/**
 * Turn a token response into the tokens a grant keeps. A response with no
 * refresh token keeps the one that was sent; a rotated one replaces it.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens {
  const accessToken = body.access_token;
  const returnedRefresh = body.refresh_token;
  const refreshToken = typeof returnedRefresh === 'string' && returnedRefresh ? returnedRefresh : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('QuickBooks', 'no_token', null);
  }
  return { accessToken, refreshToken, expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS, now) };
}

/**
 * Mint a new QuickBooks access token from a refresh token. Intuit may return
 * a new refresh token, after which the old one no longer works.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login was made on.
 * @throws {TokenRequestError} TokenRequestError when Intuit refuses or cannot be reached, or no Intuit app is configured.
 */
export async function refreshQuickbooksGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = quickbooksApp(client);
  if (!app) {
    throw new TokenRequestError('QuickBooks', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'QuickBooks',
    url: TOKEN_URL,
    encoding: 'form',
    basicAuth: app,
    params: { grant_type: 'refresh_token', refresh_token: refreshToken },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * The company's name, and which environment answered for it. Production is
 * asked first; a company only the sandbox knows is a sandbox company. Null
 * name when neither would say: the login still works, with a generic name.
 * @param accessToken - The access token just issued.
 * @param realmId - The company the person picked.
 */
async function lookUpCompany(accessToken: string, realmId: string): Promise<{ companyName: string | null; environment: QuickbooksEnvironment }> {
  for (const environment of ['production', 'sandbox'] as const) {
    try {
      const url = `${QUICKBOOKS_API_BASE[environment]}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${QUICKBOOKS_MINOR_VERSION}`;
      const response = await fetch(url, {
        headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
      });
      if (!response.ok) {
        continue;
      }
      const body = await response.json() as { CompanyInfo?: { CompanyName?: unknown; LegalName?: unknown } };
      const name = [body.CompanyInfo?.CompanyName, body.CompanyInfo?.LegalName].find(value => typeof value === 'string' && value.trim());
      return { companyName: typeof name === 'string' ? name.trim() : null, environment };
    } catch (error) {
      logger.warn('quickbooks login could not look up the company', { environment, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return { companyName: null, environment: 'production' };
}

/**
 * Intuit's refusal on the callback as a short code safe to show, never free text.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const quickbooksProvider: ConnectProvider = {
  id: 'quickbooks',
  connectorSlugs: ['quickbooks'],
  label: 'QuickBooks',
  requiredEnv: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'],
  configured: () => quickbooksApp() !== null,

  authorizeUrl({ state, redirectUri, client: chosen }) {
    const app = quickbooksApp(chosen);
    if (!app) {
      // The start route checks `configured()` first; this is the backstop, so
      // nobody is sent to Intuit with an empty client id.
      throw new Error('QuickBooks OAuth is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', QUICKBOOKS_LOGIN_SCOPES.join(' '));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = quickbooksApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    const realmId = query.realmId?.trim() ?? '';
    if (!REALM_ID.test(realmId)) {
      // Every grant reads one company; without its id there is nothing to read.
      return { ok: false, reason: 'missing_company' };
    }
    let tokens: RefreshedTokens;
    try {
      const body = await postTokenRequest({
        vendor: 'QuickBooks',
        url: TOKEN_URL,
        encoding: 'form',
        basicAuth: app,
        params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('quickbooks login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const company = await lookUpCompany(tokens.accessToken, realmId);
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        realmId,
        companyName: company.companyName,
        environment: company.environment,
      },
      displayName: `QuickBooks — ${company.companyName ?? `company ${realmId}`}`,
    };
  },

  summarize: (credentials) => {
    const realmId = typeof credentials.realmId === 'string' ? credentials.realmId : '';
    if (!realmId || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    const name = typeof credentials.companyName === 'string' && credentials.companyName.trim() ? credentials.companyName.trim() : null;
    const sandbox = credentials.environment === 'sandbox' ? ', sandbox' : '';
    // The company id is in the account so two companies with one name stay two logins.
    return { account: `${name ?? 'QuickBooks company'} (company ${realmId}${sandbox})` };
  },
};
