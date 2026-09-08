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
 *
 * With the variable unset, a development run falls back to an ephemeral key so
 * that losing a credential costs no more than a re-paste. Production gets no
 * such fallback: it throws instead, because a per-process key silently destroys
 * every credential stored under the previous one.
 */

import type { CredentialVault, EncryptResult } from './credentialVault';
import { Buffer } from 'node:buffer';
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
    if (process.env.NODE_ENV === 'production') {
      // An ephemeral key in production is silent data loss: each process start
      // mints a different one, so anything stored under the previous key could
      // never be decrypted again. Fail every credential read and write instead,
      // which is recoverable — a key that no longer exists is not.
      throw new Error(
        'VOCION_CREDENTIAL_VAULT_KEY is not set. The local credential vault will not generate '
        + 'an ephemeral key in production: every process start would mint a different one, and '
        + 'credentials stored under the previous key could never be decrypted again. Set '
        + 'VOCION_CREDENTIAL_VAULT_KEY to 32 base64-encoded random bytes '
        + `(node -e "console.log(require('crypto').randomBytes(${AES_KEY_BYTES}).toString('base64'))"), `
        + 'or move to AWS KMS with VOCION_CREDENTIAL_VAULT=kms and VOCION_KMS_KEY_ARN.',
      );
    }
    // Development only: an ephemeral key costs a re-paste, not stored data.
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
      try {
        return aesDecrypt(
          key,
          Buffer.from(ciphertext, 'base64'),
          Buffer.from(nonce, 'base64'),
          Buffer.from(authTag, 'base64'),
        );
      } catch (error) {
        // Node says "Unsupported state or unable to authenticate data", which
        // tells the reader nothing. With no VOCION_CREDENTIAL_VAULT_KEY set,
        // every restart mints a new ephemeral key, so credentials saved before
        // the restart cannot be read — the one cause worth naming, since the
        // fix (set the key, then reconnect) is not guessable from the original.
        throw new Error(
          'The stored credential could not be decrypted with the current vault key. '
          + 'If VOCION_CREDENTIAL_VAULT_KEY is unset, each restart generates a new key and '
          + 'credentials saved earlier become unreadable: set it in .env.local, then reconnect '
          + `this source's credential. (${error instanceof Error ? error.message : String(error)})`,
        );
      }
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
