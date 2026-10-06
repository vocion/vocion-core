/**
 * Google OAuth token resolution for the Google-family connectors + actions
 * (gmail, drive, ga4, googleAds, gmail.send).
 *
 * Google access tokens expire in ~1h, so a pasted `credentials.token` dies
 * after the first sync window. Durable credentials store a REFRESH token plus
 * the OAuth client pair:
 *
 *   { refreshToken, clientId, clientSecret }         ← durable (preferred)
 *   { token }                                        ← raw access token (legacy/stopgap)
 *
 * `resolveGoogleAccessToken` mints a fresh access token from the refresh
 * token (caching it in-memory until ~5 min before expiry) and falls back to
 * the raw `token` when no refresh credentials exist.
 *
 * The durable set is what the Sources UI asks for: the `google` credential
 * platform holds `clientId`, `clientSecret` and `refreshToken`, and one such
 * credential serves every Google connector, since a single OAuth consent
 * covers them all. `npm run google:oauth` runs the same consent from a
 * terminal, though it still writes the older per-source credential rather than
 * a workspace one.
 */

import type { RawCredentials } from '@/services/SourceCredentialService';
import { loginClientForGrant } from '@/libs/connect/loginClient';
import { postTokenRequest, refusalFix, TokenRequestError } from '@/libs/connect/tokenRequest';
import { logger } from '@/libs/Logger';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** access-token cache keyed by refresh token — refreshes are rate-limited by Google. */
const cache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Where the OAuth client a refresh runs on came from: pasted with the token,
 * the workspace's Google login app, or the server's env. Each is fixed in a
 * different place, so each refusal names its own.
 */
type ClientSource = 'pasted' | 'workspace' | 'server';

/**
 * The sentence a refused Google refresh ends with, naming the one fix. A
 * login was issued to the workspace's login app or the server's OAuth client,
 * so a refused client is an admin's to fix where that client lives; a pasted
 * credential is fixed by pasting it again. Worded for a sync and a chat tool
 * alike, since both refresh through here.
 * @param error - What the token request threw.
 * @param source - Where the client the refresh ran on came from.
 */
function refreshRefusal(error: TokenRequestError, source: ClientSource): Error {
  const fix = refusalFix(error);
  if (error.code === 'login_app_changed') {
    return new Error('This Google login was made with a Google login app this workspace no longer has, so it cannot be refreshed. An admin needs to log in with Google again on the Connectors page.');
  }
  if (error.code === 'not_configured') {
    return new Error('This Google login needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET set on the server to refresh. Set them, or paste a client id, secret and refresh token instead.');
  }
  if (fix === 'try-later') {
    return new Error(`Google could not refresh the access token just now (${error.code}). Try again in a few minutes.`);
  }
  if (fix === 'check-server-client' && source === 'pasted') {
    return new Error(`Google refused the pasted OAuth client (${error.code}). An admin needs to paste the client ID and secret again, or log in with Google, on the Connectors page.`);
  }
  if (fix === 'check-server-client' && source === 'workspace') {
    return new Error(`Google refused this workspace's Google login app (${error.code}), so logging in again will not help. An admin needs to check its client ID and secret on the Developers page.`);
  }
  if (fix === 'check-server-client') {
    return new Error(`Google refused this server's OAuth client (${error.code}), so logging in again will not help. An admin needs to check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on the server.`);
  }
  return new Error(source === 'pasted'
    ? `Google refused the pasted refresh token (${error.code}). An admin needs to paste a new one, or log in with Google, on the Connectors page.`
    : `Google would not refresh the login (${error.code}). An admin needs to log in with Google again on the Connectors page.`);
}

