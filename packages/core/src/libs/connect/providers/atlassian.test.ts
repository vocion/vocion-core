/**
 * The Atlassian provider against a mocked `fetch`: the authorize URL carries
 * what auth.atlassian.com requires, and the exchange turns a code into the
 * grant bag — or refuses, with a reason a person can act on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atlassianProvider } from '@/libs/connect/providers/atlassian';

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const TOKEN = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'read:jira-work read:jira-user offline_access' };
const ACME = { id: 'cloud-acme', url: 'https://acme.atlassian.net', name: 'Acme' };
const NORTHWIND = { id: 'cloud-nw', url: 'https://northwind.atlassian.net', name: 'Northwind' };

beforeEach(() => {
  vi.stubEnv('ATLASSIAN_CLIENT_ID', 'cid');
  vi.stubEnv('ATLASSIAN_CLIENT_SECRET', 'csecret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('atlassianProvider', () => {
  it('is configured only when both halves of the client are set', () => {
    expect(atlassianProvider.configured()).toBe(true);

    vi.stubEnv('ATLASSIAN_CLIENT_SECRET', '');

    expect(atlassianProvider.configured()).toBe(false);
    expect(atlassianProvider.requiredEnv).toEqual(['ATLASSIAN_CLIENT_ID', 'ATLASSIAN_CLIENT_SECRET']);
  });

  it('refuses to build an authorize URL when the client is not configured', () => {
    vi.stubEnv('ATLASSIAN_CLIENT_ID', '');

    expect(() => atlassianProvider.authorizeUrl({ state: 's', redirectUri: 'https://v.example/cb', connector: 'jira' })).toThrow(/ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET/);
  });

  it('builds the 3LO authorize URL with every parameter auth.atlassian.com requires', () => {
    const url = new URL(atlassianProvider.authorizeUrl({ state: 'st.sig', redirectUri: 'https://v.example/api/connect/atlassian/callback', connector: 'jira' }));

    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toBe('read:jira-work read:jira-user offline_access');
    expect(url.searchParams.get('redirect_uri')).toBe('https://v.example/api/connect/atlassian/callback');
    expect(url.searchParams.get('state')).toBe('st.sig');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('asks for Confluence\'s read scopes, not Jira\'s, when the login is for Confluence', () => {
    vi.stubEnv('ATLASSIAN_CLIENT_ID', 'cid');
    vi.stubEnv('ATLASSIAN_CLIENT_SECRET', 'cs');
    const url = new URL(atlassianProvider.authorizeUrl({ state: 'st.sig', redirectUri: 'https://v.example/api/connect/atlassian/callback', connector: 'confluence' }));

    expect(url.searchParams.get('scope')).toBe('read:confluence-content.all read:confluence-space.summary search:confluence offline_access');
    expect(atlassianProvider.connectorSlugs).toEqual(['jira', 'confluence']);
  });

  it('exchanges the code, lists the sites, and pins the cloudId when there is one site', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(TOKEN))
      .mockResolvedValueOnce(res([ACME]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await atlassianProvider.exchange({ query: { code: 'c-1', state: 'x' }, redirectUri: 'https://v.example/cb' });

    expect(out.ok).toBe(true);

    if (!out.ok) {
      return;
    }

    expect(out.displayName).toBe('Atlassian — Acme');
    expect(out.credentials).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', cloudId: 'cloud-acme', sites: [ACME] });
    expect(typeof out.credentials.expiresAt).toBe('string');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;

    expect(tokenUrl).toBe('https://auth.atlassian.com/oauth/token');
    expect(JSON.parse((tokenInit as RequestInit).body as string)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      client_secret: 'csecret',
      code: 'c-1',
      redirect_uri: 'https://v.example/cb',
    });

    const [resourcesUrl, resourcesInit] = fetchMock.mock.calls[1]!;

    expect(resourcesUrl).toBe('https://api.atlassian.com/oauth/token/accessible-resources');
    expect((resourcesInit as RequestInit).headers).toMatchObject({ authorization: 'Bearer at-1' });
  });

  it('keeps every site and pins nothing when the account reaches several', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(res(TOKEN))
      .mockResolvedValueOnce(res([ACME, NORTHWIND, ACME])));

    const out = await atlassianProvider.exchange({ query: { code: 'c' }, redirectUri: 'https://v.example/cb' });

    expect(out.ok).toBe(true);

    if (!out.ok) {
      return;
    }

    expect(out.credentials.sites).toEqual([ACME, NORTHWIND]);
    expect(out.credentials.cloudId).toBeUndefined();
    expect(out.displayName).toBe('Atlassian — 2 sites');
  });

  it('refuses when the account reaches no site', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(TOKEN)).mockResolvedValueOnce(res([])));

    const out = await atlassianProvider.exchange({ query: { code: 'c' }, redirectUri: 'https://v.example/cb' });

    expect(out).toMatchObject({ ok: false, reason: expect.stringContaining('reaches no Atlassian Cloud site') });
  });

  it('refuses with the vendor reason when the person declined, without calling the token endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await atlassianProvider.exchange({ query: { error: 'access_denied', error_description: 'User did not authorize the request' }, redirectUri: 'x' });

    expect(out).toEqual({ ok: false, reason: 'User did not authorize the request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the token endpoint error without the code or the secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 403)));

    const out = await atlassianProvider.exchange({ query: { code: 'c-secret' }, redirectUri: 'x' });

    expect(out.ok).toBe(false);

    if (out.ok) {
      return;
    }

    expect(out.reason).toContain('Invalid authorization code');
    expect(out.reason).not.toContain('c-secret');
    expect(out.reason).not.toContain('csecret');
  });

  it('summarizes a grant as the site it reads, listing the sites when the account reaches several', () => {
    const one = atlassianProvider.summarize({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: '2026-10-01T00:00:00.000Z',
      scope: 'read:jira-work',
      sites: [{ id: 'c1', url: 'https://metacto.atlassian.net', name: 'metacto' }],
      cloudId: 'c1',
    });

    expect(one).toEqual({ account: 'metacto.atlassian.net' });

    const two = atlassianProvider.summarize({
      accessToken: 'a',
      refreshToken: 'r',
      scope: 'read:jira-work',
      sites: [{ id: 'c1', url: 'https://metacto.atlassian.net', name: 'metacto' }, { id: 'c2', url: 'https://noco.atlassian.net', name: 'noco' }],
    });

    expect(two).toEqual({ account: 'metacto.atlassian.net', granted: { label: 'Sites', items: ['metacto.atlassian.net', 'noco.atlassian.net'] } });

    // A pasted API token has no sites recorded.
    expect(atlassianProvider.summarize({ email: 'a@b.c', apiToken: 't' })).toBeNull();
  });
});
