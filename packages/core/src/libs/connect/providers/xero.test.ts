/**
 * "Connect with Xero": the consent URL with the read-only scopes, the code
 * exchange (HTTP Basic), the organisation read from Xero's connections, and
 * the refresh that keeps the rotated refresh token. Xero is a stub; no live
 * calls.
 */
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { refreshXeroGrant, XERO_LOGIN_SCOPES, xeroProvider } = await import('./xero');

const REDIRECT = 'https://v.example/api/connect/xero/callback';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

type Call = { url: string; body: string; authorization: string | null };

/**
 * Stub `fetch` with one answer per URL prefix, recording each call.
 * @param answers - URL prefix to the JSON body (and status) it answers with.
 */
function stubFetch(answers: Record<string, { status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ''), authorization: new Headers(init?.headers).get('authorization') });
    const key = Object.keys(answers).find(prefix => String(url).startsWith(prefix));
    const answer = key ? answers[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

const TOKENS = { access_token: 'xat-1', refresh_token: 'xrt-1', expires_in: 1800 };
const TENANTS = [
  { tenantId: 'aaaa1111-0000-4000-8000-000000000001', tenantType: 'PRACTICE', tenantName: 'Kestrel Capital Practice' },
  { tenantId: 'bbbb2222-0000-4000-8000-000000000002', tenantType: 'ORGANISATION', tenantName: 'Northwind' },
];

beforeEach(() => {
  env.XERO_CLIENT_ID = 'xero_client';
  env.XERO_CLIENT_SECRET = 'xero_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('xero connect provider', () => {
  it('is configured only when both app values are set', () => {
    expect(xeroProvider.configured()).toBe(true);

    env.XERO_CLIENT_ID = undefined;

    expect(xeroProvider.configured()).toBe(false);
    expect(() => xeroProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'xero' })).toThrow(/not configured/);
  });

  it('asks Xero for the read-only scopes, with the callback and state', () => {
    const url = new URL(xeroProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'xero' }));

    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize');
    expect(url.searchParams.get('scope')).toBe(XERO_LOGIN_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).not.toMatch(/accounting\.transactions(?!\.read)/);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges the code with HTTP Basic and keeps the first organisation, not a practice', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: TOKENS }, [CONNECTIONS_URL]: { body: TENANTS } });
    const result = await xeroProvider.exchange({ query: { code: 'c0de', state: 's' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({ ok: true, displayName: 'Xero — Northwind', credentials: { accessToken: 'xat-1', refreshToken: 'xrt-1', tenantId: TENANTS[1]!.tenantId, tenantName: 'Northwind' } });
    expect(calls[0]!.authorization).toBe(`Basic ${Buffer.from('xero_client:xero_secret').toString('base64')}`);
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('authorization_code');
    expect(calls[1]!.authorization).toBe('Bearer xat-1');
  });

  it('refuses a login that reaches no organisation, and a declined consent, with a short code', async () => {
    stubFetch({ [TOKEN_URL]: { body: TOKENS }, [CONNECTIONS_URL]: { body: [] } });

    await expect(xeroProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_organisation' });
    await expect(xeroProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
  });

  it('refreshes and keeps the rotated refresh token', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: { access_token: 'xat-2', refresh_token: 'xrt-2', expires_in: 1800 } } });
    const tokens = await refreshXeroGrant('xrt-1');

    expect(tokens).toMatchObject({ accessToken: 'xat-2', refreshToken: 'xrt-2' });
    expect(new URLSearchParams(calls[0]!.body).get('refresh_token')).toBe('xrt-1');
  });

  it('summarizes a stored login by its organisation, and nothing else', () => {
    expect(xeroProvider.summarize({ accessToken: 'a', refreshToken: 'r', tenantId: 't', tenantName: 'Northwind' })).toEqual({ account: 'Northwind (Xero)' });
    expect(xeroProvider.summarize({ clientId: 'c', clientSecret: 's' })).toBeNull();
  });
});
