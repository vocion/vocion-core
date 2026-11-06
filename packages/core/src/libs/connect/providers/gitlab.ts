/**
 * "Connect with GitLab" for the gitlab connector: OAuth 2.0 authorization
 * code with PKCE (S256) on a confidential application, on gitlab.com or on a
 * self-managed instance (`GITLAB_OAUTH_BASE_URL`). A person signs in with
 * their GitLab account and consents once; pasting a personal, project or
 * group access token stays the fallback, and the only path when the
 * deployment has registered no application.
 *
 * The grant stores `{ accessToken, refreshToken, expiresAt, baseUrl, account,
 * scope }`. GitLab access tokens live two hours and every refresh ROTATES the
 * refresh token, so each use goes through `resolveGitlabAccess`
 * (`libs/gitlab/token.ts`), which refreshes an expiring grant through
 * `usableLoginGrant` and saves the rotated pair before the call goes out:
 * the source's sync, the repo family's provider and the runner's push
 * credential all read it that way. `baseUrl` is the instance the token is
 * good on; a token from one instance means nothing on another.
 *
 * Scopes: `api`, because the factory writes (a comment, an approval, a
 * merge, a branch, a merge request), and `read_user`, to say whose account
 * the connector card is on.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { Env } from '@/libs/Env';
import { GITLAB_URL, normalizeBaseUrl } from '@/libs/gitlab/client';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { callbackUri, connectOrigin } from '../routes';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

/** GitLab's documented access token lifetime, used when a response omits `expires_in`. */
const GITLAB_ACCESS_TOKEN_SECONDS = 7200;
const IDENTITY_TIMEOUT_MS = 15_000;
const SAFE_REFUSAL = /^[\w.-]{1,64}$/;

/** What the login asks for: `api` for the factory's writes, `read_user` for whose account it is. */
export const GITLAB_LOGIN_SCOPES = ['api', 'read_user'] as const;

/** The instance the deployment's GitLab application is registered on. */
export function gitlabOauthBaseUrl(): string {
  return normalizeBaseUrl(Env.GITLAB_OAUTH_BASE_URL ?? GITLAB_URL);
}

/**
 * The GitLab application a login or refresh runs on: the caller's choice,
 * else this server's env application, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function gitlabApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('gitlab');
}

/**
 * The tokens a token response carries. GitLab rotates the refresh token on
 * every refresh; a response without one keeps the one sent.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the first exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens {
  const accessToken = body.access_token;
  const returned = body.refresh_token;
  const refreshToken = typeof returned === 'string' && returned ? returned : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('GitLab', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, GITLAB_ACCESS_TOKEN_SECONDS, now),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

/**
 * Mint a new access token from a refresh token, on the instance the grant
 * was issued by. GitLab asks for the same `redirect_uri` the login used.
 * @param refreshToken - The stored refresh token.
 * @param client - The application the login ran on.
 * @param baseUrl - The instance; the deployment's when omitted.
 * @throws {TokenRequestError} When GitLab refuses or the deployment has no application.
 */
export async function refreshGitlabGrant(refreshToken: string, client?: LoginClient, baseUrl?: string): Promise<RefreshedTokens> {
  const app = gitlabApp(client);
  if (!app) {
    throw new TokenRequestError('GitLab', 'not_configured', null);
  }
  const origin = connectOrigin();
  const body = await postTokenRequest({
    vendor: 'GitLab',
    url: `${normalizeBaseUrl(baseUrl ?? gitlabOauthBaseUrl())}/oauth/token`,
    encoding: 'form',
    params: {
      grant_type: 'refresh_token',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: refreshToken,
      ...(origin ? { redirect_uri: callbackUri(origin, 'gitlab') } : {}),
    },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * Whose account a fresh token is on. Null when GitLab would not say; the
 * login still works, it just carries a generic name.
 * @param baseUrl - The instance.
 * @param accessToken - The token just issued. Never logged.
 */
async function lookUpUser(baseUrl: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v4/user`, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn('gitlab login could not look up the account', { status: res.status });
      return null;
    }
    const user = await res.json() as { username?: unknown };
    return typeof user.username === 'string' && user.username ? user.username : null;
  } catch (error) {
    logger.warn('gitlab login could not look up the account', { errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/** GitLab OAuth login (connector `gitlab`). */
export const gitlabProvider: ConnectProvider = {
  id: 'gitlab',
  connectorSlugs: ['gitlab'],
  label: 'GitLab',
  requiredEnv: ['GITLAB_OAUTH_CLIENT_ID', 'GITLAB_OAUTH_CLIENT_SECRET'],
  configured: () => gitlabApp() !== null,
  // GitLab supports PKCE for confidential applications too; it binds the
  // code to this browser's start, so a leaked code is worth nothing.
  pkce: true,

  authorizeUrl({ state, redirectUri, codeChallenge, client: chosen }) {
    const app = gitlabApp(chosen);
    if (!app) {
      throw new Error('GitLab login is not set up: set GITLAB_OAUTH_CLIENT_ID and GITLAB_OAUTH_CLIENT_SECRET.');
    }
    const url = new URL(`${gitlabOauthBaseUrl()}/oauth/authorize`);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GITLAB_LOGIN_SCOPES.join(' '));
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
    const app = gitlabApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    if (!query.code) {
      return { ok: false, reason: 'missing_code' };
    }
    const baseUrl = gitlabOauthBaseUrl();
    let tokens: RefreshedTokens;
    try {
      const body = await postTokenRequest({
        vendor: 'GitLab',
        url: `${baseUrl}/oauth/token`,
        encoding: 'form',
        params: {
          grant_type: 'authorization_code',
          client_id: app.clientId,
          client_secret: app.clientSecret,
          code: query.code,
          redirect_uri: redirectUri,
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('gitlab login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const account = await lookUpUser(baseUrl, tokens.accessToken);
    return {
      ok: true,
      credentials: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope ?? GITLAB_LOGIN_SCOPES.join(' '),
        baseUrl,
        account,
      },
      displayName: `GitLab — ${account ?? new URL(baseUrl).hostname}`,
    };
  },

  summarize(credentials) {
    if (typeof credentials.refreshToken !== 'string' || typeof credentials.baseUrl !== 'string') {
      return null;
    }
    const host = (() => {
      try {
        return new URL(credentials.baseUrl as string).hostname;
      } catch {
        return 'GitLab';
      }
    })();
    const account = typeof credentials.account === 'string' && credentials.account ? credentials.account : null;
    return { account: account ? `${account} on ${host}` : host };
  },
};
