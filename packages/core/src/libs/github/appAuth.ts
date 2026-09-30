/**
 * GITHUB APP AUTH (backlog 053) — the two steps between the deployment's
 * GitHub App and a token that can act on one repository:
 *
 *   1. `appJwt` — a ten-minute JWT signed RS256 with the app's private key,
 *      which authenticates as the APP (list installations, mint tokens).
 *   2. `mintInstallationToken` — POST /app/installations/{id}/access_tokens
 *      with that JWT: an installation token (`ghs_…`) that lives an hour,
 *      scoped to the repositories and permissions asked for, never more than
 *      the installation was granted.
 *
 * Pure: no database, no vault, `fetch` injectable. The service
 * (`services/github/GithubAppService`) holds the key and the cache.
 *
 * Why an app and not a person's token: every re-run, branch update and merge
 * made with a personal OAuth token acts AS that person, with every scope they
 * hold. An installation token acts as the app, on the repositories an org
 * owner chose, with the permissions this workspace's tier asks for.
 */

import { Buffer } from 'node:buffer';
import { createSign } from 'node:crypto';
import { GITHUB_API_URL, splitRepo } from './client';

/** A permission map as GitHub spells it: `{ contents: 'write', checks: 'read' }`. */
export type GithubPermissions = Record<string, 'read' | 'write' | 'admin'>;

/**
 * What a workspace mints at. `base` does the factory's everyday work: read
 * the code and its checks, push a branch, open, update and merge a pull
 * request, re-run a failed job. `pipeline` adds `workflows: write`, which is
 * what changing `.github/workflows` needs, and only a workspace that turned on
 * "the Release engineer may change CI and deploy config" mints it.
 */
export const GITHUB_TIERS = ['base', 'pipeline'] as const;
export type GithubTier = (typeof GITHUB_TIERS)[number];

const BASE_PERMISSIONS: GithubPermissions = {
  metadata: 'read',
  contents: 'write',
  pull_requests: 'write',
  actions: 'write',
  checks: 'read',
};

/**
 * The permissions a token is minted with at a tier.
 * @param tier - The workspace's tier.
 */
export function permissionsForTier(tier: GithubTier): GithubPermissions {
  return tier === 'pipeline' ? { ...BASE_PERMISSIONS, workflows: 'write' } : { ...BASE_PERMISSIONS };
}

/**
 * The permissions the app itself asks for when it is created: the widest tier,
 * so an installation grants it once and a workspace moves between tiers
 * without sending anyone back to GitHub. What a token can do is still only
 * what its tier asks for at mint time.
 */
export const APP_PERMISSIONS: GithubPermissions = permissionsForTier('pipeline');

/** The deliveries the app subscribes to; `installation*` always arrive. */
export const APP_EVENTS = ['pull_request', 'pull_request_review', 'check_suite', 'check_run', 'workflow_run'] as const;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * A JWT that authenticates as the app. Issued a minute in the past (GitHub
 * allows for clock drift that way) and expiring nine minutes on, inside
 * GitHub's ten-minute ceiling.
 * @param input - The app.
 * @param input.appId - The app's numeric id (GitHub also accepts the client id as `iss`).
 * @param input.privateKey - The PEM GitHub returned when the app was created.
 * @param input.now - Seconds since the epoch; for tests.
 */
export function appJwt(input: { appId: number | string; privateKey: string; now?: number }): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(input.appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(input.privateKey).toString('base64url')}`;
}

export type InstallationToken = {
  token: string;
  expiresAt: Date;
  permissions: GithubPermissions;
  /** `owner/name` of each repository the token covers, when GitHub listed them. */
  repositories: string[];
};

export type MintFailure = {
  ok: false;
  status: number;
  /** GitHub's own words, for the person reading why a connection is not working. */
  message: string;
  /** 422 on a permission the installation was never granted: an upgrade, not a retry. */
  needsUpgrade: boolean;
};

export type MintResult = ({ ok: true } & InstallationToken) | MintFailure;

const headers = (bearer: string) => ({
  'authorization': `Bearer ${bearer}`,
  'accept': 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'vocion-github-app',
});

/**
 * An installation token, scoped down to what the caller needs.
 * @param input - Who is asking and for what.
 * @param input.appId - The app's id.
 * @param input.privateKey - The app's PEM.
 * @param input.installationId - The installation to act through.
 * @param input.permissions - The permissions to ask for; the installation's whole grant when omitted.
 * @param input.repositories - Repository NAMES (no owner) to scope the token to; every repository the installation covers when omitted.
 * @param input.baseUrl - API host, for GitHub Enterprise Server or a test double.
 * @param input.fetchImpl - Injected for tests.
 */
export async function mintInstallationToken(input: {
  appId: number | string;
  privateKey: string;
  installationId: number;
  permissions?: GithubPermissions;
  repositories?: string[];
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<MintResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const base = (input.baseUrl ?? GITHUB_API_URL).replace(/\/+$/, '');
  const body: Record<string, unknown> = {};
  if (input.permissions) {
    body.permissions = input.permissions;
  }
  if (input.repositories && input.repositories.length > 0) {
    body.repositories = input.repositories;
  }
  let res: Response;
  try {
    res = await doFetch(`${base}/app/installations/${input.installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...headers(appJwt({ appId: input.appId, privateKey: input.privateKey })), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, status: 0, message: `GitHub could not be reached: ${(err as Error).message}`, needsUpgrade: false };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {}
    return { ok: false, status: res.status, message: `GitHub refused an installation token (${res.status}): ${message}`, needsUpgrade: res.status === 422 };
  }
  const data = JSON.parse(text) as { token: string; expires_at: string; permissions?: GithubPermissions; repositories?: Array<{ full_name?: string }> };
  return {
    ok: true,
    token: data.token,
    expiresAt: new Date(data.expires_at),
    permissions: data.permissions ?? {},
    repositories: (data.repositories ?? []).map(r => r.full_name ?? '').filter(Boolean),
  };
}

