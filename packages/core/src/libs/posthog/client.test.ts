/**
 * The PostHog client owns the one thing every read depends on — a personal key
 * sent as a Bearer against one host and one project — and the shaping of what
 * comes back when it is wrong. A pasted project token must be refused before a
 * call is made, and a 401 / 403 / 404 must each say what to do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPosthogClient,
  credentialsFrom,
  describeKeyProblem,
  normalizeHost,
} from '@/libs/posthog/client';

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const CREDS = { apiKey: 'phx_fixture_key_0001', host: 'https://eu.posthog.com/', projectId: '4242' };

afterEach(() => vi.unstubAllGlobals());

describe('describeKeyProblem', () => {
  it('names the public project token for what it is', () => {
    expect(describeKeyProblem('phc_abcdefghijklmnop')).toMatch(/project token.*cannot read.*personal API key/i);
  });

  it('asks for a phx_ key when the shape is unknown', () => {
    expect(describeKeyProblem('sk-not-a-posthog-key')).toMatch(/starts with "phx_"/);
  });

  it('accepts a personal key', () => {
    expect(describeKeyProblem('phx_fixture_key_0001')).toBeNull();
  });
});

describe('normalizeHost', () => {
  it('drops trailing slashes and whitespace', () => {
    expect(normalizeHost(' https://us.posthog.com/// ')).toBe('https://us.posthog.com');
  });

  it('refuses a bare hostname', () => {
    expect(normalizeHost('us.posthog.com')).toBeNull();
  });
});

describe('credentialsFrom', () => {
  it('reads the three fields the platform descriptor stores', () => {
    expect(credentialsFrom(CREDS)).toEqual({
      ok: true,
      credentials: { apiKey: 'phx_fixture_key_0001', host: 'https://eu.posthog.com', projectId: '4242', viaLogin: false },
    });
  });

  it('accepts a numeric project id off an older bag', () => {
    const out = credentialsFrom({ ...CREDS, projectId: 4242 });

    expect(out.ok && out.credentials.projectId).toBe('4242');
  });

  it.each([
    [{}, /No PostHog personal API key/],
    [{ ...CREDS, apiKey: 'phc_public_token_0001' }, /project token/],
    [{ ...CREDS, host: 'posthog.internal' }, /host must be a URL/],
    [{ ...CREDS, projectId: 'my-project' }, /numeric id/],
  ])('refuses %j with a sentence for the person', (bag, message) => {
    const out = credentialsFrom(bag as Record<string, unknown>);

    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toMatch(message);
  });
});

describe('createPosthogClient', () => {
  it('sends the personal key as a Bearer against the normalised host and project', async () => {
    const fetchMock = vi.fn(async () => res(200, { name: 'Northwind Send' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await createPosthogClient(CREDS).get('/api/projects/4242/');

    expect(out).toEqual({ ok: true, data: { name: 'Northwind Send' } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://eu.posthog.com/api/projects/4242/');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer phx_fixture_key_0001');
  });

  it('posts a HogQL statement with placeholder values through the Query API', async () => {
    const fetchMock = vi.fn(async () => res(200, { columns: ['day'], results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await createPosthogClient(CREDS).hogql('SELECT event FROM events WHERE event IN {events}', { events: ['Document Sent'] });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://eu.posthog.com/api/projects/4242/query/');
    expect(JSON.parse(String(init.body))).toEqual({
      query: { kind: 'HogQLQuery', query: 'SELECT event FROM events WHERE event IN {events}', values: { events: ['Document Sent'] } },
    });
  });

  it('shapes a 401 into a rejected-key message that points at Test connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { detail: 'Invalid personal API key.' })));

    const out = await createPosthogClient(CREDS).get('/api/projects/4242/');

    expect(out).toMatchObject({ ok: false, error: 'posthog_unauthorized', status: 401 });
    expect(!out.ok && out.message).toMatch(/rejected the personal API key[\s\S]*Invalid personal API key[\s\S]*Test connection/);
  });

  it('shapes a 403 as a missing scope, not a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { detail: 'scope' })));

    const out = await createPosthogClient(CREDS).query({ kind: 'HogQLQuery', query: 'SELECT 1' });

    expect(out).toMatchObject({ ok: false, error: 'posthog_unauthorized', status: 403 });
    expect(!out.ok && out.message).toMatch(/query:read/);
  });

  // PostHog's live answer to a dead token, 2026-10-06: a 401 on most endpoints, a 403 on the Query API.
  const INVALID_TOKEN = { type: 'authentication_error', code: 'authentication_failed', detail: 'Invalid access token.' };

  it('a login whose token PostHog refuses says to log in with PostHog again, on the Query API\'s 403 as on a 401', async () => {
    const login = { ...CREDS, apiKey: 'pha_fixture_token_0001', viaLogin: true };
    vi.stubGlobal('fetch', vi.fn(async () => res(401, INVALID_TOKEN)));

    const listed = await createPosthogClient(login).get('/api/projects/4242/');

    vi.stubGlobal('fetch', vi.fn(async () => res(403, INVALID_TOKEN)));

    const queried = await createPosthogClient(login).query({ kind: 'HogQLQuery', query: 'SELECT 1' });

    for (const out of [listed, queried]) {
      expect(!out.ok && out.message).toMatch(/Log in with PostHog again on the Connectors page/);
      expect(!out.ok && out.message).not.toMatch(/personal API key|lacks a read scope/);
    }
  });

  it('a login PostHog really denies a project says to log in again and grant it, not to fix a key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, { type: 'authentication_error', code: 'permission_denied', detail: 'You do not have permission to perform this action.' })));

    const out = await createPosthogClient({ ...CREDS, apiKey: 'pha_fixture_token_0001', viaLogin: true }).query({ kind: 'HogQLQuery', query: 'SELECT 1' });

    expect(!out.ok && out.message).toMatch(/log in with PostHog again and grant this project/);
    expect(!out.ok && out.message).not.toMatch(/The key is valid/);
  });

  it('a stored login is marked as one, so its refusals say to log in again whatever its token looks like', () => {
    const out = credentialsFrom({ accessToken: 'pha_fixture_token_0001', refreshToken: 'phr_fixture_0001', expiresAt: '2030-01-01T00:00:00Z', host: 'https://eu.posthog.com', projectId: '4242' });

    expect(out.ok && out.credentials.viaLogin).toBe(true);
  });

  it('a personal key PostHog calls invalid on the Query API is a rejected key, not a missing scope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(403, INVALID_TOKEN)));

    const out = await createPosthogClient(CREDS).query({ kind: 'HogQLQuery', query: 'SELECT 1' });

    expect(!out.ok && out.message).toMatch(/rejected the personal API key/);
    expect(!out.ok && out.message).not.toMatch(/query:read/);
  });

  it('shapes a 404 as a wrong project or region', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, 'Not found.')));

    const out = await createPosthogClient(CREDS).get('/api/projects/4242/');

    expect(out).toMatchObject({ ok: false, error: 'posthog_not_found', status: 404 });
    expect(!out.ok && out.message).toMatch(/project id[\s\S]*region/);
  });

  it('rides out a 429 that names its wait, then returns the good answer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(429, 'slow down', { 'retry-after': '0' }))
      .mockResolvedValueOnce(res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await createPosthogClient(CREDS).hogql('SELECT 1');

    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports an unreachable host as status 0 rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const out = await createPosthogClient(CREDS).get('/api/projects/4242/');

    expect(out).toMatchObject({ ok: false, error: 'posthog_error', status: 0 });
    expect(!out.ok && out.message).toMatch(/Could not reach PostHog/);
  });
});
