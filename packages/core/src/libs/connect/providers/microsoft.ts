/**
 * "Log in with Microsoft" for the Microsoft 365 connectors: Outlook mail,
 * Outlook Calendar, Teams, SharePoint and OneDrive. OAuth 2.0 authorization
 * code against the Microsoft identity platform (v2), delegated: the login
 * acts as the person who logged in, inside their own work or school tenant.
 *
 * One app serves all five connectors, the same multi-tenant Entra app the
 * deployment signs people in with (`AUTH_MICROSOFT_ENTRA_ID_ID` /
 * `AUTH_MICROSOFT_ENTRA_ID_SECRET`), or the workspace's own Microsoft login
 * app when it saved one (`libs/connect/loginClient.ts`). Each login asks only
 * for the connector it was started from (least privilege, as Google's does):
 * an Outlook login cannot read Teams, and only a Teams login asks for
 * `ChannelMessage.Read.All`, the one scope here that needs an admin's consent.
 *
 * Microsoft rotates refresh tokens, so a refresh goes through
 * `usableLoginGrant`, which saves the new one compare-and-swap. A refresh asks
 * for `https://graph.microsoft.com/.default`: a refresh token is valid for
 * every permission the person has consented to, so the access token it mints
 * carries all of them, and one login row serves every connector logged in for
 * so far. The login runs one such refresh straight after the code exchange,
 * so the stored `scope` already names everything consented before.
 */

import type { RefreshedTokens } from '../loginGrant';
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { grantExpiresAt } from '../loginGrant';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

/**
 * Work and school accounts from any tenant, as sign-in uses. Teams and
 * SharePoint exist only for organizational accounts.
 */
const AUTHORITY = 'https://login.microsoftonline.com/organizations/oauth2/v2.0';
const AUTHORIZE_URL = `${AUTHORITY}/authorize`;
export const MICROSOFT_TOKEN_URL = `${AUTHORITY}/token`;
const ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,id';
const IDENTITY_TIMEOUT_MS = 15_000;
/** Microsoft access tokens live 60 to 90 minutes; used when a response omits `expires_in`. */
const DEFAULT_LIFETIME_SECONDS = 3600;
const SAFE_ERROR_CODE = /^[\w.-]{1,64}$/;
/** Who is logging in (`/me`), and a refresh token. Never a Graph scope that reads data. */
export const MICROSOFT_IDENTITY_SCOPES = ['User.Read', 'offline_access'] as const;
/** Every Graph permission the person has consented to, for a refresh. */
const REFRESH_SCOPE = 'https://graph.microsoft.com/.default offline_access';

/**
 * The Microsoft Graph delegated permissions each connector needs, without
 * the identity scopes. These are the only permissions the Entra app has to
 * list (docs/guides/microsoft-365.md). Calendar is ReadWrite because the
 * connector's one write (`outlook.create_event`) creates events; Teams
 * carries `ChannelMessage.Send` for `msteams.post_message`.
 */
export const MICROSOFT_LOGIN_SCOPES: Record<string, readonly string[]> = {
  'outlook-mail': ['Mail.Read'],
  'outlook-calendar': ['Calendars.ReadWrite'],
  'microsoft-teams': ['Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send', 'Chat.Read'],
  'sharepoint': ['Sites.Read.All'],
  'onedrive': ['Files.Read.All'],
};

/** What the person sees for each connector, for error sentences. */
const CONNECTOR_NAMES: Record<string, string> = {
  'outlook-mail': 'Outlook mail',
  'outlook-calendar': 'Outlook Calendar',
  'microsoft-teams': 'Microsoft Teams',
  'sharepoint': 'SharePoint',
  'onedrive': 'OneDrive',
};

/**
 * The Microsoft app a login or refresh runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function microsoftApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('microsoft');
}

/**
 * Granted scopes as a set of lowercase names. Microsoft answers Graph scopes
 * short (`Mail.Read`) but a client may have stored them long
 * (`https://graph.microsoft.com/Mail.Read`); both count.
 * @param scope - A space-separated scope string.
 */
export function grantedScopeSet(scope: string): Set<string> {
  return new Set(scope.split(/\s+/).filter(Boolean).map(s => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()));
}

/**
 * Turn a token response into the tokens a grant keeps. A response with no
 * refresh token keeps the one that was sent.
 * @param body - The parsed token response.
 * @param sentRefreshToken - The refresh token the request used; null on the code exchange.
 * @param now - Injected for tests.
 */
function tokensFrom(body: Record<string, unknown>, sentRefreshToken: string | null, now: number = Date.now()): RefreshedTokens {
  const accessToken = body.access_token;
  const returnedRefresh = body.refresh_token;
  const refreshToken = typeof returnedRefresh === 'string' && returnedRefresh ? returnedRefresh : sentRefreshToken;
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken) {
    throw new TokenRequestError('Microsoft', 'no_token', null);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: grantExpiresAt(body.expires_in, DEFAULT_LIFETIME_SECONDS, now),
    ...(typeof body.scope === 'string' && body.scope ? { scope: body.scope } : {}),
  };
}

/**
 * Mint a new Microsoft Graph access token from a refresh token, for every
 * permission consented so far, and the rotated refresh token with it.
 * @param refreshToken - The stored refresh token.
 * @param client - The app the login was issued to.
 * @throws {TokenRequestError} TokenRequestError when Microsoft refuses or cannot be reached, or no app is configured.
 */