/**
 * Read one installation as the app: which account it is on, which
 * repositories it covers (`all` or `selected`) and what was granted.
 * @param input - The app and the installation.
 * @param input.appId - The app's id.
 * @param input.privateKey - The app's PEM.
 * @param input.installationId - The installation.
 * @param input.baseUrl - API host override.
 * @param input.fetchImpl - Injected for tests.
 */
export async function readInstallation(input: { appId: number | string; privateKey: string; installationId: number; baseUrl?: string; fetchImpl?: typeof fetch }): Promise<
  { ok: true; accountLogin: string; accountType: string | null; repositorySelection: string; permissions: GithubPermissions; suspended: boolean } | { ok: false; status: number; message: string }
> {
  const doFetch = input.fetchImpl ?? fetch;
  const base = (input.baseUrl ?? GITHUB_API_URL).replace(/\/+$/, '');
  const res = await doFetch(`${base}/app/installations/${input.installationId}`, {
    headers: headers(appJwt({ appId: input.appId, privateKey: input.privateKey })),
    signal: AbortSignal.timeout(15_000),
  }).catch((err: Error) => ({ ok: false, status: 0, text: async () => err.message }) as unknown as Response);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, status: res.status, message: `GitHub answered ${res.status} for installation ${input.installationId}: ${text.slice(0, 200)}` };
  }
  const data = JSON.parse(text) as { account?: { login?: string; type?: string }; repository_selection?: string; permissions?: GithubPermissions; suspended_at?: string | null };
  return {
    ok: true,
    accountLogin: data.account?.login ?? '',
    accountType: data.account?.type ?? null,
    repositorySelection: data.repository_selection ?? 'selected',
    permissions: data.permissions ?? {},
    suspended: Boolean(data.suspended_at),
  };
}

/**
 * The repositories an installation token can see (`GET /installation/repositories`), up to 1,000.
 * @param token - An installation token.
 * @param opts - Overrides.
 * @param opts.baseUrl - API host override.
 * @param opts.fetchImpl - Injected for tests.
 */
export async function listInstallationRepos(token: string, opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): Promise<string[] | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? GITHUB_API_URL).replace(/\/+$/, '');
  const repos: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await doFetch(`${base}/installation/repositories?per_page=100&page=${page}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) {
      return page === 1 ? null : repos;
    }
    const data = await res.json() as { repositories?: Array<{ full_name?: string }>; total_count?: number };
    const batch = (data.repositories ?? []).map(r => r.full_name ?? '').filter(Boolean);
    repos.push(...batch);
    if (batch.length < 100 || (data.total_count !== undefined && repos.length >= data.total_count)) {
      break;
    }
  }
  return repos;
}

/**
 * Whether an installation covers a repository: same account, and either every
 * repository of it or this one among those chosen.
 * @param row - The installation.
 * @param row.accountLogin
 * @param row.repositorySelection
 * @param row.repos
 * @param fullName - `owner/name`.
 */
export function installationCovers(row: { accountLogin: string; repositorySelection: string; repos: string[] | null }, fullName: string): boolean {
  const parts = splitRepo(fullName);
  if (!parts || parts.owner.toLowerCase() !== row.accountLogin.toLowerCase()) {
    return false;
  }
  if (row.repositorySelection === 'all') {
    return true;
  }
  const wanted = fullName.toLowerCase();
  return (row.repos ?? []).some(r => r.toLowerCase() === wanted);
}
