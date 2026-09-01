/**
 * The message a local vault gives when it cannot read a stored credential.
 *
 * Node's own AES-GCM failure is "Unsupported state or unable to authenticate
 * data", which reached the operator verbatim through a failed source sync on
 * 2026-08-31 and named neither the cause nor the fix. `decrypt` has to explain
 * the one cause that actually happens in local dev: no
 * VOCION_CREDENTIAL_VAULT_KEY, so every restart mints a new ephemeral key and
 * anything saved before it is unreadable.
 *
 * `decrypt` never touches the database in localVault — every DEK resolves to the
 * master key — so these are unit tests with no DB stub.
 */
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AES_KEY_BYTES } from './credentialVault';

const KEY = randomBytes(AES_KEY_BYTES).toString('base64');

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', KEY);
});

describe('localVault decrypt', () => {
  it('names the vault key and the fix when the ciphertext will not authenticate', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();
    // Ciphertext this key never produced — the same failure a credential saved
    // under a previous ephemeral key gives.
    const rubbish = randomBytes(32).toString('base64');

    await expect(
      vault.decrypt('org1', rubbish, randomBytes(12).toString('base64'), randomBytes(16).toString('base64'), 1),
    ).rejects.toThrow(/could not be decrypted with the current vault key/);
  });

  it('keeps Node\'s own reason in the message, for anyone debugging deeper', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(
      vault.decrypt('org1', randomBytes(32).toString('base64'), randomBytes(12).toString('base64'), randomBytes(16).toString('base64'), 1),
    ).rejects.toThrow(/unable to authenticate data|Unsupported state/);
  });

  it('says to set VOCION_CREDENTIAL_VAULT_KEY and reconnect', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(
      vault.decrypt('org1', randomBytes(32).toString('base64'), randomBytes(12).toString('base64'), randomBytes(16).toString('base64'), 1),
    ).rejects.toThrow(/VOCION_CREDENTIAL_VAULT_KEY[\s\S]*reconnect/);
  });
});
