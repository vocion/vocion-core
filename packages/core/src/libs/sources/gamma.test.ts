import { describe, expect, it, vi } from 'vitest';
import { createGeneration } from '@/libs/gamma/client';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { gammaConnector, inspectGamma } from '@/libs/sources/gamma';
import { getConnector } from '@/libs/sources/registry';

/** Gamma against a stand-in: the header it sends, the themes read, a deck started. The key is a fixture. */

const KEY = 'sk-gamma-fixture-northwind-0001';

function net(routes: Record<string, { status?: number; json?: unknown }>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    seen.push({ url: input, init });
    const r = routes[new URL(input).pathname] ?? { status: 404, json: { message: 'not found' } };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe('the gamma connector', () => {
  it('is a sync-less API-key connector on its own platform', () => {
    expect(getConnector('gamma')).toBe(gammaConnector);
    expect(gammaConnector).toMatchObject({ authKind: 'apikey', syncless: true });
    expect(platformForConnectorSlug('gamma')?.id).toBe('gamma');
  });

  it('tests the connection by reading themes, with the key in X-API-KEY, for free', async () => {
    const { fetchImpl, seen } = net({ '/v1.0/themes': { json: { data: [{ id: 'th_1', name: 'Kestrel Dark' }, { id: 'th_2', name: 'Contoso Light' }] } } });
    const res = await inspectGamma({ credentials: { apiKey: KEY } }, fetchImpl);

    expect(res).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(res.checks[0]!.detail).toBe('2 themes: Kestrel Dark, Contoso Light');
    expect(new Headers(seen[0]!.init?.headers).get('x-api-key')).toBe(KEY);
    expect(seen.every(s => (s.init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('fails a refused key with the fix, and asks for one before calling out', async () => {
    const { fetchImpl } = net({ '/v1.0/themes': { status: 401, json: { message: 'Invalid API key' } } });

    await expect(inspectGamma({ credentials: { apiKey: KEY } }, fetchImpl)).resolves.toMatchObject({ authorized: false, error: expect.stringMatching(/refused the API key/) });
    await expect(inspectGamma({ credentials: {} })).rejects.toThrow(/No Gamma API key/);
  });

  it('starts a deck with what was asked', async () => {
    const { fetchImpl, seen } = net({ '/v1.0/generations': { json: { generationId: 'gen_1' } } });

    await expect(createGeneration(KEY, { inputText: 'Q3 review for Northwind', numCards: 8, additionalInstructions: 'for the board' }, fetchImpl)).resolves.toEqual({ generationId: 'gen_1' });
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ inputText: 'Q3 review for Northwind', textMode: 'condense', format: 'presentation', numCards: 8, additionalInstructions: 'for the board' });
  });
});

describe('which Gamma key a deck spends', () => {
  it('uses each workspace\'s own key, then the server\'s', async () => {
    vi.resetModules();
    const keys: Record<string, string> = { org_a: 'sk-gamma-a-000000000000', org_b: 'sk-gamma-b-000000000000' };
    vi.doMock('@/services/ApiTokenService', () => ({ resolvePlatformKey: async (orgId: string, platform: string) => (platform === 'gamma' ? keys[orgId] ?? null : null) }));
    process.env.GAMMA_API_KEY = 'sk-gamma-server-0000000000';
    const { gammaKeyFor } = await import('@/libs/gamma/client');

    expect(await gammaKeyFor('org_a')).toBe(keys.org_a);
    expect(await gammaKeyFor('org_b')).toBe(keys.org_b);
    expect(await gammaKeyFor('org_c')).toBe('sk-gamma-server-0000000000');

    delete process.env.GAMMA_API_KEY;
    vi.doUnmock('@/services/ApiTokenService');
  });
});
