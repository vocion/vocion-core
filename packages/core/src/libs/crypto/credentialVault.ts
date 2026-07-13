/**
 * CredentialVault — encrypted-at-rest storage for source connector
 * credentials.
 *
 * Two implementations:
 *
 *   - `kmsVault`   — production. AWS KMS wraps a per-tenant data
 *                    encryption key (DEK); the DEK encrypts each
 *                    credential blob with AES-256-GCM. KMS unwrap
 *                    happens once per tenant per cache window
 *                    (15 minutes default); the DEK is held in
 *                    process memory only.
 *
 *   - `localVault` — dev. Uses a single master key from the env
 *                    var VOCION_CREDENTIAL_VAULT_KEY (base64, 32
 *                    bytes). Each `source_dek` row stores that key
 *                    directly. Loud warning if NODE_ENV=production
 *                    and KMS isn't configured.
 *
 * Factory `buildCredentialVault()` chooses based on
 * `VOCION_CREDENTIAL_VAULT`:
 *   - `kms` → kmsVault (requires `VOCION_KMS_KEY_ARN`)
 *   - anything else / unset → localVault
 *
 * Crypto choice: AES-256-GCM. 12-byte random nonce per encryption;
 * 16-byte auth tag stored separately. Nonces are never reused (we
 * generate from `crypto.randomBytes`).
 */

import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import process from 'node:process';
import { localVault } from './localVault';

export type EncryptResult = {
  ciphertext: string; // base64
  nonce: string; // base64, 12 bytes
  authTag: string; // base64, 16 bytes
  dekId: number;
};

export type CredentialVault = {
  /**
   * Encrypt `plaintext` for the given org. Returns the ciphertext
   * components + the dekId used (caller persists into source_credential).
   */
  encrypt: (orgId: string, plaintext: Buffer) => Promise<EncryptResult>;
  /** Reverse encrypt; pulls the DEK from source_dek by id. */
  decrypt: (orgId: string, ciphertext: string, nonce: string, authTag: string, dekId: number) => Promise<Buffer>;
  /** Hook for tests / dev — force-rotate the active DEK. Returns the new dek row id. */
  rotateDek?: (orgId: string) => Promise<number>;
  /** Identifier exposed for telemetry / audit; either `kms` or `local`. */
  readonly kind: 'kms' | 'local';
};

/** Stable AES-256-GCM parameters. */
export const AES_ALGORITHM = 'aes-256-gcm';
export const AES_KEY_BYTES = 32;
export const AES_NONCE_BYTES = 12;
export const AES_TAG_BYTES = 16;

/**
 * Low-level AES-GCM helper shared by both vault implementations.
 * `key` MUST be 32 bytes; throws otherwise.
 * @param key
 * @param plaintext
 */
export function aesEncrypt(key: Buffer, plaintext: Buffer): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`AES-256-GCM requires a ${AES_KEY_BYTES}-byte key; got ${key.length}`);
  }
  const nonce = randomBytes(AES_NONCE_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: enc, nonce, authTag: cipher.getAuthTag() };
}

export function aesDecrypt(key: Buffer, ciphertext: Buffer, nonce: Buffer, authTag: Buffer): Buffer {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`AES-256-GCM requires a ${AES_KEY_BYTES}-byte key; got ${key.length}`);
  }
  if (nonce.length !== AES_NONCE_BYTES) {
    throw new Error(`AES-256-GCM nonce must be ${AES_NONCE_BYTES} bytes`);
  }
  if (authTag.length !== AES_TAG_BYTES) {
    throw new Error(`AES-256-GCM auth tag must be ${AES_TAG_BYTES} bytes`);
  }
  const decipher = createDecipheriv(AES_ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

let _vault: CredentialVault | null = null;

export function buildCredentialVault(): CredentialVault {
  if (_vault) {
    return _vault;
  }
  const kind = (process.env.VOCION_CREDENTIAL_VAULT ?? '').toLowerCase();
  if (kind === 'kms') {
    if (!process.env.VOCION_KMS_KEY_ARN) {
      throw new Error('VOCION_CREDENTIAL_VAULT=kms requires VOCION_KMS_KEY_ARN to be set');
    }
    // Lazy-load to avoid pulling in @aws-sdk/client-kms unless needed.
    // eslint-disable-next-line ts/no-require-imports
    const { kmsVault } = require('./kmsVault') as typeof import('./kmsVault');
    _vault = kmsVault({ kmsKeyArn: process.env.VOCION_KMS_KEY_ARN });
    return _vault;
  }
  // Default to localVault. Warn in production.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[vault] WARNING: running in production without KMS. Set VOCION_CREDENTIAL_VAULT=kms + VOCION_KMS_KEY_ARN to use AWS KMS.',
    );
  }
  // Static import — a lazy `require()` here resolves to a namespace-wrapped
  // module under Turbopack's ESM server bundle ("localVault is not a
  // function"). localVault is dependency-light so eager loading is free;
  // only the KMS path (heavy AWS SDK) stays lazy.
  _vault = localVault();
  return _vault;
}

/** Test escape hatch. */
export function resetCredentialVault(): void {
  _vault = null;
}
