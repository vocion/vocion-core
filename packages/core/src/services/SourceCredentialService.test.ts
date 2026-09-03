/**
 * Credential vault bridge against PGlite. Verifies the store→encrypt→DB→
 * decrypt→get round-trip, that the DB only ever holds ciphertext, and that a
 * revoked credential is not resolved.
 *
 * The vault is stubbed to a self-contained AES-256-GCM fake (the real cipher
 * helpers, a fixed test key, a real `source_dek` row to satisfy the FK) so the
 * test exercises this service's store/get/revoke logic against real tables
 * without `buildCredentialVault`'s env-based `require` (which vitest can't
 * resolve). localVault's DEK mechanics have their own integration suite.
 */
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let testDekId = 0;
const TEST_KEY = Buffer.alloc(32, 7);

vi.mock('@/libs/DB');
vi.mock('@/libs/crypto/credentialVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/crypto/credentialVault')>();
  return {
    ...actual,
    buildCredentialVault: () => ({
      kind: 'local' as const,
      async encrypt(_orgId: string, plaintext: Buffer) {
        const { ciphertext, nonce, authTag } = actual.aesEncrypt(TEST_KEY, plaintext);
        return {
          ciphertext: ciphertext.toString('base64'),
          nonce: nonce.toString('base64'),
          authTag: authTag.toString('base64'),
          dekId: testDekId,
        };
      },
      async decrypt(_orgId: string, ciphertext: string, nonce: string, authTag: string) {
        return actual.aesDecrypt(
          TEST_KEY,
          Buffer.from(ciphertext, 'base64'),
          Buffer.from(nonce, 'base64'),
          Buffer.from(authTag, 'base64'),
        );
      },
    }),
  };
});

const { db } = await import('@/libs/DB');
const {
  apiTokenSchema,
  projectSchema,
  sourceCredentialSchema,
  sourceDekSchema,
  sourceInstallSchema,
  tenantAccountSchema,
} = await import('@/models/Schema');
const {
  credentialStatusForOrg,
  getCredentialsForSource,
  linkInstallToStoredCredential,
  storeCredential,
} = await import('@/services/SourceCredentialService');
const { rotatePlatformCredential, revokeToken, storePlatformKey } = await import('@/services/ApiTokenService');

const ORG = 'org_cred_test';

