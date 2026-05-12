/**
 * Pure-crypto tests for the AES-GCM helpers. Vault-impl tests that
 * touch the DB live in an integration suite (require a running
 * Postgres); these are unit tests for the cipher layer only.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AES_KEY_BYTES, AES_NONCE_BYTES, AES_TAG_BYTES, aesDecrypt, aesEncrypt } from './credentialVault';

describe('aesEncrypt / aesDecrypt', () => {
  const key = randomBytes(AES_KEY_BYTES);
  const plaintext = Buffer.from('hunter2:refresh:abcdef1234567890', 'utf8');

  it('round-trips plaintext', () => {
    const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);

    expect(nonce.length).toBe(AES_NONCE_BYTES);
    expect(authTag.length).toBe(AES_TAG_BYTES);

    const decoded = aesDecrypt(key, ciphertext, nonce, authTag);

    expect(decoded.toString('utf8')).toBe(plaintext.toString('utf8'));
  });

  it('produces a different ciphertext + nonce on each call', () => {
    const a = aesEncrypt(key, plaintext);
    const b = aesEncrypt(key, plaintext);

    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('throws when key length is wrong', () => {
    const shortKey = randomBytes(16);

    expect(() => aesEncrypt(shortKey, plaintext)).toThrow(/32-byte key/);
  });

  it('rejects a tampered ciphertext', () => {
    const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
    const tampered = Buffer.from(ciphertext);
    tampered[0] = (tampered[0]! ^ 0xFF) & 0xFF;

    expect(() => aesDecrypt(key, tampered, nonce, authTag)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
    const tampered = Buffer.from(authTag);
    tampered[0] = (tampered[0]! ^ 0xFF) & 0xFF;

    expect(() => aesDecrypt(key, ciphertext, nonce, tampered)).toThrow();
  });

  it('rejects a wrong key', () => {
    const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
    const wrong = randomBytes(AES_KEY_BYTES);

    expect(() => aesDecrypt(wrong, ciphertext, nonce, authTag)).toThrow();
  });
});
