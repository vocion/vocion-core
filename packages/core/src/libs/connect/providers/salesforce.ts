/**
 * "Connect with Salesforce" for the Salesforce connector: OAuth 2.0 web
 * server flow with PKCE, on a Salesforce connected app (or external client
 * app). The person consents once for their Salesforce org; the grant stores
 * the access token, the refresh token, the org's instance URL (every API
 * call goes there, not to the login host) and the username it is on.
 *
 * The app is the workspace's own when an admin saved a Salesforce login app
 * on the Developers page, else this server's (`SALESFORCE_CLIENT_ID` /
 * `SALESFORCE_CLIENT_SECRET`) — `libs/connect/loginClient.ts` decides. A
 * sandbox logs in at `SALESFORCE_LOGIN_URL=https://test.salesforce.com`.
 *
 * Salesforce's token response carries no `expires_in`: an access token lives
 * as long as the org's session timeout, which an admin can set as low as 15
 * minutes. The grant is therefore treated as expiring after that minimum, so
 * a token is never sent past an org's shortest session; a refresh is one
 * cheap call, and Salesforce does not rotate the refresh token by default
 * (a rotated one is kept when it does).
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const DEFAULT_LOGIN_URL = 'https://login.salesforce.com';
/** The shortest session timeout a Salesforce org can set; an access token is never trusted longer. */
const SHORTEST_SESSION_SECONDS = 900;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** What the Salesforce login asks for: API access, a refresh token, and who the person is. */
export const SALESFORCE_LOGIN_SCOPES = ['api', 'refresh_token', 'offline_access', 'id'] as const;

/** Where a login starts and a token is minted: login.salesforce.com, or the sandbox host. */
export function salesforceLoginUrl(): string {
  return (Env.SALESFORCE_LOGIN_URL ?? DEFAULT_LOGIN_URL).replace(/\/+$/, '');
}

/**
 * The Salesforce app a login or refresh runs on: the one the caller chose,
 * else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function salesforceApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('salesforce');
}

/**
 * Turn a token response into the tokens a grant keeps. A response with no
 * refresh token keeps the one that was sent.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens & { instanceUrl: string | null; identityUrl: string | null } {
  const accessToken = body.access_token;
  const returned = body.refresh_token;
  const refreshToken = typeof returned === 'string' && returned ? returned : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('Salesforce', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, SHORTEST_SESSION_SECONDS, now),
    instanceUrl: typeof body.instance_url === 'string' && /^https:\/\//.test(body.instance_url) ? body.instance_url.replace(/\/+$/, '') : null,
    identityUrl: typeof body.id === 'string' && /^https:\/\//.test(body.id) ? body.id : null,
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

/**
 * Mint a new Salesforce access token from a refresh token.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login was issued to.
 * @throws {TokenRequestError} When Salesforce refuses or cannot be reached, or no app is set up.
 */
export async function refreshSalesforceGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = salesforceApp(client);
  if (!app) {
    throw new TokenRequestError('Salesforce', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Salesforce',
    url: `${salesforceLoginUrl()}/services/oauth2/token`,
    encoding: 'form',
    params: { grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken },
  });
  const { accessToken, refreshToken: next, expiresAt, scope } = tokensFrom(body, refreshToken);
  return { accessToken, refreshToken: next, expiresAt, ...(scope ? { scope } : {}) };
}

/**
 * Who a fresh access token belongs to, from the identity URL the token
 * response named. Null fields when Salesforce would not say; the login still
 * works, it just carries a generic name.
 * @param identityUrl - The token response's `id`.
 * @param accessToken - The access token just issued.
 */
async function lookUpIdentity(identityUrl: string | null, accessToken: string): Promise<{ username: string | null; orgId: string | null }> {
  if (!identityUrl) {
    return { username: null, orgId: null };
  }
  try {
    const response = await fetch(identityUrl, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn('salesforce login could not look up the account', { status: response.status });
      return { username: null, orgId: null };
    }
    const info = await response.json() as Record<string, unknown>;
    return {
      username: typeof info.username === 'string' && info.username ? info.username : null,
      orgId: typeof info.organization_id === 'string' && info.organization_id ? info.organization_id : null,
    };
  } catch (error) {
    logger.warn('salesforce login could not look up the account', { errorName: error instanceof Error ? error.name : 'unknown' });
    return { username: null, orgId: null };
  }
}

export const salesforceProvider: ConnectProvider = {
  id: 'salesforce',
  connectorSlugs: ['salesforce'],
  label: 'Salesforce',
  requiredEnv: ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'],
  configured: () => salesforceApp() !== null,
  pkce: true,

  authorizeUrl({ state, redirectUri, codeChallenge, client: chosen }) {
    const app = salesforceApp(chosen);
    if (!app) {
      throw new Error('Salesforce OAuth is not configured. Set SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET, or save a Salesforce login app on the Developers page.');
    }
    const url = new URL(`${salesforceLoginUrl()}/services/oauth2/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SALESFORCE_LOGIN_SCOPES.join(' '));
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  },

  async exchange({ query, redirectUri, codeVerifier, client: chosen }) {
    if (query.error) {
      return { ok: false, reason: SAFE_REFUSAL.test(query.error) ? query.error : 'authorization_refused' };
    }
    const app = salesforceApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    let tokens: ReturnType<typeof tokensFrom>;
    try {
      const body = await postTokenRequest({
        vendor: 'Salesforce',
        url: `${salesforceLoginUrl()}/services/oauth2/token`,
        encoding: 'form',
        params: {
          grant_type: 'authorization_code',
          code,
          client_id: app.clientId,
          client_secret: app.clientSecret,
          redirect_uri: redirectUri,
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('salesforce login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    if (!tokens.instanceUrl) {
      return { ok: false, reason: 'no_instance_url' };
    }
    const identity = await lookUpIdentity(tokens.identityUrl, tokens.accessToken);
    const host = new URL(tokens.instanceUrl).hostname;
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        instanceUrl: tokens.instanceUrl,
        account: identity.username,
        salesforceOrgId: identity.orgId,
        ...(tokens.scope ? { scope: tokens.scope } : {}),
      },
      displayName: `Salesforce — ${identity.username ?? host}`,
    };
  },

  summarize: (credentials) => {
    if (typeof credentials.refreshToken !== 'string' || typeof credentials.instanceUrl !== 'string') {
      return null;
    }
    const account = typeof credentials.account === 'string' && credentials.account
      ? credentials.account
      : credentials.instanceUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return account ? { account: `${account} (Salesforce)` } : null;
  },
};
