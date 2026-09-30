/**
 * The app's JWT is a real RS256 signature GitHub can verify with the app's
 * public key, and an installation token is asked for with exactly the
 * repositories and permissions the caller named. Fixture keys are generated
 * per run; nothing here is a real credential.
 */
import { Buffer } from 'node:buffer';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { appJwt, mintInstallationToken, permissionsForTier } from './appAuth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

describe('appJwt', () => {
  it('signs RS256 over header.payload, issued a minute back and expiring inside ten minutes', () => {
    const jwt = appJwt({ appId: 424242, privateKey, now: 1_800_000_000 });
    const [h, p, sig] = jwt.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);

    expect(verifier.verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: '424242' });
  });
});

describe('permissionsForTier', () => {
  it('adds workflows: write only at the pipeline tier', () => {
    expect(permissionsForTier('base').workflows).toBeUndefined();
    expect(permissionsForTier('base')).toMatchObject({ contents: 'write', pull_requests: 'write', actions: 'write', checks: 'read', metadata: 'read' });
    expect(permissionsForTier('pipeline').workflows).toBe('write');
  });
});

describe('mintInstallationToken', () => {
  it('asks for the named repositories and permissions with the app JWT, and reads the token back', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      token: 'ghs_fixture',
      expires_at: '2026-10-01T01:00:00Z',
      permissions: { contents: 'write' },
      repositories: [{ full_name: 'northwind/orders-api' }],
    }), { status: 201 }));
    const out = await mintInstallationToken({ appId: 7, privateKey, installationId: 99, permissions: { contents: 'write' }, repositories: ['orders-api'], fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(out).toMatchObject({ ok: true, token: 'ghs_fixture', repositories: ['northwind/orders-api'] });

    const [url, init] = fetchImpl.mock.calls[0]!;

    expect(url).toBe('https://api.github.com/app/installations/99/access_tokens');
    expect(JSON.parse(String(init!.body))).toEqual({ permissions: { contents: 'write' }, repositories: ['orders-api'] });
    expect(String((init!.headers as Record<string, string>).authorization)).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('says a 422 is a permission the installation was never granted: an upgrade, not a retry', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'The permissions requested are not granted to this installation.' }), { status: 422 }));
    const out = await mintInstallationToken({ appId: 7, privateKey, installationId: 99, permissions: { workflows: 'write' }, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(out).toMatchObject({ ok: false, status: 422, needsUpgrade: true });
    expect(out.ok ? '' : out.message).toContain('not granted');
  });
});
