/**
 * "Log in with Google" for the Gmail, Drive, Google Calendar and Google
 * Analytics connectors — OAuth 2.0 authorization-code flow.
 *
 * One OAuth client serves all four connectors, but each login asks ONLY for
 * the connector it was started from (least privilege): a Drive login cannot
 * read mail. Google refresh tokens do not rotate, so the stored refresh token
 * stays good until the person revokes it; `sources/googleAuth.ts` mints access
 * tokens from it using this deployment's client (the bag stores no client).
 *
 * Google Ads is not served: it also needs a developer token a login cannot give.
 */

import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const USERINFO_TIMEOUT_MS = 15_000;
const GOOGLE_ACCESS_TOKEN_SECONDS = 3600;
const SAFE_ERROR_CODE = /^[\w.-]{1,64}$/;
const IDENTITY_SCOPES = ['openid', 'email'] as const;

/**
 * The vendor scopes each connector needs, without the identity scopes.
 * Read-only everywhere: no source in this app sends mail or writes files.
 */
export const GOOGLE_LOGIN_SCOPES: Record<string, readonly string[]> = {
  'gmail': ['https://www.googleapis.com/auth/gmail.readonly'],
  'drive': ['https://www.googleapis.com/auth/drive.readonly'],
  'google-calendar': ['https://www.googleapis.com/auth/calendar.readonly'],
  'ga4': ['https://www.googleapis.com/auth/analytics.readonly'],
};

/** What the person sees for each connector, for error sentences. */
const CONNECTOR_NAMES: Record<string, string> = {
  'gmail': 'Gmail',
  'drive': 'Google Drive',
  'google-calendar': 'Google Calendar',
  'ga4': 'Google Analytics',
};

/**
 * The Google app a login or refresh runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function googleClient(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('google');
}

/**
 * The email of the account that logged in, from Google's userinfo endpoint.
 * Null when Google does not answer; the login then fails rather than store a
 * grant nobody can recognise.
 * @param accessToken - The access token just issued.
 */
async function fetchLoginEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('Google userinfo refused the request', { status: response.status });
      return null;
    }
    const body = (await response.json()) as { email?: unknown };
    return typeof body.email === 'string' && body.email ? body.email : null;
  } catch (error) {
    logger.warn('Google userinfo could not be read', { errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/**
 * Whether a space-separated scope string contains every scope in a list.
 * @param granted - The bag's `scope`.
 * @param required - Scopes the connector needs.
 */
function hasEveryScope(granted: string, required: readonly string[]): boolean {
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  return required.every(scope => grantedSet.has(scope));
}

export const googleProvider: ConnectProvider = {
  id: 'google',
  connectorSlugs: ['gmail', 'drive', 'google-calendar', 'ga4'],
  label: 'Google',
  requiredEnv: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  configured: () => googleClient() !== null,

  authorizeUrl({ state, redirectUri, connector, client: chosen }) {
    const client = googleClient(chosen);
    if (!client) {
      throw new Error('Google OAuth is not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
    }
    const vendorScopes = GOOGLE_LOGIN_SCOPES[connector];
    if (!vendorScopes) {
      throw new Error(`Google login does not serve the "${connector}" connector.`);
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', client.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', [...vendorScopes, ...IDENTITY_SCOPES].join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    // Without this Google omits the refresh token on a repeat login.
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  },

  async exchange({ query, redirectUri, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: SAFE_ERROR_CODE.test(query.error) ? query.error : 'login_refused' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    const client = googleClient(chosen);
    if (!client) {
      return { ok: false, reason: 'not_configured' };
    }
    let body: Record<string, unknown>;
    try {
      body = await postTokenRequest({
        vendor: 'Google',
        url: TOKEN_URL,
        encoding: 'form',
        params: {
          client_id: client.clientId,
          client_secret: client.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        },
      });
    } catch (error) {
      if (error instanceof TokenRequestError) {
        return { ok: false, reason: error.code };
      }
      logger.warn('Google token exchange failed unexpectedly', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: 'token_exchange_failed' };
    }
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!accessToken) {
      return { ok: false, reason: 'no_access_token' };
    }
    if (!refreshToken) {
      return { ok: false, reason: 'no_refresh_token' };
    }
    const email = await fetchLoginEmail(accessToken);
    if (!email) {
      return { ok: false, reason: 'no_email' };
    }
    return {
      ok: true,
      credentials: {
        accessToken,
        refreshToken,
        expiresAt: grantExpiresAt(body.expires_in, GOOGLE_ACCESS_TOKEN_SECONDS),
        scope: typeof body.scope === 'string' ? body.scope : '',
        email,
      },
      displayName: `Google — ${email}`,
    };
  },

  summarize: (credentials) => {
    if (typeof credentials.email !== 'string' || !credentials.email || typeof credentials.refreshToken !== 'string' || !credentials.refreshToken) {
      return null;
    }
    return { account: credentials.email };
  },

  missingAccessFor: (credentials, connectorSlug) => {
    const required = GOOGLE_LOGIN_SCOPES[connectorSlug];
    if (!required || typeof credentials.scope !== 'string') {
      return null;
    }
    if (hasEveryScope(credentials.scope, required)) {
      return null;
    }
    return `This Google login doesn't include ${CONNECTOR_NAMES[connectorSlug] ?? connectorSlug}. Press Replace and log in with Google again to add it.`;
  },
};
