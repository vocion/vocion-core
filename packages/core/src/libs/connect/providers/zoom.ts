/**
 * "Connect with Zoom" for the Zoom connector: OAuth 2.0 authorization code on
 * a Zoom "General app" (user-managed OAuth). This is a different app from the
 * Server-to-Server one people paste credentials for today: the person consents
 * as themselves, and the grant reads what that person may read.
 *
 * Zoom takes the app's scopes from the app's configuration in the Zoom
 * Marketplace, so the authorize URL carries no `scope` parameter;
 * `ZOOM_LOGIN_SCOPES` lists what the app must be configured with.
 *
 * Zoom rotates the refresh token on every refresh (the old one stops
 * working) and a refresh token lasts 90 days. `libs/sources/zoom.ts` refreshes
 * an expiring grant through `usableLoginGrant` and saves the rotated token.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { grantExpiresAt, postTokenRequest, TokenRequestError } from '../loginGrant';

const AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
const TOKEN_URL = 'https://zoom.us/oauth/token';
const ME_URL = 'https://api.zoom.us/v2/users/me';
/** Zoom access tokens live one hour; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 3600;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/**
 * What the Zoom app must be configured with for the connector to read a
 * person's cloud recordings. A Zoom admin can additionally grant the `:admin`
 * variants (`user:read:list_users:admin`, `cloud_recording:read:list_user_recordings:admin`,
 * `cloud_recording:read:list_recording_files:admin`) to read every user's recordings.
 */
export const ZOOM_LOGIN_SCOPES = [
  'user:read:user',
  'cloud_recording:read:list_user_recordings',
  'cloud_recording:read:list_recording_files',
  'cloud_recording:read:meeting_transcript',
] as const;

/**
 * The deployment's Zoom General-app client id and secret, or null when either is unset.
 */
function zoomApp(): { clientId: string; clientSecret: string } | null {
  const clientId = Env.ZOOM_CLIENT_ID;
  const clientSecret = Env.ZOOM_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
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
    throw new TokenRequestError('Zoom', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS, now),
    ...(typeof body.scope === 'string' && body.scope ? { scope: body.scope } : {}),
  };
}

/**
 * Mint a new Zoom access token from a refresh token. Zoom rotates the
 * refresh token: the returned one replaces the one passed in.
 * @param refreshToken - The stored refresh token.
 * @throws TokenRequestError when Zoom refuses or cannot be reached, or the deployment has no Zoom app configured.
 */
export async function refreshZoomGrant(refreshToken: string): Promise<RefreshedTokens> {
  const app = zoomApp();
  if (!app) {
    throw new TokenRequestError('Zoom', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Zoom',
    url: TOKEN_URL,
    encoding: 'form',
    basicAuth: app,
    params: { grant_type: 'refresh_token', refresh_token: refreshToken },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * Who a fresh access token belongs to: the user's email and the Zoom account
 * id. Fields are read defensively; null when Zoom would not say, and the login
 * still works under a generic name.
 * @param accessToken - The access token just issued.
 */
async function lookUpIdentity(accessToken: string): Promise<{ email: string | null; accountId: string | null }> {
  try {
    const response = await fetch(ME_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('zoom login could not look up the user', { status: response.status });
      return { email: null, accountId: null };
    }
    const me = await response.json() as Record<string, unknown>;
    return {
      email: typeof me.email === 'string' && me.email ? me.email : null,
      accountId: typeof me.account_id === 'string' && me.account_id ? me.account_id : null,
    };
  } catch (error) {
    logger.warn('zoom login could not look up the user', { errorName: error instanceof Error ? error.name : 'unknown' });
    return { email: null, accountId: null };
  }
}

/**
 * Zoom's refusal on the callback as a short code safe to show: `access_denied`
 * when the person declined, never free text that could echo the request.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const zoomProvider: ConnectProvider = {
  id: 'zoom',
  connectorSlugs: ['zoom'],
  label: 'Zoom',
  requiredEnv: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
  configured: () => zoomApp() !== null,

  authorizeUrl({ state, redirectUri }) {
    const app = zoomApp();
    if (!app) {
      // The start route checks `configured()` first; this is the backstop, so
      // nobody is sent to Zoom with an empty client id.
      throw new Error('Zoom OAuth is not configured. Set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ query, redirectUri }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = zoomApp();
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
        vendor: 'Zoom',
        url: TOKEN_URL,
        encoding: 'form',
        basicAuth: app,
        params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('zoom login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const identity = await lookUpIdentity(tokens.accessToken);
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        email: identity.email,
        accountId: identity.accountId,
      },
      displayName: identity.email ? `Zoom — ${identity.email}` : 'Zoom',
    };
  },

  summarize: (credentials) => {
    const email = typeof credentials.email === 'string' ? credentials.email.trim() : '';
    if (!email || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    return { account: email };
  },
};
