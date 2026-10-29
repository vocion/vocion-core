/**
 * The GitHub App this deployment is: how it proves it is itself (an RS256
 * JWT over the app id) and how it acts for one installation (an installation
 * token, minted for an hour and never stored).
 *
 * A workspace connects GitHub by installing the app on its organization and
 * choosing repositories; the installation id is the credential. Every call
 * on its behalf then goes: app JWT → `POST /app/installations/{id}/access_tokens`
 * → `ghs_…` token, sent as Bearer like a pasted token would be. The token is
 * cached in memory until five minutes before GitHub expires it, so a poll
 * that walks ten repositories mints once, not ten times.
 *
 * The private key arrives base64-encoded in `GITHUB_APP_PRIVATE_KEY_BASE64`
 * because a PEM has newlines and every env store mangles those differently.
 * It is decoded once, held in module memory, and never logged.
 *
 * A deployment that switched GitHub Apps can name the previous one in
 * `GITHUB_LEGACY_APP_*`. It is used for one thing: minting tokens for an
 * installation the current app answers 404 for, so workspaces connected
 * through the old app keep syncing until each account installs the new one.
 * Never for new installs, the connect flow, OAuth or webhooks.
 */

import { Buffer } from 'node:buffer';
import { createSign } from 'node:crypto';
import process from 'node:process';

/**
 * The env vars the app needs. Read late so a test can set them. The OAuth
 * client pair is what lets the connect callback prove the person completing
 * it can see the installation they name ("Request user authorization during
 * installation" on the app): without it, any installation id would do.
 */
export const GITHUB_APP_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_BASE64', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'] as const;

export type GithubAppConfig = {
  appId: string;
  slug: string;
  /** The PEM, decoded. */
  privateKey: string;
  clientId: string;
  clientSecret: string;
};

