/**
 * Two things the local vault has to get right about its master key.
 *
 * 1. It refuses to mint an ephemeral key in production. A deployment without
 *    VOCION_CREDENTIAL_VAULT_KEY left two stored credentials permanently
 *    unreadable, signalled only by one startup warning.
 *
 * 2. The message when it cannot read a credential. Node's "Unsupported state
 *    or unable to authenticate data" reached the operator verbatim through a
 *    failed source sync on 2026-08-31, naming neither cause nor fix. Which key
 *    changed depends on the environment, so the message must name the right
 *    one.
 *
 * `decrypt` never touches the database here — every DEK resolves to the master
 * key — so these are unit tests with no DB stub.
 */

import type { Buffer } from 'node:buffer';
import type { CredentialVault } from './credentialVault';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AES_KEY_BYTES } from './credentialVault';

const KEY = randomBytes(AES_KEY_BYTES).toString('base64');

/**
 * Ask the vault to read a credential it has no hope of decrypting.
 *
 * The ciphertext is random, so this is the same failure a credential saved
 * under a different key gives: the key reads fine, the auth tag does not
 * verify.
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

/**
 * Silence and capture the ephemeral-key warning.
 *
 * Building a vault with no key set warns on purpose, which would otherwise
 * print through the test run.
 */
function captureWarnings() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('localVault master key', () => {
  it('refuses to build in production without VOCION_CREDENTIAL_VAULT_KEY', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const { localVault } = await import('./localVault');

    expect(() => localVault()).toThrow(/VOCION_CREDENTIAL_VAULT_KEY is not set/);
  });

  it('tells the operator in production why an ephemeral key is not an option', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const { localVault } = await import('./localVault');

    expect(() => localVault()).toThrow(
      /could never be decrypted again[\s\S]*VOCION_KMS_KEY_ARN/,
    );
  });

  it('still mints an ephemeral key outside production, and warns while it does', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    const warn = captureWarnings();
    const { localVault } = await import('./localVault');

    expect(() => localVault()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ephemeral key'));
  });

  it('treats an unset NODE_ENV as development, not production', async () => {
    // Nothing sets NODE_ENV in a plain `tsx` script or a container that never
    // declares it. Only the explicit production value locks the vault down.
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', undefined);
    const warn = captureWarnings();
    const { localVault } = await import('./localVault');

    expect(() => localVault()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ephemeral key'));
  });

  it('rejects a key that does not decode to 32 bytes', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(16).toString('base64'));
    const { localVault } = await import('./localVault');

    expect(() => localVault()).toThrow(
      /VOCION_CREDENTIAL_VAULT_KEY must decode to 32 bytes; got 16/,
    );
  });

  it('builds in production once a well-formed key is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { localVault } = await import('./localVault');

    expect(() => localVault()).not.toThrow();
  });
});

describe('localVault decrypt', () => {
  it('names the vault key and the fix when the ciphertext will not authenticate', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /could not be decrypted with the current vault key/,
    );
  });

  it('keeps Node\'s own reason on the cause, for anyone debugging deeper', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    // On `cause`, not in the message: the routes show the message to whoever
    // clicked, and Node's wording is for the log.
    let failure: Error | undefined;
    try {
      await readAnyCredential(vault);
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).not.toMatch(/unable to authenticate data|Unsupported state/);
    expect((failure?.cause as Error).message).toMatch(/unable to authenticate data|Unsupported state/);
  });

  it('throws the type that marks a message as safe to show', async () => {
    // Imported here rather than at the top of the file: `vi.resetModules()`
    // gives each test a fresh module registry, and a class from the outer
    // registry is a different class from the one this vault throws.
    const { localVault } = await import('./localVault');
    const { VaultDecryptionError } = await import('./credentialVault');
    const vault = localVault();

    // The routes decide whether to show a vault error by its type, not by
    // reading the string, so the type is the load-bearing part of this throw.
    await expect(readAnyCredential(vault)).rejects.toBeInstanceOf(VaultDecryptionError);
  });

  it('says to restore the old key value or reconnect the source', async () => {
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /VOCION_CREDENTIAL_VAULT_KEY[\s\S]*reconnect/,
    );
  });

  it('blames a changed key value when a key is set', async () => {
    // The only way production reaches this failure: the variable is set, but to
    // something other than what the credential was stored under. Pointing an
    // on-call reader at an unset variable would send them looking for a
    // variable that is already there.
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /has changed since this credential was saved/,
    );
  });

  it('blames the ephemeral key when no key is set', async () => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    captureWarnings();
    const { localVault } = await import('./localVault');
    const vault = localVault();

    await expect(readAnyCredential(vault)).rejects.toThrow(
      /is unset, so every restart mints a new ephemeral key/,
    );
  });
});
