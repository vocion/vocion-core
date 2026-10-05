/**
 * "Connect with Apollo" for the Apollo connector: Apollo's partner OAuth 2.0
 * authorization code. The grant stores the access token (30 days), the
 * refresh token and the Apollo account it is on.
 *
 * Apollo ROTATES on refresh: a refresh revokes the old pair, so the new
 * refresh token must be saved (`usableLoginGrant` does that, compare-and-swap)
 * and a refresh that cannot be saved is reported rather than hidden.
 *
 * `libs/apollo/client.ts` sends a login's access token as a Bearer token; a
 * pasted API key still goes as `x-api-key`.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { grantExpiresAt, postTokenRequest, TokenRequestError } from '../loginGrant';

/** Apollo's consent page is a hash route: the query string goes AFTER `#/oauth/authorize?`. */
const AUTHORIZE_BASE = 'https://app.apollo.io/#/oauth/authorize';
const TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token';
const PROFILE_URL = 'https://app.apollo.io/api/v1/users/api_profile';
/** Apollo access tokens live 30 days; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 2_592_000;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/**
 * Scopes asked for. Apollo's partner docs name `read_user_profile` (who is
 * connected) and `app_scopes` (the scopes the app was registered with). The
 * Apollo source's endpoints (people and company search, enrichment, usage)
 * have no per-endpoint scope name we could verify, so none is invented here:
 * what the app is registered for is what the grant carries.
 */
export const APOLLO_LOGIN_SCOPES = ['read_user_profile', 'app_scopes'] as const;

/**
 * The deployment's Apollo app credentials, or null when either is unset.
 */
function apolloApp(): { clientId: string; clientSecret: string } | null {
  const clientId = Env.APOLLO_CLIENT_ID;
  const clientSecret = Env.APOLLO_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Turn a token response into the tokens a grant keeps. A response with no
 * refresh token keeps the one that was sent, so the run still has a working
 * access token; the next refresh then says plainly that the login must be redone.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens {
  const accessToken = body.access_token;
  const returnedRefresh = body.refresh_token;
  const refreshToken = typeof returnedRefresh === 'string' && returnedRefresh ? returnedRefresh : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('Apollo', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS, now),
    ...(typeof body.scope === 'string' && body.scope ? { scope: body.scope } : {}),
  };
}

/**
 * Mint a new Apollo access token from a refresh token. Apollo revokes the
 * old access and refresh tokens when this succeeds.
 * @param refreshToken - The stored refresh token.
 * @throws {TokenRequestError} TokenRequestError when Apollo refuses or cannot be reached, or the deployment has no Apollo app configured.
 */
export async function refreshApolloGrant(refreshToken: string): Promise<RefreshedTokens> {
  const app = apolloApp();
  if (!app) {
    throw new TokenRequestError('Apollo', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Apollo',
    url: TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * The first non-empty string among the candidates.
 * @param candidates - Values of unknown type.
 */
function firstText(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Who a fresh access token belongs to, read defensively: Apollo's profile
 * body has put the fields at the top level and under `user`. Null when
 * Apollo would not say; the login still works with a generic name.
 * @param accessToken - The access token just issued.
 */
async function lookUpAccount(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(PROFILE_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('apollo login could not look up the account', { status: response.status });
      return null;
    }
    const body = await response.json() as Record<string, unknown>;
    const user = (body.user && typeof body.user === 'object' ? body.user : {}) as Record<string, unknown>;
    return firstText(user.email, body.email, user.name, body.name);
  } catch (error) {
    logger.warn('apollo login could not look up the account', { errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/**
 * Apollo's refusal on the callback as a short code safe to show, never free text.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const apolloProvider: ConnectProvider = {
  id: 'apollo',
  connectorSlugs: ['apollo'],
  label: 'Apollo',
  requiredEnv: ['APOLLO_CLIENT_ID', 'APOLLO_CLIENT_SECRET'],
  configured: () => apolloApp() !== null,

  authorizeUrl({ state, redirectUri }) {
    const app = apolloApp();
    if (!app) {
      // The start route checks `configured()` first; this is the backstop.
      throw new Error('Apollo OAuth is not configured. Set APOLLO_CLIENT_ID and APOLLO_CLIENT_SECRET.');
    }
    const query = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: APOLLO_LOGIN_SCOPES.join(' '),
      state,
    });
    return `${AUTHORIZE_BASE}?${query.toString()}`;
  },

  async exchange({ query, redirectUri }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = apolloApp();
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
        vendor: 'Apollo',
        url: TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('apollo login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const account = await lookUpAccount(tokens.accessToken);
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        account,
        ...(tokens.scope ? { scope: tokens.scope } : {}),
      },
      displayName: `Apollo — ${account ?? 'account'}`,
    };
  },

  summarize: (credentials) => {
    const account = typeof credentials.account === 'string' ? credentials.account.trim() : '';
    if (!account || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    return { account: `${account} (Apollo)` };
  },
};
