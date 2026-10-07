/**
 * kmsVault — production CredentialVault backed by AWS KMS.
 *
 * Two-tier envelope encryption:
 *   1. KMS holds the customer master key (CMK) — never leaves AWS.
 *   2. We generate a 32-byte data encryption key (DEK) per tenant.
 *   3. Vocion encrypts each credential blob with the DEK + AES-256-GCM.
 *   4. KMS wraps the DEK for storage in `source_dek.wrapped_dek`.
 *   5. To decrypt, we ask KMS to unwrap the DEK (cached for ≤ 15 min),
 *      then run AES-GCM locally.
 *
 * Why envelope: KMS API limits + cost. One KMS call unwraps one DEK
 * for ~15 minutes of in-memory use; we never round-trip per credential.
 *
 * Each DEK is bound to its org. KMS wraps it under the EncryptionContext
 * `{ orgId }` and unwraps it only when handed the same context, so a wrapped
 * DEK copied onto another org's `source_dek` row will not open there, and every
 * unwrap is recorded in CloudTrail under the org it was for. On top of that,
 * a read names the org it is reading for and is refused when the DEK row
 * belongs to a different one — before any KMS call, and on a cache hit too.
 *
 * DEKs wrapped before the context was passed still open: an unwrap that KMS
 * refuses as `InvalidCiphertextException` is retried without a context, and a
 * DEK that opens that way is re-wrapped under its org's context in place
 * (`ReEncrypt`, so the plaintext key never travels again). A failed re-wrap is
 * logged and costs nothing else — the read still returns, and the next unwrap
 * tries again. IAM for the vault role: `kms:GenerateDataKey`, `kms:Decrypt`,
 * and `kms:ReEncryptFrom` + `kms:ReEncryptTo` for the re-wrap.
 */

import type { CredentialVault, EncryptResult } from './credentialVault';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient, ReEncryptCommand } from '@aws-sdk/client-kms';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceDekSchema } from '@/models/Schema';
import {
  AES_KEY_BYTES,
  aesDecrypt,
  aesEncrypt,
  VaultDecryptionError,
} from './credentialVault';

const DEK_CACHE_MS = 15 * 60 * 1000;
/** The unwrapped key, and the org its row belongs to — a cache hit is checked against it. */
const dekCache = new Map<number, { key: Buffer; orgId: string; cachedAt: number }>();

/** The `source_dek` columns an unwrap needs. */
type DekRow = { id: number; orgId: string; wrappedDek: string };

export type KmsVaultOptions = {
  kmsKeyArn: string;
  region?: string;
};

/**
 * The KMS EncryptionContext a DEK is wrapped under: the org it seals for.
 *
 * Not secret — KMS logs it in CloudTrail in the clear — and that is the point:
 * every unwrap says which org it was for.
 * @param orgId - The org the DEK belongs to.
 */
export function dekEncryptionContext(orgId: string): Record<string, string> {
  return { orgId };
}

/**
 * Whether KMS refused a ciphertext because it does not match what was asked —
 * for a DEK, an EncryptionContext different from the one it was wrapped under.
 * By name rather than `instanceof`: the SDK's error classes are per-package and
 * a bundler can load two copies.
 * @param error - Whatever `kms.send` threw.
 */
function isInvalidCiphertext(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'InvalidCiphertextException';
}

/**
 * The refusal for a credential read under an org its DEK does not belong to.
 * A `VaultDecryptionError`, so the routes show it: it names the cause and the
 * fix and no secret. The two org ids go on `cause`, for the log.
 * @param dekId - The DEK row asked for.
 * @param owner - The org the row belongs to.
 * @param reader - The org the read was made for.
 */
function crossOrgRefusal(dekId: number, owner: string, reader: string): VaultDecryptionError {
  return new VaultDecryptionError(
    'This credential was sealed for a different workspace than the one reading it, so it is not '
    + 'opened here. Reconnect the credential in this workspace.',
    { cause: new Error(`source_dek ${dekId} belongs to org ${owner}; read for org ${reader}`) },
  );
}

