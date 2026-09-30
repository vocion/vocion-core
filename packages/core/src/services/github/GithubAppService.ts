/**
 * THE GITHUB APP, HELD AND USED (backlog 053).
 *
 * One app per deployment (`github_app`), created from Connections by GitHub's
 * manifest flow; its private key, webhook secret and client secret are one
 * vault-encrypted blob under the deployment's own DEK. Each workspace that
 * connects GitHub holds an installation of it (`github_installation`): the
 * account, the repositories its owner chose, and the tier it mints at.
 *
 * `installationTokenForRepo` is what `tokenForRepo` asks first: the
 * installation that covers the repository, a token minted for THAT repository
 * at the workspace's tier, cached until five minutes before it expires. A
 * workspace with no installation for the repository gets null and the caller
 * falls back to the legacy source token for as long as the cutover lasts.
 *
 * A failed mint is not silent: the installation row carries GitHub's reason
 * (`last_error`) until a mint succeeds, and Connections shows it.
 */

import type { GithubPermissions, GithubTier } from '@/libs/github/appAuth';
import { Buffer } from 'node:buffer';
import { and, desc, eq, ne } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { installationCovers, listInstallationRepos, mintInstallationToken, permissionsForTier, readInstallation } from '@/libs/github/appAuth';
import { splitRepo } from '@/libs/github/client';
import { githubAppSchema, githubInstallationSchema } from '@/models/Schema';

export { installationCovers };

/** The vault org the app's secrets are encrypted under: the deployment, not any workspace. */
export const GITHUB_APP_VAULT_ORG = 'deployment:github-app';

/** Re-mint this long before GitHub's expiry, so a token never dies mid-call. */
const REFRESH_BEFORE_MS = 5 * 60_000;

export type GithubAppRow = typeof githubAppSchema.$inferSelect;
export type GithubInstallationRow = typeof githubInstallationSchema.$inferSelect;

export type GithubAppSecrets = {
  privateKey: string;
  webhookSecret: string;
  clientSecret: string;
};

const appCache = new Map<number, GithubAppSecrets>();

/** What GitHub's manifest conversion returns, in the fields Vocion keeps. */
export type GithubAppCreated = {
  appId: number;
  slug: string;
  name: string;
  clientId: string;
  ownerLogin: string | null;
  htmlUrl: string | null;
  permissions: Record<string, string>;
  events: string[];
  secrets: GithubAppSecrets;
};

/**
 * Store a newly created app as the deployment's app. An app created earlier
 * is retired, not deleted: its installations stop minting and Connections says so.
 * @param created - The conversion's fields.
 * @param createdBy - The person who clicked Create.
 */