/** The app as the environment describes it, or null when any part is missing. */
export function githubAppConfig(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const keyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!appId || !slug || !keyBase64 || !clientId || !clientSecret) {
    return null;
  }
  let privateKey: string;
  try {
    privateKey = Buffer.from(keyBase64, 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (!privateKey.includes('PRIVATE KEY')) {
    return null;
  }
  return { appId, slug, privateKey, clientId, clientSecret };
}

/**
 * The previous GitHub App, kept only to mint tokens for installations made
 * before the deployment switched apps. `GITHUB_LEGACY_APP_SLUG` is for
 * display. Optional: absent means there is no legacy app.
 */
export const GITHUB_LEGACY_APP_ENV = ['GITHUB_LEGACY_APP_ID', 'GITHUB_LEGACY_APP_PRIVATE_KEY_BASE64'] as const;

export type GithubLegacyAppConfig = Pick<GithubAppConfig, 'appId' | 'privateKey'> & { slug?: string };

/** The legacy app as the environment describes it, or null when it is not set (or its key is not a PEM). */
export function githubLegacyAppConfig(): GithubLegacyAppConfig | null {
  const appId = process.env.GITHUB_LEGACY_APP_ID?.trim();
  const keyBase64 = process.env.GITHUB_LEGACY_APP_PRIVATE_KEY_BASE64?.trim();
  if (!appId || !keyBase64) {
    return null;
  }
  const privateKey = Buffer.from(keyBase64, 'base64').toString('utf8');
  if (!privateKey.includes('PRIVATE KEY')) {
    return null;
  }
  const slug = process.env.GITHUB_LEGACY_APP_SLUG?.trim() || undefined;
  return { appId, privateKey, slug };
}

/** Whether the deployment can act as a GitHub App at all. */
export function appConfigured(): boolean {
  return githubAppConfig() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * A JWT that authenticates the app itself, good for nine minutes. GitHub
 * allows ten; the minute of clock skew on `iat` is what it recommends.
 * @param config - The app; defaults to the environment's.
 * @param now - Unix seconds, for tests.
 */
export function appJwt(config: Pick<GithubAppConfig, 'appId' | 'privateKey'> | null = githubAppConfig(), now: number = Math.floor(Date.now() / 1000)): string {
  if (!config) {
    throw new Error(`GitHub App is not configured: set ${GITHUB_APP_ENV.join(', ')}.`);
  }
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = base64url(signer.sign(config.privateKey));
  return `${header}.${payload}.${signature}`;
}

type CachedToken = { token: string; expiresAt: number };

/** Installation token cache, keyed by API host and installation id: an Enterprise host mints its own. */
const tokenCache = new Map<string, CachedToken>();

/**
 * Installations the legacy app answered for, keyed like `tokenCache`, with
 * the account when it could be read. Process lifetime, never persisted: the
 * first mint after a restart tries the current app again.
 */
const legacyInstallations = new Map<string, { account?: string }>();

/** Forget every minted token and which app owns which installation. For tests. */
export function clearInstallationTokenCache(): void {
  tokenCache.clear();
  legacyInstallations.clear();
}

/** How long before GitHub's expiry a cached token stops being reused. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/** Same host `client.ts` defaults to; spelled here so the two modules need not import each other. */
const DEFAULT_API_URL = 'https://api.github.com';

/**
 * A token that acts for one installation, minted from the app JWT and cached
 * until five minutes before it expires. Throws when the app is not configured
 * or GitHub refuses the mint; the message never carries the JWT or the token.
 * @param installationId - The installation, as GitHub numbers it.
 * @param opts - Overrides for tests: the API host and the clock.
 * @param opts.baseUrl - API host.
 * @param opts.now - Milliseconds since the epoch.
 */
export async function installationToken(installationId: string, opts?: { baseUrl?: string; now?: number }): Promise<string> {
  const now = opts?.now ?? Date.now();
  const baseUrl = (opts?.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const cacheKey = `${baseUrl}|${installationId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) {
    return cached.token;
  }
  const nowSeconds = Math.floor(now / 1000);
  const legacy = githubLegacyAppConfig();
  if (!legacy || !legacyInstallations.has(cacheKey)) {
    const res = await mintRequest(baseUrl, installationId, appJwt(githubAppConfig(), nowSeconds));
    // Only a 404 means "not this app's installation"; anything else is the
    // current app's answer and stands.
    if (res.ok || res.status !== 404 || !legacy) {
      return acceptMint(res, installationId, cacheKey, now);
    }
    const legacyRes = await mintRequest(baseUrl, installationId, appJwt(legacy, nowSeconds));
    if (!legacyRes.ok) {
      // Neither app owns it: report what the current app said.
      return acceptMint(res, installationId, cacheKey, now);
    }
    const token = await acceptMint(legacyRes, installationId, cacheKey, now);
    await noteLegacyInstallation(baseUrl, installationId, cacheKey, legacy, nowSeconds);
    return token;
  }
  const res = await mintRequest(baseUrl, installationId, appJwt(legacy, nowSeconds));
  if (!res.ok) {
    // Ask the current app first again next time: the account may have moved.
    legacyInstallations.delete(cacheKey);
  }
  return acceptMint(res, installationId, cacheKey, now);
}

function mintRequest(baseUrl: string, installationId: string, jwt: string): Promise<Response> {
  return fetch(`${baseUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${jwt}`,
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'vocion-github-app',
    },
  });
}

async function acceptMint(res: Response, installationId: string, cacheKey: string, now: number): Promise<string> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub refused to mint a token for installation ${installationId} (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (typeof body.token !== 'string' || body.token === '') {
    throw new Error(`GitHub answered without a token for installation ${installationId}.`);
  }
  const expiresAt = body.expires_at ? Date.parse(body.expires_at) : now + 60 * 60_000;
  tokenCache.set(cacheKey, { token: body.token, expiresAt: Number.isNaN(expiresAt) ? now + 60 * 60_000 : expiresAt });
  return body.token;
}

/**
 * Remember that the legacy app serves this installation, read its account
 * (best effort) and log it once per process.
 * @param baseUrl - API host.
 * @param installationId - The installation.
 * @param cacheKey - Its `tokenCache` key.
 * @param legacy - The legacy app.
 * @param nowSeconds - Unix seconds, for the JWT.
 */
async function noteLegacyInstallation(baseUrl: string, installationId: string, cacheKey: string, legacy: GithubLegacyAppConfig, nowSeconds: number): Promise<void> {
  let account: string | undefined;
  try {
    const res = await fetch(`${baseUrl}/app/installations/${encodeURIComponent(installationId)}`, {
      headers: { 'authorization': `Bearer ${appJwt(legacy, nowSeconds)}`, 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion-github-app' },
    });
    if (res.ok) {
      const body = (await res.json()) as { account?: { login?: string } | null };
      account = body.account?.login || undefined;
    }
  } catch {
    // The account only makes the log line friendlier.
  }
  legacyInstallations.set(cacheKey, { account });
  const message = `installation ${installationId} served by the legacy GitHub App; reinstall the current app on ${account ?? 'its account'} to retire it`;
  try {
    const { logger } = await import('@/libs/Logger');
    logger.info(message, { installationId, account, legacyApp: legacy.slug ?? legacy.appId });
  } catch {
    // Logging never costs a sync its token.
  }
}

/**
 * When the legacy app is what serves this installation in this process, a
 * short note saying so (for Test connection); null otherwise.
 * @param installationId - The installation, as GitHub numbers it.
 * @param baseUrl - API host; defaults to github.com.
 */
export function legacyInstallationNote(installationId: string, baseUrl?: string): string | null {
  const entry = legacyInstallations.get(`${(baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')}|${installationId}`);
  if (!entry) {
    return null;
  }
  const slug = githubLegacyAppConfig()?.slug;
  const app = slug ? `the earlier GitHub App (${slug})` : 'the earlier GitHub App';
  return `This connection is an installation of ${app}. It keeps working; reinstall the current app on ${entry.account ?? 'the account'} to retire it.`;
}

/**
 * What the credential bag holds when the credential is an installation
 * rather than a pasted token.
 */
export type GithubInstallationCredentials = {
  installationId: string;
  account?: string;
  accountType?: string;
  repositories?: string[];
  permissions?: Record<string, string>;
};

/**
 * The installation id in a credential bag, when it is one.
 * @param credentials - The decrypted bag.
 */
export function installationIdFrom(credentials?: Record<string, unknown>): string | undefined {
  const id = credentials?.installationId;
  if (typeof id === 'string' && id.trim() !== '') {
    return id.trim();
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id);
  }
  return undefined;
}
