/**
 * The GitHub App's own credentials: the JWT it signs with, the installation
 * tokens it mints, and the cache that keeps a poll from minting per request.
 * A real RSA pair is generated per run so the signature is verified, not
 * eyeballed.
 */

import { Buffer } from 'node:buffer';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfigured, appJwt, clearInstallationTokenCache, githubAppConfig, installationIdFrom, installationToken } from './app';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function base64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

beforeEach(() => {
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_SLUG = 'vocion-agents';
  process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(PEM).toString('base64');
  process.env.GITHUB_APP_CLIENT_ID = 'Iv1.client';
  process.env.GITHUB_APP_CLIENT_SECRET = 'client-secret';
  clearInstallationTokenCache();
});

afterEach(() => {
  for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_BASE64', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']) {
    delete process.env[name];
  }
  vi.unstubAllGlobals();
});

describe('githubAppConfig', () => {
  it('is null when any of the three env vars is missing or the key is not a PEM', () => {
    expect(appConfigured()).toBe(true);

    delete process.env.GITHUB_APP_SLUG;

    expect(githubAppConfig()).toBeNull();

    process.env.GITHUB_APP_SLUG = 'vocion-agents';
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from('not a key').toString('base64');

    expect(appConfigured()).toBe(false);
  });
});

describe('appJwt', () => {
  it('signs RS256 over iat-60 / exp+540 / iss=app id, verifiable with the public key', () => {
    const jwt = appJwt(githubAppConfig(), 1_700_000_000);
    const [header, payload, signature] = jwt.split('.') as [string, string, string];

    expect(JSON.parse(base64urlDecode(header))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(base64urlDecode(payload))).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: '12345' });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);

    expect(verifier.verify(publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))).toBe(true);
  });

  it('refuses without configuration, naming the env vars and never the key', () => {
    delete process.env.GITHUB_APP_ID;

    expect(() => appJwt(githubAppConfig())).toThrow(/GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY_BASE64, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET/);
  });
});

describe('installationToken', () => {
  it('mints once per installation and reuses the token until five minutes before expiry', async () => {
    const now = Date.parse('2026-09-30T10:00:00Z');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'ghs_one', expires_at: '2026-09-30T11:00:00Z' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await installationToken('777', { now })).toBe('ghs_one');
    expect(await installationToken('777', { now: now + 30 * 60_000 })).toBe('ghs_one');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.github.com/app/installations/777/access_tokens');
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer ey/);

    await installationToken('777', { now: now + 56 * 60_000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps installations apart and surfaces a refused mint without the JWT', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/1/')
      ? new Response(JSON.stringify({ token: 'ghs_a', expires_at: '2026-09-30T11:00:00Z' }), { status: 201 })
      : new Response('{"message":"Bad credentials"}', { status: 401 }))));

    expect(await installationToken('1', { now: Date.parse('2026-09-30T10:00:00Z') })).toBe('ghs_a');
    await expect(installationToken('2')).rejects.toThrow(/installation 2 \(401\)/);
    await expect(installationToken('2')).rejects.not.toThrow(/Bearer/);
  });
});

describe('installationToken on GitHub Enterprise', () => {
  it('mints against the given host and caches per host, so two hosts never share a token', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ token: url.includes('ghe.example') ? 'ghs_ghe' : 'ghs_com', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await installationToken('7', { baseUrl: 'https://ghe.example/api/v3/' })).toBe('ghs_ghe');
    expect(await installationToken('7')).toBe('ghs_com');
    expect(await installationToken('7', { baseUrl: 'https://ghe.example/api/v3' })).toBe('ghs_ghe');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://ghe.example/api/v3/app/installations/7/access_tokens');
  });
});

describe('installationIdFrom', () => {
  it('reads a string or numeric id and nothing else', () => {
    expect(installationIdFrom({ installationId: ' 42 ' })).toBe('42');
    expect(installationIdFrom({ installationId: 42 })).toBe('42');
    expect(installationIdFrom({ token: 'ghp_x' })).toBeUndefined();
    expect(installationIdFrom(undefined)).toBeUndefined();
  });
});