export async function saveApp(created: GithubAppCreated, createdBy: string | null): Promise<GithubAppRow> {
  const sealed = await buildCredentialVault().encrypt(GITHUB_APP_VAULT_ORG, Buffer.from(JSON.stringify(created.secrets), 'utf8'));
  const values = {
    appId: created.appId,
    slug: created.slug,
    name: created.name,
    clientId: created.clientId,
    ownerLogin: created.ownerLogin,
    htmlUrl: created.htmlUrl,
    permissions: created.permissions,
    events: created.events,
    secretCiphertext: sealed.ciphertext,
    secretNonce: sealed.nonce,
    secretAuthTag: sealed.authTag,
    secretDekId: sealed.dekId,
    status: 'active',
    createdBy,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(githubAppSchema)
    .values(values)
    .onConflictDoUpdate({ target: githubAppSchema.appId, set: values })
    .returning();
  await db.update(githubAppSchema).set({ status: 'retired', updatedAt: new Date() }).where(and(ne(githubAppSchema.appId, created.appId), eq(githubAppSchema.status, 'active')));
  appCache.clear();
  return row!;
}

/** The deployment's active app, or null before one is created. */
export async function activeApp(): Promise<GithubAppRow | null> {
  const [row] = await db.select().from(githubAppSchema).where(eq(githubAppSchema.status, 'active')).orderBy(desc(githubAppSchema.createdAt)).limit(1);
  return row ?? null;
}

/**
 * The app's secrets, decrypted. Held in process: the vault is the source, and
 * a retired or re-created app clears it.
 * @param app - The app row.
 */
export async function appSecrets(app: GithubAppRow): Promise<GithubAppSecrets> {
  const cached = appCache.get(app.appId);
  if (cached) {
    return cached;
  }
  const plain = await buildCredentialVault().decrypt(GITHUB_APP_VAULT_ORG, app.secretCiphertext, app.secretNonce, app.secretAuthTag, app.secretDekId);
  const secrets = JSON.parse(plain.toString('utf8')) as GithubAppSecrets;
  appCache.set(app.appId, secrets);
  return secrets;
}

/**
 * Every active installation bound to a workspace.
 * @param orgId - The workspace.
 */
export async function installationsForOrg(orgId: string): Promise<GithubInstallationRow[]> {
  return db.select().from(githubInstallationSchema).where(and(eq(githubInstallationSchema.orgId, orgId), eq(githubInstallationSchema.status, 'active'))).orderBy(desc(githubInstallationSchema.updatedAt));
}

/**
 * The workspace's installation that covers a repository, or null.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 */
export async function installationForRepo(orgId: string, fullName: string): Promise<GithubInstallationRow | null> {
  const rows = await installationsForOrg(orgId);
  return rows.find(r => installationCovers(r, fullName)) ?? null;
}

type Cached = { token: string; expiresAt: number; permissions: GithubPermissions };
const tokenCache = new Map<string, Cached>();

/** Test escape hatch: forget every minted token and decrypted secret. */
export function resetGithubAppCaches(): void {
  tokenCache.clear();
  appCache.clear();
}

export type MintOutcome
  = | { ok: true; token: string; expiresAt: Date; permissions: GithubPermissions; installationId: number }
    | { ok: false; reason: 'no_installation' | 'no_app' | 'refused'; message: string; needsUpgrade: boolean; installationId: number | null };

/**
 * A token from an installation, for one repository or (with none named) for
 * every repository the installation covers.
 * @param row - The installation.
 * @param repoName - The repository NAME to scope to, or null for the whole installation.
 * @param opts - Overrides.
 * @param opts.now - Epoch ms; for tests.
 * @param opts.fetchImpl - Injected for tests.
 */
export async function mintForInstallation(row: GithubInstallationRow, repoName: string | null, opts: { now?: number; fetchImpl?: typeof fetch } = {}): Promise<MintOutcome> {
  const now = opts.now ?? Date.now();
  const tier = (row.tier === 'pipeline' ? 'pipeline' : 'base') as GithubTier;
  const key = `${row.appId}:${row.installationId}:${tier}:${(repoName ?? '*').toLowerCase()}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt - REFRESH_BEFORE_MS > now) {
    return { ok: true, token: hit.token, expiresAt: new Date(hit.expiresAt), permissions: hit.permissions, installationId: row.installationId };
  }
  const [app] = await db.select().from(githubAppSchema).where(and(eq(githubAppSchema.appId, row.appId), eq(githubAppSchema.status, 'active'))).limit(1);
  if (!app) {
    return { ok: false, reason: 'no_app', message: 'The GitHub App this connection was installed from is no longer this deployment\'s app. Connect GitHub again from Connections.', needsUpgrade: false, installationId: row.installationId };
  }
  const secrets = await appSecrets(app);
  const minted = await mintInstallationToken({
    appId: app.appId,
    privateKey: secrets.privateKey,
    installationId: row.installationId,
    permissions: permissionsForTier(tier),
    ...(repoName ? { repositories: [repoName] } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  if (!minted.ok) {
    await db.update(githubInstallationSchema).set({ lastError: minted.message, updatedAt: new Date() }).where(eq(githubInstallationSchema.id, row.id));
    return { ok: false, reason: 'refused', message: minted.message, needsUpgrade: minted.needsUpgrade, installationId: row.installationId };
  }
  tokenCache.set(key, { token: minted.token, expiresAt: minted.expiresAt.getTime(), permissions: minted.permissions });
  if (row.lastError) {
    await db.update(githubInstallationSchema).set({ lastError: null, updatedAt: new Date() }).where(eq(githubInstallationSchema.id, row.id));
  }
  return { ok: true, token: minted.token, expiresAt: minted.expiresAt, permissions: minted.permissions, installationId: row.installationId };
}

/**
 * The app's token for one repository in one workspace: the installation that
 * covers it, minted at the workspace's tier and scoped to that repository.
 * @param orgId - The workspace.
 * @param fullName - `owner/name`.
 * @param opts - Overrides for tests.
 * @param opts.now - Epoch ms.
 * @param opts.fetchImpl - Injected fetch.
 */
export async function installationTokenForRepo(orgId: string, fullName: string, opts: { now?: number; fetchImpl?: typeof fetch } = {}): Promise<MintOutcome> {
  const row = await installationForRepo(orgId, fullName);
  if (!row) {
    return { ok: false, reason: 'no_installation', message: `No GitHub App installation in this workspace covers ${fullName}.`, needsUpgrade: false, installationId: null };
  }
  return mintForInstallation(row, splitRepo(fullName)!.name, opts);
}

/**
 * Bind an installation of the active app to a workspace, reading from GitHub
 * what it is on, what it covers and what it was granted. Called by the
 * install callback once the person has been shown to have access to it, and
 * by the app's `installation*` webhooks to keep it true.
 * @param input - The binding.
 * @param input.orgId - The workspace.
 * @param input.installationId - GitHub's installation id.
 * @param input.connectedBy - Who connected it.
 * @param input.fetchImpl - Injected for tests.
 */
export async function bindInstallation(input: { orgId: string; installationId: number; connectedBy: string | null; fetchImpl?: typeof fetch }): Promise<GithubInstallationRow> {
  const app = await activeApp();
  if (!app) {
    throw new Error('This deployment has no GitHub App yet: create it from Connections first.');
  }
  const refreshed = await describeInstallation(app, input.installationId, input.fetchImpl);
  const values = {
    orgId: input.orgId,
    appId: app.appId,
    installationId: input.installationId,
    accountLogin: refreshed.accountLogin,
    accountType: refreshed.accountType,
    repositorySelection: refreshed.repositorySelection,
    repos: refreshed.repos,
    permissions: refreshed.permissions,
    status: refreshed.suspended ? 'suspended' : 'active',
    lastError: null,
    connectedBy: input.connectedBy,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(githubInstallationSchema)
    .values(values)
    .onConflictDoUpdate({ target: [githubInstallationSchema.orgId, githubInstallationSchema.installationId], set: { ...values, connectedBy: undefined } })
    .returning();
  forgetInstallationTokens(input.installationId);
  return row!;
}

/**
 * What GitHub says an installation is right now.
 * @param app - The app.
 * @param installationId - The installation.
 * @param fetchImpl - Injected for tests.
 */
export async function describeInstallation(app: GithubAppRow, installationId: number, fetchImpl?: typeof fetch): Promise<{ accountLogin: string; accountType: string | null; repositorySelection: string; repos: string[]; permissions: Record<string, string>; suspended: boolean }> {
  const secrets = await appSecrets(app);
  const read = await readInstallation({ appId: app.appId, privateKey: secrets.privateKey, installationId, ...(fetchImpl ? { fetchImpl } : {}) });
  if (!read.ok) {
    throw new Error(read.message);
  }
  let repos: string[] = [];
  if (read.repositorySelection !== 'all' && !read.suspended) {
    const minted = await mintInstallationToken({ appId: app.appId, privateKey: secrets.privateKey, installationId, ...(fetchImpl ? { fetchImpl } : {}) });
    if (minted.ok) {
      repos = (await listInstallationRepos(minted.token, fetchImpl ? { fetchImpl } : {})) ?? [];
    }
  }
  return { accountLogin: read.accountLogin, accountType: read.accountType, repositorySelection: read.repositorySelection, repos, permissions: read.permissions, suspended: read.suspended };
}

/**
 * Drop cached tokens for an installation whose grant just changed.
 * @param installationId - The installation.
 */
export function forgetInstallationTokens(installationId: number): void {
  for (const key of tokenCache.keys()) {
    if (key.split(':')[1] === String(installationId)) {
      tokenCache.delete(key);
    }
  }
}

/**
 * Set a workspace's tier on its installations. `pipeline` is what "the
 * Release engineer may change CI and deploy config" turns on.
 * @param orgId - The workspace.
 * @param tier - The tier.
 */
export async function setInstallationTier(orgId: string, tier: GithubTier): Promise<void> {
  const rows = await db.update(githubInstallationSchema).set({ tier, updatedAt: new Date() }).where(eq(githubInstallationSchema.orgId, orgId)).returning({ installationId: githubInstallationSchema.installationId });
  for (const r of rows) {
    forgetInstallationTokens(r.installationId);
  }
}

/**
 * Raised when a workspace's GitHub connection lands (an install, a change of
 * repositories, a re-connect): what closes a waiting connection request, and
 * what an automation subscribes to.
 */
export const GITHUB_CONNECTED = 'github.connected';

/**
 * What follows a binding: the event that says it landed.
 * @param row - The installation just bound.
 */
export async function afterInstallationBound(row: GithubInstallationRow): Promise<void> {
  // The requests this connection answers close first, so nothing downstream
  // of the event reads them as still waiting.
  const { closeConnectionRequests } = await import('@/services/connections/connectionRequests');
  const scope = row.repositorySelection === 'all' ? `every repository of ${row.accountLogin}` : row.repos.join(', ') || row.accountLogin;
  await closeConnectionRequests(row.orgId, 'github', row.accountLogin, `GitHub connected: the Vocion GitHub App is installed on ${scope}.`);
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({
    orgId: row.orgId,
    type: GITHUB_CONNECTED,
    payload: { installationId: row.installationId, account: row.accountLogin, repositorySelection: row.repositorySelection, repos: row.repos, tier: row.tier },
    dedupeKey: `github.connected:${row.installationId}:${row.updatedAt.getTime()}`,
    invokedBy: 'github-app',
    dispatchMode: 'auto',
  });
}

/* ------------------------------------------------------------------ */
/* What Connections shows (backlog 053)                                */
/* ------------------------------------------------------------------ */

export type GithubConnectionView = {
  app: { appId: number; slug: string; name: string; ownerLogin: string | null; htmlUrl: string | null } | null;
  installations: Array<{
    id: number;
    installationId: number;
    accountLogin: string;
    accountType: string | null;
    repositorySelection: string;
    repos: string[];
    tier: GithubTier;
    status: string;
    lastError: string | null;
    /** Where an owner changes the repositories or uninstalls, on GitHub. */
    settingsUrl: string;
    updatedAt: string;
  }>;
};

/**
 * Where an installation's repositories are changed on GitHub.
 * @param row - The installation.
 * @param row.accountLogin - Its account.
 * @param row.accountType - `Organization` or `User`.
 * @param row.installationId - Its id.
 */
export function installationSettingsUrl(row: { accountLogin: string; accountType: string | null; installationId: number }): string {
  return row.accountType === 'User'
    ? `https://github.com/settings/installations/${row.installationId}`
    : `https://github.com/organizations/${encodeURIComponent(row.accountLogin)}/settings/installations/${row.installationId}`;
}

/**
 * The deployment's app and this workspace's installations of it, as Connections shows them.
 * @param orgId - The workspace.
 */
export async function connectionView(orgId: string): Promise<GithubConnectionView> {
  const app = await activeApp();
  const rows = await db.select().from(githubInstallationSchema).where(and(eq(githubInstallationSchema.orgId, orgId), ne(githubInstallationSchema.status, 'removed'))).orderBy(desc(githubInstallationSchema.updatedAt));
  return {
    app: app ? { appId: app.appId, slug: app.slug, name: app.name, ownerLogin: app.ownerLogin, htmlUrl: app.htmlUrl } : null,
    installations: rows.map(r => ({
      id: r.id,
      installationId: r.installationId,
      accountLogin: r.accountLogin,
      accountType: r.accountType,
      repositorySelection: r.repositorySelection,
      repos: r.repos ?? [],
      tier: (r.tier === 'pipeline' ? 'pipeline' : 'base') as GithubTier,
      status: app && r.appId !== app.appId ? 'retired-app' : r.status,
      lastError: r.lastError,
      settingsUrl: installationSettingsUrl(r),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export type ConnectionTest = { installationId: number; account: string; ok: boolean; message: string; repos: string[] };

/**
 * Test connection: for each installation, read it again from GitHub (which
 * refreshes its repositories and grant) and mint a token at the workspace's
 * tier, which is what every call will do. Says, per account, what works.
 * @param orgId - The workspace.
 * @param fetchImpl - Injected for tests.
 */
export async function testConnection(orgId: string, fetchImpl?: typeof fetch): Promise<ConnectionTest[]> {
  const rows = await db.select().from(githubInstallationSchema).where(and(eq(githubInstallationSchema.orgId, orgId), ne(githubInstallationSchema.status, 'removed')));
  const out: ConnectionTest[] = [];
  for (const row of rows) {
    try {
      const bound = await bindInstallation({ orgId, installationId: row.installationId, connectedBy: row.connectedBy, ...(fetchImpl ? { fetchImpl } : {}) });
      if (bound.status === 'suspended') {
        out.push({ installationId: row.installationId, account: bound.accountLogin, ok: false, message: `The app is suspended on ${bound.accountLogin}. An owner unsuspends it on GitHub.`, repos: bound.repos });
        continue;
      }
      const minted = await mintForInstallation(bound, null, fetchImpl ? { fetchImpl } : {});
      const scope = bound.repositorySelection === 'all' ? `every repository of ${bound.accountLogin}` : `${bound.repos.length} ${bound.repos.length === 1 ? 'repository' : 'repositories'}`;
      out.push(minted.ok
        ? { installationId: row.installationId, account: bound.accountLogin, ok: true, message: `Connected to ${scope} at the ${bound.tier} tier.`, repos: bound.repos }
        : { installationId: row.installationId, account: bound.accountLogin, ok: false, message: minted.needsUpgrade ? `${minted.message} An owner accepts the app's new permissions on GitHub.` : minted.message, repos: bound.repos });
    } catch (err) {
      out.push({ installationId: row.installationId, account: row.accountLogin, ok: false, message: (err as Error).message, repos: row.repos ?? [] });
    }
  }
  return out;
}

/**
 * Disconnect: this workspace stops using an installation. The installation
 * stays on GitHub (another workspace may use it); an owner uninstalls it there.
 * @param orgId - The workspace.
 * @param id - The installation row's id.
 */
export async function disconnectInstallation(orgId: string, id: number): Promise<boolean> {
  const rows = await db.update(githubInstallationSchema).set({ status: 'removed', updatedAt: new Date() }).where(and(eq(githubInstallationSchema.orgId, orgId), eq(githubInstallationSchema.id, id))).returning({ installationId: githubInstallationSchema.installationId });
  for (const r of rows) {
    forgetInstallationTokens(r.installationId);
  }
  return rows.length > 0;
}
