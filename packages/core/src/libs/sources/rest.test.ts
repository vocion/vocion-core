/**
 * The REST connector's Test connection: one GET to the health path, reported
 * as reachable / authorized / what the source declares, and a refusal at the
 * dialog for input it cannot work with. Registered, syncless, and paired
 * with an add-source form.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configFieldsFor } from './configFields';
import { InspectInputError } from './inspect';
import { getConnector } from './registry';
import { inspectRestApi, restConnector } from './rest';

const CREDS = { baseUrl: 'https://api.northwind.example', token: 'tok-fixture' };

function res(status: number, body: unknown): Response {
  return { ok: status < 300, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('registration', () => {
  it('is registered, syncless, on the apikey path, with a form that asks only for the two scalars', () => {
    expect(getConnector('rest')).toBe(restConnector);
    expect(restConnector.syncless).toBe(true);
    expect(restConnector.authKind).toBe('apikey');
    expect(configFieldsFor('rest').map(f => f.key)).toEqual(['toolPrefix', 'healthPath']);
  });

  it('syncs nothing', async () => {
    const docs = [];
    for await (const doc of restConnector.sync({ sourceId: 1, orgId: 'o', config: {} })) {
      docs.push(doc);
    }

    expect(docs).toEqual([]);
  });
});

describe('inspect', () => {
  it('GETs the declared health path with the token and reports success', async () => {
    const f = vi.fn(async () => res(200, { id: 1 }));
    vi.stubGlobal('fetch', f);
    const out = await inspectRestApi({ credentials: CREDS, config: { healthPath: '/api/users/me', toolPrefix: 'delivery', tools: [{ name: 'a', method: 'GET', path: '/a' }], actions: [] } });

    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://api.northwind.example/api/users/me');
    expect(out.reachable).toBe(true);
    expect(out.authorized).toBe(true);
    expect(out.checks.map(c => [c.key, c.ok])).toEqual([['reachable', true], ['auth', true], ['declared', true]]);
    expect(out.checks[2]!.detail).toContain('1 read tool (delivery_…) and 0 write actions');
    expect(out.note).toContain('Nothing was saved');
  });

  it('reports a refused token as reachable but not authorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: 'unauthorized' })));
    const out = await inspectRestApi({ credentials: CREDS, config: {} });

    expect(out.reachable).toBe(true);
    expect(out.authorized).toBe(false);
    expect(out.checks[1]!.detail).toMatch(/expired or lack the rights/);
  });

  it('reports an unreachable host as neither, with the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const out = await inspectRestApi({ credentials: CREDS, config: {} });

    expect(out.reachable).toBe(false);
    expect(out.authorized).toBe(false);
    expect(out.error).toContain('fetch failed');
  });

  it('refuses at the dialog without a base URL and a token', async () => {
    await expect(restConnector.inspect!({ config: {}, credentials: { baseUrl: 'api.example', token: 't' }, options: {} })).rejects.toBeInstanceOf(InspectInputError);
    await expect(restConnector.inspect!({ config: {}, credentials: { baseUrl: 'https://api.example' }, options: {} })).rejects.toThrow(/and a token are required/);
    await expect(restConnector.inspect!({ config: {}, credentials: { baseUrl: 'https://api.example', token: 't', headerName: 'Content-Type' }, options: {} })).rejects.toThrow(/header name/);
  });

  it('tests with the header the credential names, and says which header was accepted', async () => {
    const f = vi.fn(async () => res(200, { id: 1 }));
    vi.stubGlobal('fetch', f);
    const out = await restConnector.inspect!({ config: { healthPath: '/me' }, credentials: { ...CREDS, headerName: 'X-Auth-Token' }, options: {} }) as Awaited<ReturnType<typeof inspectRestApi>>;

    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['X-Auth-Token']).toBe('tok-fixture');
    expect(out.checks[1]).toMatchObject({ key: 'auth', label: 'X-Auth-Token header accepted', ok: true });
  });
});