/**
 * Mint an access token from a refresh token, through the token request every
 * login shares (15 second timeout, only Google's short error code kept).
 * A refusal becomes a sentence that names the fix (see `refreshRefusal`).
 * Google refuses a refresh token that was revoked, unused for six months, or
 * issued by an OAuth app still in "Testing" more than 7 days ago.
 * @param input - The refresh token and the OAuth client it was issued to.
 * @param input.refreshToken - The stored refresh token.
 * @param input.clientId - The OAuth client id.
 * @param input.clientSecret - The OAuth client secret.
 * @param input.source - Where the client came from, for the refusal's sentence.
 */
async function refreshAccessToken(input: { refreshToken: string; clientId: string; clientSecret: string; source: ClientSource }): Promise<{ access_token: string; expires_in?: number }> {
  let body: Record<string, unknown>;
  try {
    body = await postTokenRequest({
      vendor: 'Google',
      url: TOKEN_ENDPOINT,
      params: { grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret },
      encoding: 'form',
    });
  } catch (error) {
    if (!(error instanceof TokenRequestError)) {
      throw error;
    }
    logger.warn('resolveGoogleAccessToken: Google refused or did not answer the refresh', { code: error.code, source: input.source });
    throw refreshRefusal(error, input.source);
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('Google answered the token refresh without an access token. Try again in a few minutes.');
  }
  return { access_token: body.access_token, expires_in: typeof body.expires_in === 'number' ? body.expires_in : undefined };
}

/**
 * The OAuth client a "Log in with Google" login refreshes with: the app it
 * was issued to (`loginClientForGrant`), as a refusal sentence when that app
 * is gone.
 * @param orgId - The workspace the login belongs to.
 * @param credentials - The login's bag, which records its app's client ID.
 */
async function loginClientOf(orgId: string, credentials: RawCredentials | undefined): Promise<{ clientId: string; clientSecret: string; source: ClientSource }> {
  try {
    const client = await loginClientForGrant({ orgId, provider: 'google', vendor: 'Google', loginClientId: credentials?.loginClientId });
    return { clientId: client.clientId, clientSecret: client.clientSecret, source: client.owner };
  } catch (error) {
    if (error instanceof TokenRequestError) {
      throw refreshRefusal(error, 'server');
    }
    throw error;
  }
}

/**
 * Resolve a usable Google access token from stored credentials.
 * Prefers refresh-token exchange (cached until near expiry); falls back to a
 * raw `credentials.token`. Throws when neither path is available.
 * @param credentials - The stored bag: a login, a pasted client with its refresh token, or a raw token.
 * @param orgId - The workspace the credential belongs to, to find the login app a login was made with.
 */
export async function resolveGoogleAccessToken(credentials: RawCredentials | undefined, orgId: string): Promise<string> {
  const refreshToken = credentials?.refreshToken as string | undefined;
  const pastedClientId = credentials?.clientId as string | undefined;
  const pastedClientSecret = credentials?.clientSecret as string | undefined;
  // Half a pasted client is a paste gone wrong, not a login: its refresh token
  // was minted for that client, and this deployment's would be refused.
  if (Boolean(pastedClientId) !== Boolean(pastedClientSecret)) {
    throw new Error('This Google credential has only half of its OAuth client. Paste both the client ID and the client secret with the refresh token.');
  }
  if (refreshToken) {
    const cached = cache.get(refreshToken);
    if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
      return cached.token;
    }
    // A pasted bag carries its own client. A "Log in with Google" bag does
    // not: it was issued to the workspace's login app or the server's.
    const client = pastedClientId && pastedClientSecret
      ? { clientId: pastedClientId, clientSecret: pastedClientSecret, source: 'pasted' as const }
      : await loginClientOf(orgId, credentials);
    const data = await refreshAccessToken({ refreshToken, ...client });
    cache.set(refreshToken, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  }
  const raw = credentials?.token as string | undefined;
  if (raw) {
    return raw;
  }
  throw new Error(
    'Google credentials missing — store either { refreshToken, clientId, clientSecret } '
    + '(durable; run `npm run google:oauth`) or a short-lived { token }.',
  );
}
