import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant.ts imports the database; these tests never touch it.
vi.mock('@/libs/DB');

const { linkedinProvider, LINKEDIN_LOGIN_SCOPES, refreshLinkedinGrant } = await import('./linkedin');

const REDIRECT = 'https://v.example/api/connect/linkedin/callback';

type Call = { url: string; body: string; headers: Headers };

/**
 * Stub `fetch` with one answer per URL prefix, and record each call.
 * @param answers - URL prefix to the JSON body (and status) it answers with.
 */
function stubFetch(answers: Record<string, { status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ''), headers: new Headers(init?.headers) });
    const key = Object.keys(answers).find(prefix => String(url).startsWith(prefix));
    const answer = key ? answers[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const ACCOUNTS_URL = 'https://api.linkedin.com/rest/adAccounts?q=search';

beforeEach(() => {
  env.LINKEDIN_CLIENT_ID = 'li_client';
  env.LINKEDIN_CLIENT_SECRET = 'li_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('linkedin connect provider', () => {
  it('is configured only when both app credentials are set', () => {
    expect(linkedinProvider.configured()).toBe(true);

    env.LINKEDIN_CLIENT_SECRET = undefined;

    expect(linkedinProvider.configured()).toBe(false);
    expect(() => linkedinProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'linkedin-ads' })).toThrow(/not configured/);
  });

  it('asks for the two read-only ads scopes, with the callback and state', () => {
    const url = new URL(linkedinProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'linkedin-ads' }));

    expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('r_ads r_ads_reporting');
    expect(LINKEDIN_LOGIN_SCOPES.every(scope => scope.startsWith('r_'))).toBe(true);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('client_id')).toBe('li_client');
  });

  it('prefers the workspace\'s own login app over the server\'s', () => {
    const url = new URL(linkedinProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'linkedin-ads', client: { clientId: 'ws_client', clientSecret: 'ws_secret', owner: 'workspace' } }));

    expect(url.searchParams.get('client_id')).toBe('ws_client');
  });

  it('stores a refreshable login grant when LinkedIn issues a refresh token, with the ad accounts it reaches', async () => {
    const calls = stubFetch({
      [TOKEN_URL]: { body: { access_token: 'at-1', expires_in: 5_184_000, refresh_token: 'rt-1', refresh_token_expires_in: 31_536_000 } },
      [ACCOUNTS_URL]: { body: { elements: [{ id: 508000001, name: 'Northwind Brand' }, { id: 508000002, name: 'Northwind Hiring' }] } },
    });

    const result = await linkedinProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'LinkedIn — 2 ad accounts',
      credentials: { accessToken: 'at-1', refreshToken: 'rt-1', accounts: ['Northwind Brand', 'Northwind Hiring'] },
    });
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('authorization_code');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer at-1');
    expect(calls[1]!.headers.get('x-restli-protocol-version')).toBe('2.0.0');
  });

  it('stores a working, non-refreshing token when LinkedIn issues no refresh token', async () => {
    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'at-2', expires_in: 5_184_000 } },
      [ACCOUNTS_URL]: { body: { elements: [{ id: 508000001, name: 'Kestrel Capital Ads' }] } },
    });

    const result = await linkedinProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });
    const bag = (result as { credentials: Record<string, unknown> }).credentials;

    expect(result).toMatchObject({ ok: true, displayName: 'LinkedIn — Kestrel Capital Ads' });
    expect(bag.refreshToken).toBeUndefined();
    expect(Date.parse(String(bag.expiresAt))).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });

  it('refuses with LinkedIn\'s short code when the person declined, and never calls LinkedIn', async () => {
    const calls = stubFetch({});

    await expect(linkedinProvider.exchange({ query: { error: 'user_cancelled_authorize', error_description: 'free text' }, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'user_cancelled_authorize' });
    await expect(linkedinProvider.exchange({ query: {}, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_code' });
    expect(calls).toEqual([]);
  });

  it('refreshes with the app the login was made on, keeping the refresh token when none comes back', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-3', expires_in: 5_184_000 } } });

    const tokens = await refreshLinkedinGrant('rt-1', { clientId: 'ws_client', clientSecret: 'ws_secret', owner: 'workspace' });
    const form = new URLSearchParams(calls[0]!.body);

    expect(tokens).toMatchObject({ accessToken: 'at-3', refreshToken: 'rt-1' });
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_id')).toBe('ws_client');
  });

  it('summarizes a login as the ad accounts it reaches, and nothing for a pasted token', () => {
    expect(linkedinProvider.summarize({ accessToken: 'a', expiresAt: 'x', accounts: ['Northwind Brand'] }))
      .toEqual({ account: 'LinkedIn Campaign Manager', granted: { label: 'Ad accounts', items: ['Northwind Brand'] } });
    expect(linkedinProvider.summarize({ token: 'pasted' })).toBeNull();
  });
});