export async function refreshMicrosoftGrant(refreshToken: string, client?: LoginClient): Promise<RefreshedTokens> {
  const app = microsoftApp(client);
  if (!app) {
    throw new TokenRequestError('Microsoft', 'not_configured', null);
  }
  const body = await postTokenRequest({
    vendor: 'Microsoft',
    url: MICROSOFT_TOKEN_URL,
    encoding: 'form',
    params: { grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, scope: REFRESH_SCOPE },
  });
  return tokensFrom(body, refreshToken);
}

/**
 * Who a fresh access token belongs to: their sign-in name (an email-shaped
 * user principal name) and display name. Null when Graph would not say; the
 * login then fails rather than store a grant nobody can recognise.
 * @param accessToken - The access token just issued.
 */
async function lookUpIdentity(accessToken: string): Promise<{ account: string; displayName: string | null; userId: string | null } | null> {
  try {
    const response = await fetch(ME_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('microsoft login could not read /me', { status: response.status });
      return null;
    }
    const me = await response.json() as Record<string, unknown>;
    const upn = typeof me.userPrincipalName === 'string' && me.userPrincipalName ? me.userPrincipalName : null;
    const mail = typeof me.mail === 'string' && me.mail ? me.mail : null;
    const account = mail ?? upn;
    if (!account) {
      return null;
    }
    return {
      account,
      displayName: typeof me.displayName === 'string' && me.displayName ? me.displayName : null,
      userId: typeof me.id === 'string' && me.id ? me.id : null,
    };
  } catch (error) {
    logger.warn('microsoft login could not read /me', { errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

/**
 * The tokens to store: the code's own, widened by one refresh to every
 * permission consented so far, so the stored `scope` says what this login can
 * really read. A refused widening keeps the code's tokens, which are good.
 * @param tokens - What the code exchange returned.
 * @param app - The app the login ran on.
 */
async function widenedToConsent(tokens: RefreshedTokens, app: LoginClient): Promise<RefreshedTokens> {
  try {
    const widened = await refreshMicrosoftGrant(tokens.refreshToken, app);
    return { ...widened, scope: widened.scope ?? tokens.scope };
  } catch (error) {
    logger.warn('microsoft login could not widen the new grant to its consented scopes', { code: error instanceof TokenRequestError ? error.code : null });
    return tokens;
  }
}

export const microsoftProvider: ConnectProvider = {
  id: 'microsoft',
  connectorSlugs: Object.keys(MICROSOFT_LOGIN_SCOPES),
  label: 'Microsoft',
  requiredEnv: ['AUTH_MICROSOFT_ENTRA_ID_ID', 'AUTH_MICROSOFT_ENTRA_ID_SECRET'],
  configured: () => microsoftApp() !== null,

  authorizeUrl({ state, redirectUri, connector, client: chosen }) {
    const app = microsoftApp(chosen);
    if (!app) {
      // The start route checks `configured()` first; this is the backstop.
      throw new Error('Microsoft OAuth is not configured. Set AUTH_MICROSOFT_ENTRA_ID_ID and AUTH_MICROSOFT_ENTRA_ID_SECRET, or save a Microsoft login app on the Developers page.');
    }
    const vendorScopes = MICROSOFT_LOGIN_SCOPES[connector];
    if (!vendorScopes) {
      throw new Error(`Microsoft login does not serve the "${connector}" connector.`);
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', [...vendorScopes, ...MICROSOFT_IDENTITY_SCOPES].join(' '));
    url.searchParams.set('state', state);
    // Pick the account on purpose: the browser is often signed in to Vocion
    // with the same Microsoft account, and a silent login would hide which.
    url.searchParams.set('prompt', 'select_account');
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
    const app = microsoftApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    let tokens: RefreshedTokens;
    try {
      const body = await postTokenRequest({
        vendor: 'Microsoft',
        url: MICROSOFT_TOKEN_URL,
        encoding: 'form',
        params: { grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code },
      });
      tokens = tokensFrom(body, null);
    } catch (error) {
      logger.warn('microsoft login token exchange failed', { errorName: error instanceof Error ? error.name : 'unknown' });
      return { ok: false, reason: error instanceof TokenRequestError ? error.code : 'token_exchange_failed' };
    }
    const identity = await lookUpIdentity(tokens.accessToken);
    if (!identity) {
      return { ok: false, reason: 'no_account' };
    }
    const stored = await widenedToConsent(tokens, app);
    return {
      ok: true,
      credentials: {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: stored.expiresAt,
        scope: stored.scope ?? '',
        account: identity.account,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        ...(identity.userId ? { userId: identity.userId } : {}),
      },
      displayName: `Microsoft — ${identity.account}`,
    };
  },

  summarize: (credentials) => {
    const account = typeof credentials.account === 'string' ? credentials.account.trim() : '';
    if (!account || typeof credentials.refreshToken !== 'string' || !credentials.refreshToken) {
      return null;
    }
    return { account };
  },

  missingAccessFor: (credentials, connectorSlug) => {
    const required = MICROSOFT_LOGIN_SCOPES[connectorSlug];
    if (!required || typeof credentials.scope !== 'string') {
      return null;
    }
    const granted = grantedScopeSet(credentials.scope);
    if (required.every(scope => granted.has(scope.toLowerCase()))) {
      return null;
    }
    return `This Microsoft login doesn't include ${CONNECTOR_NAMES[connectorSlug] ?? connectorSlug}. Press Replace and log in with Microsoft again to add it.`;
  },
};
