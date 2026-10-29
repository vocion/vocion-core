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
import { appConfigured, appJwt, clearInstallationTokenCache, githubAppConfig, installationIdFrom, installationToken, legacyInstallationNote } from './app';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

vi.mock('@/libs/Logger', () => ({ logger: { info: vi.fn() } }));

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
  for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_BASE64', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_LEGACY_APP_ID', 'GITHUB_LEGACY_APP_SLUG', 'GITHUB_LEGACY_APP_PRIVATE_KEY_BASE64']) {
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

describe('installationToken with a legacy GitHub App', () => {
  // The app id a request's JWT was signed for.
  function issuer(init?: RequestInit): string {
    const jwt = String((init?.headers as Record<string, string>).authorization).replace(/^Bearer /, '');
    return JSON.parse(base64urlDecode(jwt.split('.')[1]!)).iss;
  }

  // Primary app 12345 owns `primary`; legacy app 999 owns `legacy`; every other pair is GitHub's 404.
  function github(owned: { primary?: string[]; legacy?: string[] }) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const id = /installations\/(\d+)/.exec(url)![1]!;
      const app = issuer(init);
      const owns = app === '12345' ? owned.primary?.includes(id) : owned.legacy?.includes(id);
      if (!owns) {
        return new Response('{"message":"Not Found"}', { status: 404 });
      }
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: `ghs_${app}_${id}`, expires_at: '2026-09-30T11:00:00Z' }), { status: 201 });
      }
      return new Response(JSON.stringify({ id: Number(id), account: { login: 'example-org' } }));
    });
  }

  function setLegacyApp(): void {
    process.env.GITHUB_LEGACY_APP_ID = '999';
    process.env.GITHUB_LEGACY_APP_SLUG = 'vocion-agents-old';
    process.env.GITHUB_LEGACY_APP_PRIVATE_KEY_BASE64 = Buffer.from(PEM).toString('base64');
  }

  const now = Date.parse('2026-09-30T10:00:00Z');

  it('uses the current app alone when it owns the installation', async () => {
    setLegacyApp();
    const fetchMock = github({ primary: ['777'], legacy: ['777'] });
    vi.stubGlobal('fetch', fetchMock);

    expect(await installationToken('777', { now })).toBe('ghs_12345_777');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(legacyInstallationNote('777')).toBeNull();
  });

  it('falls back to the legacy app on a 404, logs once, and goes straight to it on the next mint', async () => {
    setLegacyApp();
    const fetchMock = github({ legacy: ['555'] });
    vi.stubGlobal('fetch', fetchMock);
    const { logger } = await import('@/libs/Logger');
    vi.mocked(logger.info).mockClear();

    expect(await installationToken('555', { now })).toBe('ghs_999_555');
    expect(fetchMock.mock.calls.map(([url, init]) => `${issuer(init)} ${url}`)).toEqual([
      '12345 https://api.github.com/app/installations/555/access_tokens',
      '999 https://api.github.com/app/installations/555/access_tokens',
      '999 https://api.github.com/app/installations/555',
    ]);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.info).mock.calls[0]![0]).toBe('installation 555 served by the legacy GitHub App; reinstall the current app on example-org to retire it');
    expect(legacyInstallationNote('555')).toMatch(/earlier GitHub App \(vocion-agents-old\).*reinstall the current app on example-org/);

    fetchMock.mockClear();

    // Past the cached token's refresh margin: a fresh mint, from the legacy app only.
    expect(await installationToken('555', { now: now + 56 * 60_000 })).toBe('ghs_999_555');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(issuer(fetchMock.mock.calls[0]![1])).toBe('999');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('reports the current app\'s error when neither app owns the installation', async () => {
    setLegacyApp();
    vi.stubGlobal('fetch', github({}));

    await expect(installationToken('404', { now })).rejects.toThrow('GitHub refused to mint a token for installation 404 (404): {"message":"Not Found"}');
    expect(legacyInstallationNote('404')).toBeNull();
  });

  it('does not try a legacy app on errors other than 404', async () => {
    setLegacyApp();
    const fetchMock = vi.fn(async () => new Response('{"message":"Bad credentials"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(installationToken('777', { now })).rejects.toThrow(/installation 777 \(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('without a legacy app, a 404 is the error it always was, after one request', async () => {
    const fetchMock = github({ legacy: ['555'] });
    vi.stubGlobal('fetch', fetchMock);

    await expect(installationToken('555', { now })).rejects.toThrow('GitHub refused to mint a token for installation 555 (404): {"message":"Not Found"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(legacyInstallationNote('555')).toBeNull();
  });
});
