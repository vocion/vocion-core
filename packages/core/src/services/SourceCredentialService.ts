/**
 * SourceCredentialService — the read/write bridge between the encrypted
 * credential vault and a connector's sync.
 *
 * The vault (`libs/crypto/credentialVault`) and the `source_install` /
 * `source_credential` / `source_dek` tables already exist. This service is the
 * missing link: it stores a connector's credentials encrypted-at-rest, and —
 * the part the sync pipeline needs — resolves the decrypted credentials for a
 * source at sync time so the connector can authenticate. Without it,
 * `ctx.credentials` is always empty and every OAuth/token connector refuses.
 */

import { Buffer } from 'node:buffer';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';

/** Decrypted connector credentials (e.g. `{ token, refreshToken, developerToken }`). */
export type RawCredentials = Record<string, unknown>;

/**
 * Encrypt + persist credentials for an install. Returns the new credential id.
 * The plaintext never touches the DB — only the AES-GCM ciphertext + the dek id.
 * @param input
 * @param input.orgId
 * @param input.installId
 * @param input.displayName
 * @param input.raw
 * @param input.userId
 */
export async function storeCredential(input: {
  orgId: string;
  installId: number;
  displayName: string;
  raw: RawCredentials;
  userId?: string | null;
}): Promise<number> {
  const vault = buildCredentialVault();
  const { ciphertext, nonce, authTag, dekId } = await vault.encrypt(
    input.orgId,
    Buffer.from(JSON.stringify(input.raw), 'utf8'),
  );
  const [row] = await db
    .insert(sourceCredentialSchema)
    .values({
      installId: input.installId,
      userId: input.userId ?? null,
      displayName: input.displayName,
      dekId,
      ciphertext,
      nonce,
      authTag,
    })
    .returning({ id: sourceCredentialSchema.id });
  return row!.id;
}

/**
 * Find-or-create the org-scoped `source_install` for a connector slug. Nothing
 * else creates installs (sources are added as `knowledge_source` rows), so
 * without this the credential vault has no anchor and every apikey/OAuth
 * connector refuses at sync time. Returns the install id.
 * @param orgId
 * @param sourceSlug
 * @param userId
 * @param projectId
 */
export async function ensureInstall(
  orgId: string,
  sourceSlug: string,
  userId?: string | null,
  projectId?: string | null,
): Promise<number> {
  const [existing] = await db
    .select({ id: sourceInstallSchema.id })
    .from(sourceInstallSchema)
    .where(and(
      eq(sourceInstallSchema.orgId, orgId),
      eq(sourceInstallSchema.sourceSlug, sourceSlug),
    ))
    .limit(1);
  if (existing) {
    // Re-enable if it was soft-disabled; credentials outlive the toggle.
    await db
      .update(sourceInstallSchema)
      .set({ disabled: 'false' })
      .where(eq(sourceInstallSchema.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(sourceInstallSchema)
    .values({
      orgId,
      projectId: projectId ?? orgId,
      sourceSlug,
      installedBy: userId ?? 'system',
    })
    .returning({ id: sourceInstallSchema.id });
  return row!.id;
}

/**
 * The onboarding entry point: encrypt + persist credentials for a source slug,
 * creating the install if needed. This is what the Sources UI + the creds CLI
 * call — the one path that turns a pasted token into a live, decryptable
 * credential the sync pipeline can use.
 * @param input
 * @param input.orgId
 * @param input.sourceSlug
 * @param input.raw
 * @param input.displayName
 * @param input.userId
 * @param input.projectId
 */
export async function storeCredentialForSource(input: {
  orgId: string;
  sourceSlug: string;
  raw: RawCredentials;
  displayName?: string;
  userId?: string | null;
  projectId?: string | null;
}): Promise<{ installId: number; credentialId: number }> {
  const installId = await ensureInstall(input.orgId, input.sourceSlug, input.userId, input.projectId);
  const credentialId = await storeCredential({
    orgId: input.orgId,
    installId,
    displayName: input.displayName ?? `${input.sourceSlug} credential`,
    raw: input.raw,
    userId: input.userId,
  });
  return { installId, credentialId };
}

/** Whether a source slug has a live (non-revoked) credential, and when it was set. */
export type CredentialStatus = { connected: boolean; updatedAt: string | null };

/**
 * Connection status for every source slug in an org — drives the "Connected /
 * Needs credentials" badge in the Sources UI without decrypting anything.
 * @param orgId
 */
export async function credentialStatusForOrg(orgId: string): Promise<Record<string, CredentialStatus>> {
  const rows = await db
    .select({
      slug: sourceInstallSchema.sourceSlug,
      createdAt: sourceCredentialSchema.createdAt,
      revokedAt: sourceCredentialSchema.revokedAt,
    })
    .from(sourceInstallSchema)
    .leftJoin(sourceCredentialSchema, eq(sourceCredentialSchema.installId, sourceInstallSchema.id))
    .where(eq(sourceInstallSchema.orgId, orgId));

  const status: Record<string, CredentialStatus> = {};
  for (const r of rows) {
    const live = !!r.createdAt && !r.revokedAt;
    const prev = status[r.slug];
    if (!prev || (live && !prev.connected)) {
      status[r.slug] = {
        connected: live,
        updatedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      };
    }
  }
  return status;
}

/**
 * Resolve the decrypted credentials for a source in an org, or `undefined` when
 * the source has no install or no live credential (e.g. the `web` connector,
 * which needs none). Picks the most recent non-revoked credential for the
 * org-scoped install.
 * @param orgId
 * @param sourceSlug
 */
export async function getCredentialsForSource(
  orgId: string,
  sourceSlug: string,
): Promise<RawCredentials | undefined> {
  const [install] = await db
    .select({ id: sourceInstallSchema.id })
    .from(sourceInstallSchema)
    .where(and(
      eq(sourceInstallSchema.orgId, orgId),
      eq(sourceInstallSchema.sourceSlug, sourceSlug),
      eq(sourceInstallSchema.disabled, 'false'),
    ))
    .limit(1);
  if (!install) {
    return undefined;
  }

  const [cred] = await db
    .select()
    .from(sourceCredentialSchema)
    .where(and(
      eq(sourceCredentialSchema.installId, install.id),
      isNull(sourceCredentialSchema.revokedAt),
    ))
    .orderBy(desc(sourceCredentialSchema.createdAt))
    .limit(1);
  if (!cred) {
    return undefined;
  }

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(orgId, cred.ciphertext, cred.nonce, cred.authTag, cred.dekId);
  return JSON.parse(plaintext.toString('utf8')) as RawCredentials;
}
