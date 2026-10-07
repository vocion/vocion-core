/**
 * "Log in with PostHog" for the posthog connector: OAuth 2.0 authorization
 * code with PKCE (S256, mandatory at PostHog) and no client secret.
 *
 * PostHog has no app registry we fill in. Our `client_id` is a URL we host
 * (`/api/connect-client/posthog`, a Client ID Metadata Document), which PostHog
 * fetches to learn the one callback it may return to. That is why the login
 * is offered only on a public https origin.
 *
 * The grant stores `{ accessToken (pha_), refreshToken (phr_), expiresAt, host,
 * projectId?, account, scope }`. The access token lives ten hours, so a sync
 * refreshes it first (`withFreshPosthogGrant`). `host` is the region the
 * token works in, found at login; the token endpoint itself is region-agnostic.
 */

import type { GrantPersistence, LoginGrant, RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import { logger } from '@/libs/Logger';
import { POSTHOG_EU_HOST, POSTHOG_US_HOST } from '@/libs/posthog/client';
import { grantExpiresAt, isLoginGrant, usableLoginGrant } from '../loginGrant';
import { callbackUri, connectOrigin } from '../routes';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://oauth.posthog.com/oauth/authorize/';
const TOKEN_URL = 'https://oauth.posthog.com/oauth/token/';
const PROBE_TIMEOUT_MS = 15_000;
/** PostHog's documented access token lifetime, used when a response omits `expires_in`. */
const POSTHOG_ACCESS_TOKEN_SECONDS = 36_000;
const SAFE_ERROR_CODE = /^[\w.-]{1,64}$/;

/**
 * Scopes read from PostHog's `scopes_supported`. The source runs HogQL through
 * the Query API (`query:read`), lists event definitions (`event_definition:read`)
 * and reads the project (`project:read`). Read-only; nothing writes.
 */
export const POSTHOG_LOGIN_SCOPES = ['query:read', 'event_definition:read', 'project:read'] as const;

/**
 * The public URL PostHog fetches as our OAuth client.
 * @param origin - The configured public origin.
 */
export function posthogClientId(origin: string): string {
  return `${origin}/api/connect-client/posthog`;
}

/**
 * The Client ID Metadata Document for this deployment. `client_id` must equal
 * the URL it is served from, and `redirect_uris` must be exactly the callback
 * the start route sends.
 * @param origin - The configured public origin.
 */
export function posthogClientMetadata(origin: string): Record<string, unknown> {
  return {
    client_id: posthogClientId(origin),
    client_name: 'Vocion',
    logo_uri: `${origin}/brand/vocion-primary-mark.svg`,
    redirect_uris: [callbackUri(origin, 'posthog')],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

/** The client id of this deployment, or null when it has no public https origin PostHog could reach. */
function posthogClientIdOrNull(): string | null {
  const origin = connectOrigin();
  return origin && origin.startsWith('https://') ? posthogClientId(origin) : null;
}

/**
 * Mint a new access token from a refresh token. PostHog rotates the refresh
 * token, so the new one is returned and must be saved.
 * @param refreshToken - The stored `phr_` token.
 */
export async function refreshPosthogGrant(refreshToken: string): Promise<RefreshedTokens> {
  const clientId = posthogClientIdOrNull();
  if (!clientId) {
    throw new TokenRequestError('PostHog', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'PostHog',
    url: TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
  });
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new TokenRequestError('PostHog', 'no_access_token', null);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, POSTHOG_ACCESS_TOKEN_SECONDS),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

/**
 * The credential bag a PostHog call should use: a login grant is refreshed
 * (and saved) when its token is expiring; a pasted key passes through
 * untouched. Test connection (`never`) throws a sentence instead of refreshing.
 * @param credentials - The decrypted bag.
 * @param persistence - Save a refresh (sync) or never refresh (Test connection).
 */
export async function withFreshPosthogGrant(
  credentials: Record<string, unknown> | undefined,
  persistence: GrantPersistence,
): Promise<Record<string, unknown> | undefined> {
  if (!isLoginGrant(credentials)) {
    return credentials;
  }
  return usableLoginGrant({
    vendor: 'PostHog',
    provider: 'posthog',
    connectorSlug: 'posthog',
    grant: credentials as LoginGrant,
    persistence,
    refresh: refreshPosthogGrant,
  });
}

type ProjectListEntry = { id?: number; name?: string };

/**
 * Which PostHog region the token works in, by asking each: the region that
 * accepts the token answers; the other refuses it. Returns the host and the
 * projects the token can see, or null when neither region accepts it.
 * @param accessToken - The token just issued. Never logged.
 */
async function findRegion(accessToken: string): Promise<{ host: string; projects: ProjectListEntry[] } | null> {
  for (const host of [POSTHOG_US_HOST, POSTHOG_EU_HOST]) {
    try {
      const response = await fetch(`${host}/api/projects/`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = await response.json() as { results?: ProjectListEntry[] };
        return { host, projects: Array.isArray(body.results) ? body.results : [] };
      }
    } catch (error) {
      logger.warn('PostHog region probe failed', { host, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return null;
}

/**
 * The numeric ids PostHog says the grant is limited to.
 * @param scopedTeams - The token response's `scoped_teams`.
 */
function scopedProjectIds(scopedTeams: unknown): number[] {
  return Array.isArray(scopedTeams) ? scopedTeams.filter((id): id is number => typeof id === 'number') : [];
}

export const posthogProvider: ConnectProvider = {
  id: 'posthog',
  connectorSlugs: ['posthog'],
  label: 'PostHog',
  requiredEnv: ['NEXT_PUBLIC_APP_URL (a public https address PostHog can reach)'],
  configured: () => posthogClientIdOrNull() !== null,
  pkce: true,

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const clientId = posthogClientIdOrNull();
    if (!clientId || !codeChallenge) {
      // The start route checks `configured()` and sets `pkce`; this is the backstop.
      throw new Error('PostHog login needs a public https NEXT_PUBLIC_APP_URL and a PKCE challenge.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', POSTHOG_LOGIN_SCOPES.join(' '));
    return url.toString();
  },

  async exchange({ query, redirectUri, codeVerifier }) {
    if (query.error) {
      // PostHog's own code (`access_denied` when declined), only when it is a short safe token.
      return { ok: false, reason: SAFE_ERROR_CODE.test(query.error) ? query.error : 'login_refused' };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    const clientId = posthogClientIdOrNull();
    if (!clientId || !codeVerifier) {
      return { ok: false, reason: 'not_configured' };
    }
    let body: Record<string, unknown>;
    try {
      body = await postTokenRequest({
        vendor: 'PostHog',
        url: TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier },
      });
    } catch (error) {
      if (error instanceof TokenRequestError) {
        return { ok: false, reason: error.code };
      }
      logger.warn('PostHog token exchange failed unexpectedly', { errorName: error instanceof Error ? error.name : 'unknown' });
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
    const region = await findRegion(accessToken);
    if (!region) {
      return { ok: false, reason: 'region_not_found' };
    }
    const scoped = scopedProjectIds(body.scoped_teams);
    const named = region.projects.filter(project => scoped.length === 0 || (project.id !== undefined && scoped.includes(project.id)));
    // One project chosen at consent, or one project in reach at all: either way there is nothing to pick.
    const onlyProjectInReach = named.length === 1 && named[0]?.id !== undefined ? String(named[0].id) : null;
    const projectId = scoped.length === 1 ? String(scoped[0]) : onlyProjectInReach;
    const hostname = new URL(region.host).hostname;
    const account = named.length === 1 && named[0]?.name ? `${named[0].name} (${hostname})` : hostname;
    return {
      ok: true,
      credentials: {
        accessToken,
        refreshToken,
        expiresAt: grantExpiresAt(body.expires_in, POSTHOG_ACCESS_TOKEN_SECONDS),
        scope: typeof body.scope === 'string' ? body.scope : POSTHOG_LOGIN_SCOPES.join(' '),
        host: region.host,
        ...(projectId ? { projectId } : {}),
        account,
      },
      displayName: `PostHog — ${account}`,
    };
  },

  summarize(credentials) {
    if (typeof credentials.account !== 'string' || !credentials.account || typeof credentials.refreshToken !== 'string' || !credentials.refreshToken) {
      return null;
    }
    return { account: credentials.account };
  },
};
