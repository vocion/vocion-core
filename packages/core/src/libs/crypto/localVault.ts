/**
 * localVault — dev-mode CredentialVault.
 *
 * Single master key sourced from `VOCION_CREDENTIAL_VAULT_KEY`
 * (base64-encoded 32 bytes). Each `source_dek` row stores that key
 * directly. Convenient for local dev + tests; not safe for prod.
 *
 * Generate a key:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Then set `VOCION_CREDENTIAL_VAULT_KEY=...` in `.env.local`.
 */

import type { CredentialVault, EncryptResult } from './credentialVault';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceDekSchema } from '@/models/Schema';
import {
  AES_KEY_BYTES,
  aesDecrypt,
  aesEncrypt,

} from './credentialVault';

function readMasterKey(): Buffer {
  const raw = process.env.VOCION_CREDENTIAL_VAULT_KEY;
  if (!raw) {
    // Generate an ephemeral key. Loud — dev-only.

    console.warn(
      '[localVault] VOCION_CREDENTIAL_VAULT_KEY is not set; generating an ephemeral key for THIS PROCESS only. Credentials stored now will be unreadable after restart.',
    );
    return randomBytes(AES_KEY_BYTES);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`VOCION_CREDENTIAL_VAULT_KEY must decode to ${AES_KEY_BYTES} bytes; got ${key.length}`);
  }
  return key;
}

let _master: Buffer | null = null;
function masterKey(): Buffer {
  if (!_master) {
    _master = readMasterKey();
  }
  return _master;
}

async function getOrCreateActiveDek(orgId: string): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: sourceDekSchema.id })
    .from(sourceDekSchema)
    .where(eq(sourceDekSchema.orgId, orgId))
    .orderBy(desc(sourceDekSchema.createdAt))
    .limit(1);
  if (existing) {
    return existing;
  }
  // In localVault every DEK row points at the same master key, but
  // we store the key once per org so the row exists for FK + audit.
  const [created] = await db
    .insert(sourceDekSchema)
    .values({
      orgId,
      kmsKeyArn: null,
      wrappedDek: masterKey().toString('base64'),
      algorithm: 'AES_256_GCM',
    })
    .returning({ id: sourceDekSchema.id });
  return created!;
}

async function getDek(_orgId: string, _dekId: number): Promise<Buffer> {
  // localVault: every DEK resolves to the same master key.
  return masterKey();
}

export function localVault(): CredentialVault {
  return {
    kind: 'local',
    async encrypt(orgId: string, plaintext: Buffer): Promise<EncryptResult> {
      const dek = await getOrCreateActiveDek(orgId);
      const key = await getDek(orgId, dek.id);
      const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
      return {
        ciphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
        dekId: dek.id,
      };
    },
    async decrypt(orgId, ciphertext, nonce, authTag, dekId) {
      const key = await getDek(orgId, dekId);
      return aesDecrypt(
        key,
        Buffer.from(ciphertext, 'base64'),
        Buffer.from(nonce, 'base64'),
        Buffer.from(authTag, 'base64'),
      );
    },
    async rotateDek(orgId: string): Promise<number> {
      // In localVault all DEKs resolve to the same master key; we
      // still create a fresh row so the audit trail reflects the
      // rotation.
      const [created] = await db
        .insert(sourceDekSchema)
        .values({
          orgId,
          kmsKeyArn: null,
          wrappedDek: masterKey().toString('base64'),
          algorithm: 'AES_256_GCM',
          rotatedAt: new Date(),
        })
        .returning({ id: sourceDekSchema.id });
      return created!.id;
    },
  };
}
