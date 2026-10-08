/**
 * The client fingerprint: keyed hashes, never the values, nothing at all
 * without a key to hash under, and never the same hash in two workspaces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientOf, hashClientValue } from './client';

const ORG = 'proj_client_northwind';
const OTHER = 'proj_client_kestrel';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hashClientValue', () => {
  it('is stable under one key and different under another — so it cannot be looked up without the secret', () => {
    vi.stubEnv('AUTH_SECRET', 'first-secret-first-secret-first-secret');
    const a = hashClientValue('ip', '203.0.113.7', ORG);

    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(hashClientValue('ip', '203.0.113.7', ORG)).toBe(a);
    // The same string as an address and as an agent never collide.
    expect(hashClientValue('ua', '203.0.113.7', ORG)).not.toBe(a);

    vi.stubEnv('AUTH_SECRET', 'second-secret-second-secret-second');

    expect(hashClientValue('ip', '203.0.113.7', ORG)).not.toBe(a);
  });

  it('hashes the same machine differently in every workspace, so two tenants\' logs cannot be joined on it', () => {
    vi.stubEnv('AUTH_SECRET', 'first-secret-first-secret-first-secret');

    expect(hashClientValue('ip', '203.0.113.7', ORG)).not.toBe(hashClientValue('ip', '203.0.113.7', OTHER));
    expect(hashClientValue('ua', 'Example/1.0', ORG)).not.toBe(hashClientValue('ua', 'Example/1.0', OTHER));
  });

  it('stores nothing rather than an invertible or unscoped hash', () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('VOCION_TOOL_SIGNING_SECRET', '');

    expect(hashClientValue('ip', '203.0.113.7', ORG)).toBeNull();

    vi.stubEnv('AUTH_SECRET', 'first-secret-first-secret-first-secret');

    expect(hashClientValue('ip', '203.0.113.7', '')).toBeNull();
  });
});

describe('clientOf', () => {
  it('reads the first hop a proxy recorded, else x-real-ip', () => {
    vi.stubEnv('AUTH_SECRET', 'first-secret-first-secret-first-secret');
    const forwarded = clientOf(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Example/1.0' }), ORG);
    const direct = clientOf(new Headers({ 'x-real-ip': '203.0.113.7' }), ORG);

    expect(forwarded?.ipHash).toBe(hashClientValue('ip', '203.0.113.7', ORG));
    expect(forwarded?.uaHash).toBe(hashClientValue('ua', 'Example/1.0', ORG));
    expect(direct?.ipHash).toBe(forwarded?.ipHash);
    expect(direct?.uaHash).toBeNull();
  });

  it('is null outside a request or with nothing to hash', () => {
    vi.stubEnv('AUTH_SECRET', 'first-secret-first-secret-first-secret');

    expect(clientOf(null, ORG)).toBeNull();
    expect(clientOf(new Headers(), ORG)).toBeNull();
  });
});
