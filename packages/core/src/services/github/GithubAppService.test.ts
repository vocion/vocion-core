/**
 * The deployment's GitHub App against an in-memory database and a stubbed
 * GitHub: its secrets are sealed in the vault, an installation covers the
 * repositories its owner chose, a token is minted for one repository at the
 * workspace's tier and reused until five minutes before it expires, a failed
 * mint is recorded where Connections reads it, and `tokenForRepo` asks the
 * app first. Fictional orgs and keys throughout.
 */
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', Buffer.from('k'.repeat(32)).toString('base64'));

const { db } = await import('@/libs/DB');
const { githubAppSchema, githubInstallationSchema } = await import('@/models/Schema');
const svc = await import('./GithubAppService');
const { tokenForRepo } = await import('@/services/agents/tools/githubPullRead');

const ORG = 'org_northwind_factory';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

async function seedApp(appId = 1001) {
  return svc.saveApp({
    appId,
    slug: 'vocion-northwind',
    name: 'Vocion (Northwind)',
    clientId: 'Iv1.fixture',
    ownerLogin: 'northwind',
    htmlUrl: 'https://github.com/apps/vocion-northwind',
    permissions: { contents: 'write' },
    events: ['pull_request'],
    secrets: { privateKey, webhookSecret: 'whsec-fixture', clientSecret: 'cs-fixture' },
  }, 'usr-owner');
}

async function seedInstallation(overrides: Partial<typeof githubInstallationSchema.$inferInsert> = {}) {
  const [row] = await db.insert(githubInstallationSchema).values({
    orgId: ORG,
    appId: 1001,
    installationId: 555,
    accountLogin: 'Northwind',
    repositorySelection: 'selected',
    repos: ['northwind/orders-api'],
    ...overrides,
  }).returning();
  return row!;
}

function mintResponse(token: string, expiresAt: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ token, expires_at: expiresAt, permissions: { contents: 'write' } }), { status: 201 }));
}

beforeEach(async () => {
  await db.delete(githubInstallationSchema);
  await db.delete(githubAppSchema);
  svc.resetGithubAppCaches();
  vi.unstubAllGlobals();
});

describe('saveApp', () => {
  it('seals the key and secrets in the vault and retires the app it replaces', async () => {
    await seedApp(1000);
    const row = await seedApp(1001);

    expect(row.secretCiphertext).not.toContain('PRIVATE KEY');
    expect(row.secretCiphertext).not.toContain('whsec-fixture');

    svc.resetGithubAppCaches();

    expect(await svc.appSecrets(row)).toEqual({ privateKey, webhookSecret: 'whsec-fixture', clientSecret: 'cs-fixture' });
    expect((await svc.activeApp())?.appId).toBe(1001);

    const statuses = await db.select({ appId: githubAppSchema.appId, status: githubAppSchema.status }).from(githubAppSchema);

    expect(statuses.sort((a, b) => a.appId - b.appId)).toEqual([{ appId: 1000, status: 'retired' }, { appId: 1001, status: 'active' }]);
  });
});

describe('installationCovers', () => {
  it('covers the chosen repositories of its own account, or all of them', () => {
    const selected = { accountLogin: 'Northwind', repositorySelection: 'selected', repos: ['northwind/orders-api'] };

    expect(svc.installationCovers(selected, 'northwind/orders-api')).toBe(true);
    expect(svc.installationCovers(selected, 'northwind/billing')).toBe(false);
    expect(svc.installationCovers({ ...selected, repositorySelection: 'all', repos: [] }, 'northwind/billing')).toBe(true);
    expect(svc.installationCovers({ ...selected, repositorySelection: 'all', repos: [] }, 'kestrel/billing')).toBe(false);
  });
});

