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
