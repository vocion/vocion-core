import type { Buffer } from 'node:buffer';
/**
 * Two things the local vault has to get right about its master key.
 *
 * 1. The message it gives when it cannot read a stored credential. Node's own
 *    AES-GCM failure is "Unsupported state or unable to authenticate data",
 *    which reached the operator verbatim through a failed source sync on
 *    2026-08-31 and named neither the cause nor the fix. `decrypt` has to
 *    explain the one cause that actually happens in local dev: no
 *    VOCION_CREDENTIAL_VAULT_KEY, so every restart mints a new ephemeral key
 *    and anything saved before it is unreadable.
 *
 * 2. That it refuses to mint an ephemeral key in production at all. A
 *    deployment running without the variable set left two stored credentials
 *    permanently unreadable, and the only signal was a single startup warning.
 *
 * `decrypt` never touches the database in localVault — every DEK resolves to the
 * master key — so these are unit tests with no DB stub.
 */
import type { CredentialVault } from './credentialVault';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AES_KEY_BYTES } from './credentialVault';

const KEY = randomBytes(AES_KEY_BYTES).toString('base64');

/**
 * Ask the vault to read a credential it has no hope of decrypting.
 *
 * Reading the master key happens before the ciphertext is touched, so whatever
 * this rejects with tells us which of the two failures we are looking at: a
 * master-key complaint, or the ordinary "does not authenticate".
 * @param vault - Vault under test.
 */
function readAnyCredential(vault: CredentialVault): Promise<Buffer> {
  return vault.decrypt(
    'org1',
    randomBytes(32).toString('base64'),
    randomBytes(12).toString('base64'),
    randomBytes(16).toString('base64'),
    1,
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('localVault decrypt', () => {
  it('names the vault key and the fix when the ciphertext will not authenticate', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    // Ciphertext this key never produced — the same failure a credential saved
    // under a previous ephemeral key gives.
    await expect(readAnyCredential(vault)).rejects.toThrow(
      /could not be decrypted with the current vault key/,
    );
  });

  it('keeps Node\'s own reason in the message, for anyone debugging deeper', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /unable to authenticate data|Unsupported state/,
    );
  });

  it('says to set VOCION_CREDENTIAL_VAULT_KEY and reconnect', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /VOCION_CREDENTIAL_VAULT_KEY[\s\S]*reconnect/,
    );
  });
});

describe('localVault master key', () => {
  it('refuses to run in production without VOCION_CREDENTIAL_VAULT_KEY', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /VOCION_CREDENTIAL_VAULT_KEY is not set/,
    );
  });

  it('tells the operator in production why an ephemeral key is not an option', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /could never be decrypted again[\s\S]*VOCION_KMS_KEY_ARN/,
    );
  });

  it('still mints an ephemeral key outside production, and warns while it does', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { localVault } = await import('./localVault');
    const vault = localVault();

    // The ephemeral key exists, so the failure is the ordinary "this ciphertext
    // does not authenticate", not the production refusal.
    await expect(readAnyCredential(vault)).rejects.toThrow(
      /could not be decrypted with the current vault key/,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ephemeral key'));

    warn.mockRestore();
  });

  it('rejects a key that does not decode to 32 bytes', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(16).toString('base64'));
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /VOCION_CREDENTIAL_VAULT_KEY must decode to 32 bytes; got 16/,
    );
  });

  it('accepts a well-formed key in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { localVault } = await import('./localVault');
    const vault = localVault();

    // The key reads fine, so the only complaint left is the ciphertext.
    await expect(readAnyCredential(vault)).rejects.toThrow(
      /could not be decrypted with the current vault key/,
    );
  });
});
