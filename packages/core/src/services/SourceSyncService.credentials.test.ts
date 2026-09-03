/**
 * What a sync does when the credential its connector names cannot be used.
 *
 * The case is ordinary: somebody revokes a key under API credentials, or an
 * issued key reaches its expiry, and the next sync of the connector naming it
 * has nothing to authenticate with. What must not happen is a run that claims
 * the checkpoint and then never finishes it — the connectors page would show a
 * spinner with no failure behind it, and the next attempt would have to wait
 * out the stuck-run timeout.
 */
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

let testDekId = 0;
const TEST_KEY = Buffer.alloc(32, 5);

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
  knowledgeSourceSchema,
  sourceDekSchema,
  sourceSyncCheckpointSchema,
} = await import('@/models/Schema');
const { runSync } = await import('@/services/SourceSyncService');
const { linkSourceToStoredCredential } = await import('@/services/SourceCredentialService');
const { revokeToken, storePlatformKey } = await import('@/services/ApiTokenService');

const ORG = 'org_sync_creds';
const STRAPI = { baseUrl: 'https://cms.example.com', token: 'strapi-token-aaaa' };

/**
 * One Strapi connector row pointing at a stored credential.
 * @param expiresAt
 */
async function connectorOnCredential(expiresAt?: Date): Promise<{ sourceId: number; credentialId: string }> {
  const [source] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug: 'strapi-prod', kind: 'plugin', configJson: { _connector: 'strapi', collections: ['events'] } })
    .returning({ id: knowledgeSourceSchema.id });
  const credential = await storePlatformKey({
    orgId: ORG,
    name: 'Strapi — prod',
    platform: 'strapi',
    values: STRAPI,
    ...(expiresAt ? { expiresAt } : {}),
  });
  await linkSourceToStoredCredential({
    orgId: ORG,
    sourceId: source!.id,
    connectorSlug: 'strapi',
    apiTokenId: credential.id,
  });
  return { sourceId: source!.id, credentialId: credential.id };
}

async function clearAll(): Promise<void> {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
}

beforeEach(async () => {
  await clearAll();
  const [dek] = await db
    .insert(sourceDekSchema)
    .values({ orgId: ORG, wrappedDek: 'test', algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  testDekId = dek!.id;
});

afterAll(clearAll);

describe('a sync whose credential was revoked', () => {
  it('refuses with the reason, not with the vendor\'s 401', async () => {
    const { sourceId, credentialId } = await connectorOnCredential();
    await revokeToken(ORG, credentialId);

    await expect(runSync({ orgId: ORG, sourceId })).rejects.toThrow(/was revoked/);
  });

  it('claims no run, so nothing is left spinning', async () => {
    // The bug this covers: resolving credentials after `beginSync` left a
    // checkpoint marked `running` that nothing ever finished.
    const { sourceId, credentialId } = await connectorOnCredential();
    await revokeToken(ORG, credentialId);

    await runSync({ orgId: ORG, sourceId }).catch(() => undefined);
    const checkpoints = await db
      .select({ status: sourceSyncCheckpointSchema.status })
      .from(sourceSyncCheckpointSchema)
      .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(checkpoints.filter(checkpoint => checkpoint.status === 'running')).toEqual([]);
  });

  it('lets the next attempt run immediately once the credential is fixed', async () => {
    // A stuck `running` checkpoint would make the retry wait out the
    // takeover timeout, or refuse as already syncing.
    const { sourceId, credentialId } = await connectorOnCredential();
    await revokeToken(ORG, credentialId);
    await runSync({ orgId: ORG, sourceId }).catch(() => undefined);

    const replacement = await storePlatformKey({
      orgId: ORG,
      name: 'Strapi — prod, replaced',
      platform: 'strapi',
      values: STRAPI,
    });
    await linkSourceToStoredCredential({ orgId: ORG, sourceId, connectorSlug: 'strapi', apiTokenId: replacement.id });

    // Reaches the connector, which is as far as this test needs: no
    // "already syncing" refusal and no wait.
    await expect(runSync({ orgId: ORG, sourceId })).rejects.not.toThrow(/already syncing/);
  });
});

describe('a sync whose credential has expired', () => {
  it('refuses with the reason and claims no run', async () => {
    const { sourceId } = await connectorOnCredential(new Date(Date.now() - 1000));

    await expect(runSync({ orgId: ORG, sourceId })).rejects.toThrow(/has expired/);

    const checkpoints = await db
      .select({ status: sourceSyncCheckpointSchema.status })
      .from(sourceSyncCheckpointSchema)
      .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId));

    expect(checkpoints).toEqual([]);
  });
});
