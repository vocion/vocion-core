/**
 * "Connect with Gusto": the consent URL, the code exchange, the company the
 * token is for, and the refresh that keeps Gusto's single-use refresh token.
 * Gusto is a stub; no live calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant.ts imports the database; these tests never touch it.
vi.mock('@/libs/DB');

const { gustoProvider, refreshGustoGrant } = await import('./gusto');

const REDIRECT = 'https://v.example/api/connect/gusto/callback';
const TOKEN_URL = 'https://api.gusto.com/oauth/token';
const COMPANY = '7b2d9a40-0000-4000-8000-00000000c0de';

type Call = { url: string; body: string; authorization: string | null; version: string | null };

/**
 * Stub `fetch` with one answer per URL prefix, recording each call.
 * @param answers - URL prefix to the JSON body (and status) it answers with.
 */
function stubFetch(answers: Record<string, { status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), body: String(init?.body ?? ''), authorization: headers.get('authorization'), version: headers.get('x-gusto-api-version') });
    const key = Object.keys(answers).sort((a, b) => b.length - a.length).find(prefix => String(url).startsWith(prefix));
    const answer = key ? answers[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

const TOKENS = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7200 };

beforeEach(() => {
  env.GUSTO_CLIENT_ID = 'gusto_client';
  env.GUSTO_CLIENT_SECRET = 'gusto_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gusto connect provider', () => {
  it('is configured only when both app values are set', () => {
    expect(gustoProvider.configured()).toBe(true);

    env.GUSTO_CLIENT_SECRET = undefined;

    expect(gustoProvider.configured()).toBe(false);
    expect(() => gustoProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'gusto' })).toThrow(/not configured/);
  });

  it('sends the person to Gusto with the client, the callback and the state', () => {
    const url = new URL(gustoProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'gusto' }));

    expect(url.origin + url.pathname).toBe('https://api.gusto.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('gusto_client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st.ate');
  });

  it('prefers the workspace\'s own app over the server\'s', () => {
    const url = new URL(gustoProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'gusto', client: { clientId: 'own', clientSecret: 'own_s', owner: 'workspace' } }));

    expect(url.searchParams.get('client_id')).toBe('own');
  });

  it('trades the code, and stores the company the token is for with its name', async () => {
    const calls = stubFetch({
      [TOKEN_URL]: { body: TOKENS },
      'https://api.gusto.com/v1/token_info': { body: { scope: 'employees:read', resource: { type: 'Company', uuid: COMPANY } } },
      [`https://api.gusto.com/v1/companies/${COMPANY}`]: { body: { uuid: COMPANY, name: 'Larkfield Systems Inc', trade_name: 'Larkfield Systems' } },
    });
    const out = await gustoProvider.exchange({ query: { code: 'c0de', state: 'x' }, redirectUri: REDIRECT });

    expect(out).toMatchObject({ ok: true, credentials: { accessToken: 'at-1', refreshToken: 'rt-1', companyUuid: COMPANY, companyName: 'Larkfield Systems' }, displayName: 'Gusto — Larkfield Systems' });

    const sent = new URLSearchParams(calls[0]!.body);

    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('redirect_uri')).toBe(REDIRECT);
    expect(calls[1]!.authorization).toBe('Bearer at-1');
    expect(calls[1]!.version).toBe('2024-04-01');
  });

  it('refuses a login that cannot say which company it is for', async () => {
    stubFetch({ [TOKEN_URL]: { body: TOKENS }, 'https://api.gusto.com/v1/token_info': { status: 401, body: {} } });

    await expect(gustoProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_company' });
  });

  it('passes on a decline as a short code, and a refused code as Gusto\'s own', async () => {
    await expect(gustoProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
    await expect(gustoProvider.exchange({ query: { error: '<b>no</b>' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'authorization_refused' });

    stubFetch({ [TOKEN_URL]: { status: 400, body: { error: 'invalid_grant' } } });

    await expect(gustoProvider.exchange({ query: { code: 'stale' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('refreshes and keeps the rotated refresh token', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 7200 } } });

    await expect(refreshGustoGrant('rt-1')).resolves.toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(new URLSearchParams(calls[0]!.body).get('refresh_token')).toBe('rt-1');
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('refresh_token');
  });

  it('says plainly when the server has no Gusto app to refresh on', async () => {
    env.GUSTO_CLIENT_ID = undefined;

    await expect(refreshGustoGrant('rt-1')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('summarizes a login as its company and nothing else', () => {
    expect(gustoProvider.summarize({ accessToken: 'a', refreshToken: 'r', expiresAt: 'x', companyUuid: COMPANY, companyName: 'Larkfield Systems' })).toEqual({ account: 'Larkfield Systems (Gusto)' });
    expect(gustoProvider.summarize({ token: 'pasted' })).toBeNull();
  });
});
