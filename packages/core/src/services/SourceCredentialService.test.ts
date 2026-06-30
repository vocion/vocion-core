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
const { sourceCredentialSchema, sourceDekSchema, sourceInstallSchema } = await import('@/models/Schema');
const { getCredentialsForSource, storeCredential } = await import('@/services/SourceCredentialService');

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
  await db.delete(sourceDekSchema);
  const [dek] = await db
    .insert(sourceDekSchema)
    .values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  testDekId = dek!.id;
});

afterAll(async () => {
  await db.delete(sourceCredentialSchema);
  await db.delete(sourceInstallSchema);
  await db.delete(sourceDekSchema);
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