describe('installationTokenForRepo', () => {
  it('mints for that one repository at the workspace tier, and reuses the token until five minutes before expiry', async () => {
    await seedApp();
    await seedInstallation({ tier: 'pipeline' });
    const fetchImpl = mintResponse('ghs_first', '2026-10-01T01:00:00Z');
    const t0 = Date.parse('2026-10-01T00:00:00Z');

    const first = await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { now: t0, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(first).toMatchObject({ ok: true, token: 'ghs_first', installationId: 555 });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({
      permissions: { metadata: 'read', contents: 'write', pull_requests: 'write', actions: 'write', checks: 'read', workflows: 'write' },
      repositories: ['orders-api'],
    });

    await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { now: t0 + 50 * 60_000, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { now: t0 + 56 * 60_000, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('answers no_installation for a repository no installation covers, and never calls GitHub', async () => {
    await seedApp();
    await seedInstallation();
    const fetchImpl = vi.fn();

    expect(await svc.installationTokenForRepo(ORG, 'northwind/billing', { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: false, reason: 'no_installation' });
    expect(await svc.installationTokenForRepo('org_kestrel', 'northwind/orders-api', { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: false, reason: 'no_installation' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records GitHub\'s reason on the installation when a mint is refused, and clears it on the next success', async () => {
    await seedApp();
    const row = await seedInstallation();
    const refused = vi.fn(async () => new Response(JSON.stringify({ message: 'The permissions requested are not granted to this installation.' }), { status: 422 }));

    const out = await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { fetchImpl: refused as unknown as typeof fetch });

    expect(out).toMatchObject({ ok: false, reason: 'refused', needsUpgrade: true });

    const [after] = await db.select().from(githubInstallationSchema);

    expect(after!.lastError).toContain('not granted');

    await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { fetchImpl: mintResponse('ghs_ok', '2099-01-01T00:00:00Z') as unknown as typeof fetch });
    const [healed] = await db.select().from(githubInstallationSchema);

    expect(healed!.id).toBe(row.id);
    expect(healed!.lastError).toBeNull();
  });

  it('refuses an installation of an app that was retired', async () => {
    await seedApp(1001);
    await seedInstallation();
    await seedApp(1002);

    expect(await svc.installationTokenForRepo(ORG, 'northwind/orders-api')).toMatchObject({ ok: false, reason: 'no_app' });
  });
});

describe('tokenForRepo', () => {
  it('answers with the app\'s installation token before any source token', async () => {
    await seedApp();
    await seedInstallation();
    vi.stubGlobal('fetch', mintResponse('ghs_from_app', '2099-01-01T00:00:00Z'));

    expect(await tokenForRepo(ORG, 'northwind/orders-api')).toBe('ghs_from_app');
  });

  it('falls back to the legacy source path when no installation covers the repository', async () => {
    await seedApp();
    await seedInstallation();
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    expect(await tokenForRepo(ORG, 'northwind/billing')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('setInstallationTier', () => {
  it('moves the workspace\'s installations to a tier and forgets their cached tokens', async () => {
    await seedApp();
    await seedInstallation();
    const fetchImpl = mintResponse('ghs_base', '2099-01-01T00:00:00Z');
    await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.setInstallationTier(ORG, 'pipeline');
    await svc.installationTokenForRepo(ORG, 'northwind/orders-api', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body)).permissions.workflows).toBe('write');
  });
});

describe('what Connections shows', () => {
  it('lists the workspace\'s installations with where to change them on GitHub, and never a secret', async () => {
    await seedApp();
    await seedInstallation({ accountType: 'Organization', lastError: 'GitHub refused an installation token (422): not granted' });
    const view = await svc.connectionView(ORG);

    expect(view.app).toEqual({ appId: 1001, slug: 'vocion-northwind', name: 'Vocion (Northwind)', ownerLogin: 'northwind', htmlUrl: 'https://github.com/apps/vocion-northwind' });
    expect(view.installations).toHaveLength(1);
    expect(view.installations[0]).toMatchObject({ accountLogin: 'Northwind', tier: 'base', status: 'active', settingsUrl: 'https://github.com/organizations/Northwind/settings/installations/555' });
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE KEY|whsec|cs-fixture/);
  });

  it('tests each installation by reading it again and minting at the tier', async () => {
    await seedApp();
    await seedInstallation();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_t', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 });
      }
      if (url.includes('/installation/repositories')) {
        return new Response(JSON.stringify({ total_count: 2, repositories: [{ full_name: 'northwind/orders-api' }, { full_name: 'northwind/billing' }] }));
      }
      return new Response(JSON.stringify({ account: { login: 'Northwind', type: 'Organization' }, repository_selection: 'selected', permissions: {} }));
    });
    const [result] = await svc.testConnection(ORG, fetchImpl as unknown as typeof fetch);

    expect(result).toMatchObject({ ok: true, account: 'Northwind', repos: ['northwind/orders-api', 'northwind/billing'] });
    expect(result!.message).toBe('Connected to 2 repositories at the base tier.');
  });

  it('disconnects only this workspace from an installation', async () => {
    await seedApp();
    const mine = await seedInstallation();
    await seedInstallation({ orgId: 'org_kestrel' });

    expect(await svc.disconnectInstallation('org_kestrel', mine.id)).toBe(false);
    expect(await svc.disconnectInstallation(ORG, mine.id)).toBe(true);
    expect((await svc.connectionView(ORG)).installations).toHaveLength(0);
    expect((await svc.connectionView('org_kestrel')).installations).toHaveLength(1);
  });
});