async function makeInstall(slug: string): Promise<number> {
  const [row] = await db
    .insert(sourceInstallSchema)
    .values({ orgId: ORG, sourceSlug: slug, installedBy: 'tester' })
    .returning({ id: sourceInstallSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  const [dek] = await db
    .insert(sourceDekSchema)
    .values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  testDekId = dek!.id;
  // `ensureInstall` defaults an install's project to the org id, and
  // `source_install.project_id` is a real foreign key, so the row has to exist.
  await db.insert(tenantAccountSchema).values({ id: ORG, name: 'Cred Test', slug: 'cred-test' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ORG, slug: 'cred-test', name: 'Cred Test' });
});

afterAll(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('SourceCredentialService', () => {
  it('round-trips credentials and stores only ciphertext', async () => {
    const installId = await makeInstall('hubspot');
    const raw = { token: 'pat-na1-supersecret', developerToken: 'dev-123' };
    const credId = await storeCredential({ orgId: ORG, installId, displayName: 'chris@metacto.com', raw });

    const [row] = await db.select().from(sourceCredentialSchema).where(eq(sourceCredentialSchema.id, credId));

    expect(row!.ciphertext).not.toContain('supersecret');
    expect(row!.nonce).toBeTruthy();
    expect(row!.authTag).toBeTruthy();

    const resolved = await getCredentialsForSource(ORG, 'hubspot');

    expect(resolved).toEqual(raw);
  });

  it('returns undefined when the source has no install', async () => {
    expect(await getCredentialsForSource(ORG, 'never-installed')).toBeUndefined();
  });

  it('does not resolve a revoked credential', async () => {
    const installId = await makeInstall('gmail');
    const credId = await storeCredential({ orgId: ORG, installId, displayName: 'inbox', raw: { token: 'abc' } });
    await db.update(sourceCredentialSchema).set({ revokedAt: new Date() }).where(eq(sourceCredentialSchema.id, credId));

    expect(await getCredentialsForSource(ORG, 'gmail')).toBeUndefined();
  });
});

describe('an install pointing at a stored credential', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('resolves the stored credential instead of asking for the key again', async () => {
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });

    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });

    await expect(getCredentialsForSource(ORG, 'strapi')).resolves.toEqual(STRAPI);
  });

  it('uses the new value after a rotation, with no change to the install', async () => {
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });

    await rotatePlatformCredential({
      orgId: ORG,
      tokenId: credential.id,
      values: { baseUrl: STRAPI.baseUrl, token: 'strapi-token-rotated' },
    });

    await expect(getCredentialsForSource(ORG, 'strapi')).resolves.toEqual({
      baseUrl: STRAPI.baseUrl,
      token: 'strapi-token-rotated',
    });
  });

  it('reports a revoked credential as broken rather than as no credential', async () => {
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });
    await revokeToken(ORG, credential.id);

    await expect(getCredentialsForSource(ORG, 'strapi')).rejects.toThrow(/was revoked/);
  });

  it('reports an expired credential as broken', async () => {
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
      expiresAt: new Date(Date.now() - 1000),
    });
    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });

    await expect(getCredentialsForSource(ORG, 'strapi')).rejects.toThrow(/has expired/);
  });

  it('ignores a leftover per-install copy once the install points at a stored credential', async () => {
    // A migrated install may still have its old `source_credential` row. The
    // stored credential is the one that rotates, so it has to win.
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });
    const installId = await linkInstallToStoredCredential({
      orgId: ORG,
      sourceSlug: 'strapi',
      apiTokenId: credential.id,
    });
    await storeCredential({ orgId: ORG, installId, displayName: 'old copy', raw: { token: 'stale-token' } });

    await expect(getCredentialsForSource(ORG, 'strapi')).resolves.toEqual(STRAPI);
  });

  it('refuses a credential belonging to a different platform', async () => {
    const hubspot = await storePlatformKey({
      orgId: ORG,
      name: 'Acme HubSpot',
      platform: 'hubspot',
      apiKey: 'pat-na1-hubspot-token',
    });

    await expect(linkInstallToStoredCredential({
      orgId: ORG,
      sourceSlug: 'strapi',
      apiTokenId: hubspot.id,
    })).rejects.toThrow(/belongs to hubspot/);
  });

  it('refuses a connector that does not authenticate with a stored credential', async () => {
    // Slack's OAuth grant is issued to one install and carries a refresh
    // token, so there is nothing to point several installs at.
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
    });

    await expect(linkInstallToStoredCredential({
      orgId: ORG,
      sourceSlug: 'slack',
      apiTokenId: credential.id,
    })).rejects.toThrow(/does not authenticate with a stored API credential/);
  });

  it('refuses a credential that does not exist', async () => {
    await expect(linkInstallToStoredCredential({
      orgId: ORG,
      sourceSlug: 'strapi',
      apiTokenId: 'nosuchcredential',
    })).rejects.toThrow(/does not exist/);
  });

  it('refuses another org\'s credential', async () => {
    const theirs = await storePlatformKey({
      orgId: 'org_somebody_else',
      name: 'Their Strapi',
      platform: 'strapi',
      values: STRAPI,
    });

    await expect(linkInstallToStoredCredential({
      orgId: ORG,
      sourceSlug: 'strapi',
      apiTokenId: theirs.id,
    })).rejects.toThrow(/does not exist/);
  });
});

describe('credentialStatusForOrg', () => {
  const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

  it('shows a linked connector as connected and not broken', async () => {
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });

    const status = await credentialStatusForOrg(ORG);

    expect(status.strapi?.connected).toBe(true);
    expect(status.strapi?.broken).toBeNull();
  });

  it('shows a revoked credential as broken, not as awaiting connection', async () => {
    // The distinction the badge needs: this connector does not need a key
    // pasted, it needs the key it already names put back in service.
    const credential = await storePlatformKey({ orgId: ORG, name: 'Strapi — prod', platform: 'strapi', values: STRAPI });
    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });
    await revokeToken(ORG, credential.id);

    const status = await credentialStatusForOrg(ORG);

    expect(status.strapi).toMatchObject({ connected: false, broken: 'revoked' });
  });

  it('shows an expired credential as broken', async () => {
    const credential = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod',
      platform: 'strapi',
      values: STRAPI,
      expiresAt: new Date(Date.now() - 1000),
    });
    await linkInstallToStoredCredential({ orgId: ORG, sourceSlug: 'strapi', apiTokenId: credential.id });

    const status = await credentialStatusForOrg(ORG);

    expect(status.strapi).toMatchObject({ connected: false, broken: 'expired' });
  });

  it('still answers an OAuth install from its own credential row', async () => {
    const installId = await makeInstall('gmail');
    await storeCredential({ orgId: ORG, installId, displayName: 'inbox', raw: { token: 'abc' } });

    const status = await credentialStatusForOrg(ORG);

    expect(status.gmail).toMatchObject({ connected: true, broken: null });
  });
});
