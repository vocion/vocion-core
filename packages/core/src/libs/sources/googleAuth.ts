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
 * the raw `token` when no refresh credentials exist. Obtain refresh
 * credentials via `npm run google:oauth` (one-time consent) or the Sources UI.
 */

import type { RawCredentials } from '@/services/SourceCredentialService';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** access-token cache keyed by refresh token — refreshes are rate-limited by Google. */
const cache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Resolve a usable Google access token from stored credentials.
 * Prefers refresh-token exchange (cached until near expiry); falls back to a
 * raw `credentials.token`. Throws when neither path is available.
 * @param credentials
 */
export async function resolveGoogleAccessToken(credentials: RawCredentials | undefined): Promise<string> {
  const refreshToken = credentials?.refreshToken as string | undefined;
  const clientId = credentials?.clientId as string | undefined;
  const clientSecret = credentials?.clientSecret as string | undefined;

  if (refreshToken && clientId && clientSecret) {
    const cached = cache.get(refreshToken);
    if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
      return cached.token;
    }
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google token refresh failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number };
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