export function kmsVault(opts: KmsVaultOptions): CredentialVault {
  const kms = new KMSClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  const KEY_ARN = opts.kmsKeyArn;

  async function getOrCreateActiveDek(orgId: string): Promise<DekRow> {
    const [existing] = await db
      .select({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek })
      .from(sourceDekSchema)
      .where(and(eq(sourceDekSchema.orgId, orgId), eq(sourceDekSchema.kmsKeyArn, KEY_ARN)))
      .orderBy(desc(sourceDekSchema.createdAt))
      .limit(1);
    if (existing) {
      return existing;
    }
    return insertDek(orgId, null);
  }

  /**
   * Mint a DEK under the org's context and store its wrapped form. The cache is
   * seeded with the plaintext we already hold, so the first read costs no
   * round trip.
   * @param orgId - The org the DEK seals for.
   * @param rotatedAt - Set when this DEK replaces an earlier one.
   */
  async function insertDek(orgId: string, rotatedAt: Date | null): Promise<DekRow> {
    // GenerateDataKey gives us both the plaintext + KMS-wrapped form.
    const r = await kms.send(new GenerateDataKeyCommand({
      KeyId: KEY_ARN,
      KeySpec: 'AES_256',
      EncryptionContext: dekEncryptionContext(orgId),
    }));
    if (!r.Plaintext || !r.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned empty Plaintext or CiphertextBlob');
    }
    const wrapped = Buffer.from(r.CiphertextBlob).toString('base64');
    const [created] = await db
      .insert(sourceDekSchema)
      .values({
        orgId,
        kmsKeyArn: KEY_ARN,
        wrappedDek: wrapped,
        algorithm: 'AES_256_GCM',
        ...(rotatedAt ? { rotatedAt } : {}),
      })
      .returning({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek });
    dekCache.set(created!.id, { key: Buffer.from(r.Plaintext), orgId, cachedAt: Date.now() });
    return created!;
  }

  /**
   * Re-wrap a DEK that predates the EncryptionContext under its org's context,
   * in place. Best effort: the caller already holds the plaintext key, so a
   * failure here is logged and the next unwrap simply tries again.
   * @param dek - The row, as it was read.
   */
  async function rewrapUnderContext(dek: DekRow): Promise<void> {
    try {
      const r = await kms.send(new ReEncryptCommand({
        CiphertextBlob: Buffer.from(dek.wrappedDek, 'base64'),
        SourceKeyId: KEY_ARN,
        DestinationKeyId: KEY_ARN,
        DestinationEncryptionContext: dekEncryptionContext(dek.orgId),
      }));
      if (!r.CiphertextBlob) {
        throw new Error('KMS ReEncrypt returned an empty CiphertextBlob');
      }
      // Conditional on the old value: a second process that re-wrapped first
      // wrote an equally valid blob, and there is nothing to gain by
      // overwriting it.
      await db
        .update(sourceDekSchema)
        .set({ wrappedDek: Buffer.from(r.CiphertextBlob).toString('base64') })
        .where(and(eq(sourceDekSchema.id, dek.id), eq(sourceDekSchema.wrappedDek, dek.wrappedDek)));
    } catch (error) {
      console.warn('[kmsVault] could not re-wrap a DEK under its org context; it still opens without one, and the next unwrap retries', {
        dekId: dek.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function unwrapDek(dek: DekRow): Promise<Buffer> {
    const ciphertextBlob = Buffer.from(dek.wrappedDek, 'base64');
    let plaintext: Uint8Array | undefined;
    let bound = true;
    try {
      plaintext = (await kms.send(new DecryptCommand({
        CiphertextBlob: ciphertextBlob,
        KeyId: KEY_ARN,
        EncryptionContext: dekEncryptionContext(dek.orgId),
      }))).Plaintext;
    } catch (error) {
      if (!isInvalidCiphertext(error)) {
        throw error;
      }
      // Wrapped before DEKs carried their org as context. Anything else KMS
      // refuses this way — a DEK bound to another org, a damaged blob — fails
      // this second attempt too.
      try {
        plaintext = (await kms.send(new DecryptCommand({ CiphertextBlob: ciphertextBlob, KeyId: KEY_ARN }))).Plaintext;
      } catch (legacyError) {
        if (!isInvalidCiphertext(legacyError)) {
          throw legacyError;
        }
        throw new VaultDecryptionError(
          'KMS would not unwrap the key that sealed this credential for this workspace: it was '
          + 'wrapped for a different workspace or is damaged. Reconnect the credential in this '
          + 'workspace.',
          { cause: error },
        );
      }
      bound = false;
    }
    if (!plaintext) {
      throw new Error('KMS Decrypt returned empty Plaintext');
    }
    const key = Buffer.from(plaintext);
    if (key.length !== AES_KEY_BYTES) {
      throw new Error(`KMS-unwrapped DEK is ${key.length} bytes; expected ${AES_KEY_BYTES}`);
    }
    dekCache.set(dek.id, { key, orgId: dek.orgId, cachedAt: Date.now() });
    if (!bound) {
      await rewrapUnderContext(dek);
    }
    return key;
  }

  /**
   * The plaintext DEK for a read made on behalf of `orgId`, refused when the
   * row belongs to another org — checked on the cached key as well, so a warm
   * cache is no way around it.
   * @param orgId - The org the read is for.
   * @param dekId - The DEK row the credential names.
   */
  async function dekFor(orgId: string, dekId: number): Promise<Buffer> {
    const cached = dekCache.get(dekId);
    if (cached && Date.now() - cached.cachedAt < DEK_CACHE_MS) {
      if (cached.orgId !== orgId) {
        throw crossOrgRefusal(dekId, cached.orgId, orgId);
      }
      return cached.key;
    }
    const [row] = await db
      .select({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek })
      .from(sourceDekSchema)
      .where(eq(sourceDekSchema.id, dekId));
    if (!row) {
      throw new Error(`source_dek row ${dekId} not found`);
    }
    if (row.orgId !== orgId) {
      throw crossOrgRefusal(dekId, row.orgId, orgId);
    }
    return unwrapDek(row);
  }

  return {
    kind: 'kms',
    async encrypt(orgId: string, plaintext: Buffer): Promise<EncryptResult> {
      const dek = await getOrCreateActiveDek(orgId);
      const key = await dekFor(orgId, dek.id);
      const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
      return {
        ciphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
        dekId: dek.id,
      };
    },
    async decrypt(orgId, ciphertext, nonce, authTag, dekId) {
      const key = await dekFor(orgId, dekId);
      return aesDecrypt(
        key,
        Buffer.from(ciphertext, 'base64'),
        Buffer.from(nonce, 'base64'),
        Buffer.from(authTag, 'base64'),
      );
    },
    async rotateDek(orgId: string): Promise<number> {
      const created = await insertDek(orgId, new Date());
      return created.id;
    },
  };
}

/** Used by tests to drop the in-memory cache. */
export function resetKmsCache(): void {
  dekCache.clear();
}
