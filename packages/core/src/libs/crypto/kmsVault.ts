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
 */

import type { CredentialVault, EncryptResult } from './credentialVault';
import process from 'node:process';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceDekSchema } from '@/models/Schema';
import {
  AES_KEY_BYTES,
  aesDecrypt,
  aesEncrypt,

} from './credentialVault';

const DEK_CACHE_MS = 15 * 60 * 1000;
const dekCache = new Map<number, { key: Buffer; cachedAt: number }>();

export type KmsVaultOptions = {
  kmsKeyArn: string;
  region?: string;
};

export function kmsVault(opts: KmsVaultOptions): CredentialVault {
  const kms = new KMSClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  const KEY_ARN = opts.kmsKeyArn;

  async function getOrCreateActiveDek(orgId: string): Promise<{ id: number; wrappedDek: string }> {
    const [existing] = await db
      .select({ id: sourceDekSchema.id, wrappedDek: sourceDekSchema.wrappedDek })
      .from(sourceDekSchema)
      .where(and(eq(sourceDekSchema.orgId, orgId), eq(sourceDekSchema.kmsKeyArn, KEY_ARN)))
      .orderBy(desc(sourceDekSchema.createdAt))
      .limit(1);
    if (existing) {
      return existing;
    }
    // GenerateDataKey gives us both the plaintext + KMS-wrapped form.
    const r = await kms.send(new GenerateDataKeyCommand({
      KeyId: KEY_ARN,
      KeySpec: 'AES_256',
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
      })
      .returning({ id: sourceDekSchema.id, wrappedDek: sourceDekSchema.wrappedDek });
    // Seed the cache with the plaintext we already have so we don't
    // round-trip KMS immediately after.
    dekCache.set(created!.id, { key: Buffer.from(r.Plaintext), cachedAt: Date.now() });
    return created!;
  }

  async function unwrapDek(dekId: number, wrappedDek: string): Promise<Buffer> {
    const cached = dekCache.get(dekId);
    if (cached && Date.now() - cached.cachedAt < DEK_CACHE_MS) {
      return cached.key;
    }
    const r = await kms.send(new DecryptCommand({
      CiphertextBlob: Buffer.from(wrappedDek, 'base64'),
      KeyId: KEY_ARN,
    }));
    if (!r.Plaintext) {
      throw new Error('KMS Decrypt returned empty Plaintext');
    }
    const key = Buffer.from(r.Plaintext);
    if (key.length !== AES_KEY_BYTES) {
      throw new Error(`KMS-unwrapped DEK is ${key.length} bytes; expected ${AES_KEY_BYTES}`);
    }
    dekCache.set(dekId, { key, cachedAt: Date.now() });
    return key;
  }

  async function dekById(dekId: number): Promise<Buffer> {
    const cached = dekCache.get(dekId);
    if (cached && Date.now() - cached.cachedAt < DEK_CACHE_MS) {
      return cached.key;
    }
    const [row] = await db
      .select({ wrappedDek: sourceDekSchema.wrappedDek })
      .from(sourceDekSchema)
      .where(eq(sourceDekSchema.id, dekId));
    if (!row) {
      throw new Error(`source_dek row ${dekId} not found`);
    }
    return unwrapDek(dekId, row.wrappedDek);
  }

  return {
    kind: 'kms',
    async encrypt(orgId: string, plaintext: Buffer): Promise<EncryptResult> {
      const dek = await getOrCreateActiveDek(orgId);
      const key = await dekById(dek.id);
      const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
      return {
        ciphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
        dekId: dek.id,
      };
    },
    async decrypt(_orgId, ciphertext, nonce, authTag, dekId) {
      const key = await dekById(dekId);
      return aesDecrypt(
        key,
        Buffer.from(ciphertext, 'base64'),
        Buffer.from(nonce, 'base64'),
        Buffer.from(authTag, 'base64'),
      );
    },
    async rotateDek(orgId: string): Promise<number> {
      const r = await kms.send(new GenerateDataKeyCommand({ KeyId: KEY_ARN, KeySpec: 'AES_256' }));
      if (!r.Plaintext || !r.CiphertextBlob) {
        throw new Error('KMS GenerateDataKey returned empty during rotation');
      }
      const wrapped = Buffer.from(r.CiphertextBlob).toString('base64');
      const [created] = await db
        .insert(sourceDekSchema)
        .values({
          orgId,
          kmsKeyArn: KEY_ARN,
          wrappedDek: wrapped,
          algorithm: 'AES_256_GCM',
          rotatedAt: new Date(),
        })
        .returning({ id: sourceDekSchema.id });
      dekCache.set(created!.id, { key: Buffer.from(r.Plaintext), cachedAt: Date.now() });
      return created!.id;
    },
  };
}

/** Used by tests to drop the in-memory cache. */
export function resetKmsCache(): void {
  dekCache.clear();
}
