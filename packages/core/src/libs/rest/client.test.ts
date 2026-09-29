/**
 * The one HTTP client behind every REST-source call, against a mocked
 * fetch: the bearer header goes on and nowhere else, every failure class
 * comes back as data with a sentence a model acts on, and a response is
 * picked and capped without losing the fact that it was cut.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUrl, capJson, noRestCredentials, pickPath, restCall, restCredentialsOf } from './client';

const CREDS = { baseUrl: 'https://api.northwind.example/', token: 'secret-token-1' };

function res(status: number, body: string | object, ok = status < 300): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok, status, text: async () => text } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('restCredentialsOf', () => {
  it('needs a base URL that starts with http(s) and a non-empty token', () => {
    expect(restCredentialsOf({ baseUrl: ' https://a.example ', token: ' t ' })).toEqual({ baseUrl: 'https://a.example', token: 't' });
    expect(restCredentialsOf({ baseUrl: 'a.example', token: 't' })).toBeUndefined();
    expect(restCredentialsOf({ baseUrl: 'https://a.example', token: '' })).toBeUndefined();
    expect(restCredentialsOf(undefined)).toBeUndefined();
  });

  it('names the Connectors-page fix when nothing is stored', () => {
    expect(noRestCredentials('billing-api')).toMatchObject({ ok: false, error: 'no_credentials', message: expect.stringContaining('"billing-api"') });
  });
});

describe('restCall', () => {
  it('GETs base + path + query with the bearer header, and returns the parsed JSON', async () => {
    const f = vi.fn(async () => res(200, { data: [{ id: 1 }] }));
    vi.stubGlobal('fetch', f);

    const out = await restCall({ credentials: CREDS, method: 'GET', path: '/api/projects', query: { 'filters[status][$eq]': 'active' } });

    expect(out).toEqual({ ok: true, status: 200, data: { data: [{ id: 1 }] } });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.northwind.example/api/projects?filters%5Bstatus%5D%5B%24eq%5D=active');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token-1');
    expect(init.body).toBeUndefined();
  });

  it('sends a JSON body on a write', async () => {
    const f = vi.fn(async () => res(200, { ok: 1 }));
    vi.stubGlobal('fetch', f);
    await restCall({ credentials: CREDS, method: 'PUT', path: '/api/milestones/m1', body: { data: { name: 'Kickoff' } } });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(String(init.body)).toBe('{"data":{"name":"Kickoff"}}');
  });

  it('reads a 401 or 403 as a refused token, and says it may have expired or lack rights', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: { message: 'Missing or invalid credentials' } })));
    const out = await restCall({ credentials: CREDS, method: 'GET', path: '/api/users/me' });

    expect(out).toMatchObject({ ok: false, error: 'http_401', status: 401 });
    expect((out as { message: string }).message).toMatch(/expired or lack the rights/);
    expect((out as { message: string }).message).toContain('Missing or invalid credentials');
    expect(JSON.stringify(out)).not.toContain('secret-token-1');
  });

  it('classes 404, other 4xx and 5xx, keeping the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, { error: 'Not Found' })));

    expect(await restCall({ credentials: CREDS, method: 'GET', path: '/x' })).toMatchObject({ ok: false, error: 'http_404', status: 404, body: { error: 'Not Found' } });

    vi.stubGlobal('fetch', vi.fn(async () => res(422, 'bad input')));

    expect(await restCall({ credentials: CREDS, method: 'POST', path: '/x', body: {} })).toMatchObject({ ok: false, error: 'http_4xx', status: 422, body: 'bad input' });

    vi.stubGlobal('fetch', vi.fn(async () => res(503, '')));

    expect(await restCall({ credentials: CREDS, method: 'GET', path: '/x' })).toMatchObject({ ok: false, error: 'http_5xx', status: 503 });
  });

  it('reports a body that is not JSON, and an empty 2xx as null data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, '<html>login</html>')));

    expect(await restCall({ credentials: CREDS, method: 'GET', path: '/x' })).toMatchObject({ ok: false, error: 'invalid_json', status: 200 });

    vi.stubGlobal('fetch', vi.fn(async () => res(204, '')));

    expect(await restCall({ credentials: CREDS, method: 'DELETE', path: '/x' })).toEqual({ ok: true, status: 204, data: null });
  });

  it('times out as data, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));

    const out = await restCall({ credentials: CREDS, method: 'GET', path: '/slow', timeoutMs: 5 });

    expect(out).toMatchObject({ ok: false, error: 'timeout', status: null });
  });

  it('reports an unreachable host as network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    expect(await restCall({ credentials: CREDS, method: 'GET', path: '/x' })).toMatchObject({ ok: false, error: 'network_error', message: expect.stringContaining('fetch failed') });
  });
});

describe('shaping the response', () => {
  it('builds the URL without a doubled slash and with the query appended', () => {
    expect(buildUrl('https://a.example/', '/v1/x', {})).toBe('https://a.example/v1/x');
    expect(buildUrl('https://a.example', '/v1/x?a=1', { b: '2' })).toBe('https://a.example/v1/x?a=1&b=2');
  });

  it('picks a dotted path, undefined when a step is missing', () => {
    expect(pickPath({ data: { items: [1] } }, 'data.items')).toEqual([1]);
    expect(pickPath({ data: null }, 'data.items')).toBeUndefined();
    expect(pickPath({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('caps the text and says how long the whole was', () => {
    const long = { rows: Array.from({ length: 200 }, (_, i) => ({ i, name: `row ${i}` })) };
    const text = capJson(long, 500);

    expect(text.length).toBeLessThan(700);
    expect(text).toMatch(/truncated: the response is \d+ characters; the first 500 are shown/);
    expect(capJson({ a: 1 }, 500)).toBe('{"a":1}');
    // Compact: the cap measures what the model reads, not an indented copy of it.
    expect(capJson({ rows: [{ i: 1 }] }, 500)).toBe('{"rows":[{"i":1}]}');
  });
});
