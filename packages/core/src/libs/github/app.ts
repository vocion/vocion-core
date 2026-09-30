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
 */

import { Buffer } from 'node:buffer';
import { createSign } from 'node:crypto';
import process from 'node:process';
import { GITHUB_API_URL } from './client';

/** The env vars the app needs. Read late so a test can set them. */
export const GITHUB_APP_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_BASE64'] as const;

export type GithubAppConfig = {
  appId: string;
  slug: string;
  /** The PEM, decoded. */
  privateKey: string;
};

/** The app as the environment describes it, or null when any part is missing. */
export function githubAppConfig(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const keyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  if (!appId || !slug || !keyBase64) {
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
  return { appId, slug, privateKey };
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
export function appJwt(config: GithubAppConfig | null = githubAppConfig(), now: number = Math.floor(Date.now() / 1000)): string {
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

/** Installation token cache, keyed by installation id. */
const tokenCache = new Map<string, CachedToken>();

/** Forget every minted token. For tests. */
export function clearInstallationTokenCache(): void {
  tokenCache.clear();
}

/** How long before GitHub's expiry a cached token stops being reused. */
const REFRESH_MARGIN_MS = 5 * 60_000;

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
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) {
    return cached.token;
  }
  const config = githubAppConfig();
  const jwt = appJwt(config, Math.floor(now / 1000));
  const baseUrl = (opts?.baseUrl ?? GITHUB_API_URL).replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${jwt}`,
      'accept': 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'vocion-github-app',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub refused to mint a token for installation ${installationId} (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (typeof body.token !== 'string' || body.token === '') {
    throw new Error(`GitHub answered without a token for installation ${installationId}.`);
  }
  const expiresAt = body.expires_at ? Date.parse(body.expires_at) : now + 60 * 60_000;
  tokenCache.set(installationId, { token: body.token, expiresAt: Number.isNaN(expiresAt) ? now + 60 * 60_000 : expiresAt });
  return body.token;
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
