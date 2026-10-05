/**
 * "Connect with HubSpot" for the HubSpot connector: OAuth 2.0 authorization
 * code. The person consents once for their HubSpot account; the grant stores
 * the access token (30 minutes), the refresh token and the account it is on.
 *
 * `libs/sources/hubspot.ts` reads `accessToken` and, when it is expiring,
 * refreshes it with `refreshHubspotGrant` through `usableLoginGrant`
 * (`libs/connect/loginGrant.ts`). A pasted private-app token never has a
 * refresh token, so it never takes that path.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { grantExpiresAt, postTokenRequest, TokenRequestError } from '../loginGrant';

const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const ACCESS_TOKEN_INFO_URL = 'https://api.hubapi.com/oauth/v1/access-tokens';
/** HubSpot access tokens live 30 minutes; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 1800;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** What the HubSpot source reads: the three CRM objects it syncs, plus `oauth`, which HubSpot requires on every install. */
export const HUBSPOT_LOGIN_SCOPES = ['oauth', 'crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read'] as const;

/**
 * The deployment's HubSpot app credentials, or null when either is unset.
 */
function hubspotApp(): { clientId: string; clientSecret: string } | null {
  const clientId = Env.HUBSPOT_CLIENT_ID;
  const clientSecret = Env.HUBSPOT_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Turn a token response into the tokens a grant keeps. A response with no
 * refresh token keeps the one that was sent (HubSpot does not rotate today,
 * but a rotation must still be saved).
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens {
  const accessToken = body.access_token;
  const returnedRefresh = body.refresh_token;
  const refreshToken = typeof returnedRefresh === 'string' && returnedRefresh ? returnedRefresh : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('HubSpot', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS, now),
  };
}

/**
 * Mint a new HubSpot access token from a refresh token.
 * @param refreshToken - The stored refresh token.
 * @throws {TokenRequestError} TokenRequestError when HubSpot refuses or cannot be reached, or the deployment has no HubSpot app configured.
 */
export async function refreshHubspotGrant(refreshToken: string): Promise<RefreshedTokens> {
  const app = hubspotApp();
  if (!app) {
    throw new TokenRequestError('HubSpot', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'HubSpot',
    url: TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * Who a fresh access token belongs to: the portal id and the user's email
 * (or the portal's domain). Null when HubSpot would not say; the login still
 * works, it just carries a generic name.
 * @param accessToken - The access token just issued.
 */
async function lookUpIdentity(accessToken: string): Promise<{ hubId: number | null; account: string | null }> {
  try {
    const response = await fetch(`${ACCESS_TOKEN_INFO_URL}/${encodeURIComponent(accessToken)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('hubspot login could not look up the account', { status: response.status });
      return { hubId: null, account: null };
    }
    const info = await response.json() as Record<string, unknown>;
    const user = typeof info.user === 'string' && info.user ? info.user : null;
    const domain = typeof info.hub_domain === 'string' && info.hub_domain ? info.hub_domain : null;
    const hubId = typeof info.hub_id === 'number' ? info.hub_id : null;
    return { hubId, account: user ?? domain };
  } catch (error) {
    logger.warn('hubspot login could not look up the account', { errorName: error instanceof Error ? error.name : 'unknown' });
    return { hubId: null, account: null };
  }
}

/**
 * HubSpot's refusal on the callback as a short code safe to show: `access_denied`
 * when the person declined, never free text that could echo the request.
 * @param query - The callback's query.
 */
function refusalReason(query: Record<string, string>): string {
  return query.error && SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused';
}

export const hubspotProvider: ConnectProvider = {
  id: 'hubspot',
  connectorSlugs: ['hubspot'],
  label: 'HubSpot',
  requiredEnv: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  configured: () => hubspotApp() !== null,

  authorizeUrl({ state, redirectUri }) {
    const app = hubspotApp();
    if (!app) {
      // The start route checks `configured()` first; this is the backstop, so
      // nobody is sent to HubSpot with an empty client id.
      throw new Error('HubSpot OAuth is not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', HUBSPOT_LOGIN_SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ query, redirectUri }) {
    if (query.error) {
      return { ok: false, reason: refusalReason(query) };
    }
    const app = hubspotApp();
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
        vendor: 'HubSpot',
        url: TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('hubspot login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const identity = await lookUpIdentity(tokens.accessToken);
    const accountName = identity.account ?? (identity.hubId === null ? 'account' : `portal ${identity.hubId}`);
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        hubId: identity.hubId,
        account: identity.account,
      },
      displayName: `HubSpot — ${accountName}`,
    };
  },

  summarize: (credentials) => {
    const account = typeof credentials.account === 'string' ? credentials.account.trim() : '';
    if (!account || typeof credentials.refreshToken !== 'string') {
      return null;
    }
    return { account: `${account} (HubSpot)` };
  },
};
