/**
 * The KMS branch of buildCredentialVault.
 *
 * Regression: the factory loaded kmsVault with a synchronous `require()`.
 * kmsVault imports the database module, which the production bundle treats as
 * an async module, so the require returned a pending namespace and every
 * decrypt on a KMS install threw "t is not a function" — the calendar tool,
 * source sync, anything that reads a credential. These tests pin the factory
 * to an awaited import and to delegating every call.
 */

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inner = {
  kind: 'kms' as const,
  encrypt: vi.fn(async () => ({ ciphertext: 'c', nonce: 'n', authTag: 't', dekId: 7 })),
  decrypt: vi.fn(async () => Buffer.from('{"ok":true}')),
  rotateDek: vi.fn(async () => 8),
};
const factory = vi.fn(() => inner);

vi.mock('./kmsVault', () => ({ kmsVault: factory }));

const { buildCredentialVault, resetCredentialVault } = await import('./credentialVault');

describe('buildCredentialVault with VOCION_CREDENTIAL_VAULT=kms', () => {
  beforeEach(() => {
    vi.stubEnv('VOCION_CREDENTIAL_VAULT', 'kms');
    vi.stubEnv('VOCION_KMS_KEY_ARN', 'arn:aws:kms:us-east-1:000000000000:key/example');
    resetCredentialVault();
    factory.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCredentialVault();
  });

  it('returns a vault whose decrypt reaches the KMS implementation', async () => {
    const vault = buildCredentialVault();

    expect(vault.kind).toBe('kms');

    const out = await vault.decrypt('org_example', 'c', 'n', 't', 7);

    expect(out.toString('utf8')).toBe('{"ok":true}');
    expect(inner.decrypt).toHaveBeenCalledWith('org_example', 'c', 'n', 't', 7);
    expect(factory).toHaveBeenCalledWith({ kmsKeyArn: 'arn:aws:kms:us-east-1:000000000000:key/example' });
  });

  it('builds the KMS implementation once across calls', async () => {
    const vault = buildCredentialVault();
    await vault.encrypt('org_example', Buffer.from('x'));
    await vault.decrypt('org_example', 'c', 'n', 't', 7);
    await vault.rotateDek?.('org_example');

    expect(factory).toHaveBeenCalledTimes(1);
    expect(inner.rotateDek).toHaveBeenCalledWith('org_example');
  });

  it('never loads kmsVault with a synchronous require', () => {
    // A sync require of an async module is the exact failure; keep it out.
    const src = readFileSync(path.join(__dirname, 'credentialVault.ts'), 'utf8');

    expect(src).not.toMatch(/require\(\s*['"]\.\/kmsVault['"]\s*\)/);
  });
});
