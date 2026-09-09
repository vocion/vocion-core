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
 * such fallback: building the vault throws instead, because a per-process key
 * silently destroys every credential stored under the previous one. Nothing
 * builds a vault at boot, so that throw surfaces on the first request that
 * touches a credential, not at startup.
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
  VaultDecryptionError,
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
/**
 * Whether the key in `_master` came from the environment or was minted here.
 *
 * Recorded when the key is read, because that is what `decrypt` needs to name
 * the right cause. Re-reading the variable at failure time would describe the
 * environment as it is now, not the key the ciphertext was actually opened
 * with — a variable set after this process started would make an ephemeral-key
 * failure look like a changed value.
 */
let masterKeyCameFromEnvironment = false;

function masterKey(): Buffer {
  if (!_master) {
    masterKeyCameFromEnvironment = Boolean(process.env.VOCION_CREDENTIAL_VAULT_KEY);
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
  // Read the key when the vault is built rather than on the first encrypt or
  // decrypt, which is where kmsVault's missing-ARN check already fires. Both
  // backends now reject a missing setting at the same boundary.
  //
  // This is not a startup check. Nothing builds a vault at boot — every caller
  // does it inside a function — so a deployment with no key still starts clean
  // and health-checks green, and the throw lands on the first request that
  // touches a credential. Making it a boot failure would need an explicit call
  // from `instrumentation.ts`.
  masterKey();
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
        // tells the reader nothing. What it means is that this credential was
        // stored under a different key than the one this process holds, and the
        // fix is not guessable from the original.
        //
        // Which key changed depends on where this runs. Development can reach
        // here with VOCION_CREDENTIAL_VAULT_KEY unset, because every restart
        // then mints a new ephemeral key. Production cannot: an unset key throws
        // before any ciphertext is touched, so here it means the variable's own
        // value changed. Naming only the development cause would send an
        // on-call reader looking for a variable that is already set.
        //
        // `VaultDecryptionError` rather than a plain `Error` so the routes that
        // otherwise flatten vault failures into "Could not read that key." show
        // this sentence instead. It names an env var and a next step and no
        // secret. Node's own wording goes in `cause`, where the log picks it up
        // and the dashboard does not: it tells the reader nothing they can act
        // on, and vouching for a string this code did not write is exactly what
        // the flattening rule exists to prevent.
        // The fix differs with the cause. A key that was never set has no
        // previous value to restore, so telling that reader to put one back
        // sends them looking for something that never existed.
        const explanation = masterKeyCameFromEnvironment
          ? 'The value of VOCION_CREDENTIAL_VAULT_KEY has changed since this credential was saved: '
          + 'set it back to the value it had, or reconnect this source\'s credential under the '
          + 'current key.'
          : 'VOCION_CREDENTIAL_VAULT_KEY is unset, so every restart mints a new ephemeral key: set '
            + 'it to a fixed value, then reconnect this source\'s credential.';
        throw new VaultDecryptionError(
          `The stored credential could not be decrypted with the current vault key. ${explanation}`,
          { cause: error },
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
