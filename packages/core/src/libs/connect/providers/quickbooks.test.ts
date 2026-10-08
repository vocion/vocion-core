/**
 * "Connect with QuickBooks": the consent URL, the code exchange (HTTP Basic,
 * as Intuit asks), the company the person picked, which Intuit environment
 * it lives in, and the refresh that keeps a rotated refresh token. Intuit is
 * a stub; no live calls.
 */
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant.ts imports the database; these tests never touch it.
vi.mock('@/libs/DB');

const { quickbooksProvider, QUICKBOOKS_LOGIN_SCOPES, refreshQuickbooksGrant } = await import('./quickbooks');

const REDIRECT = 'https://v.example/api/connect/quickbooks/callback';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REALM = '4620816365211234';

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

const TOKENS = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, x_refresh_token_expires_in: 8_726_400 };

beforeEach(() => {
  env.QUICKBOOKS_CLIENT_ID = 'qb_client';
  env.QUICKBOOKS_CLIENT_SECRET = 'qb_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quickbooks connect provider', () => {
  it('is configured only when both app values are set', () => {
    expect(quickbooksProvider.configured()).toBe(true);

    env.QUICKBOOKS_CLIENT_SECRET = undefined;

    expect(quickbooksProvider.configured()).toBe(false);
    expect(() => quickbooksProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'quickbooks' })).toThrow(/not configured/);
  });

  it('asks Intuit for the accounting scope only, with the callback and state', () => {
    const url = new URL(quickbooksProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'quickbooks' }));

    expect(url.origin + url.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect([...QUICKBOOKS_LOGIN_SCOPES]).toEqual(['com.intuit.quickbooks.accounting']);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('client_id')).toBe('qb_client');
  });

  it('trades the code with HTTP Basic, and stores the company the person picked with its name', async () => {
    const calls = stubFetch({
      [TOKEN_URL]: { body: TOKENS },
      [`https://quickbooks.api.intuit.com/v3/company/${REALM}/companyinfo/${REALM}`]: { body: { CompanyInfo: { CompanyName: 'Larkfield Systems' } } },
    });
    const out = await quickbooksProvider.exchange({ query: { code: 'c0de', realmId: REALM, state: 'x' }, redirectUri: REDIRECT });

    expect(out.ok).toBe(true);

    const exchanged = out as Extract<typeof out, { ok: true }>;

    expect(exchanged.credentials).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', realmId: REALM, companyName: 'Larkfield Systems', environment: 'production' });
    expect(Date.parse(String(exchanged.credentials.expiresAt))).toBeLessThan(Date.now() + 3600 * 1000);
    expect(exchanged.displayName).toBe('QuickBooks — Larkfield Systems');
    expect(calls[0]!.authorization).toBe(`Basic ${Buffer.from('qb_client:qb_secret').toString('base64')}`);
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(calls[0]!.body).get('redirect_uri')).toBe(REDIRECT);
    expect(calls[0]!.body).not.toContain('qb_secret');
    expect(calls[1]!.authorization).toBe('Bearer at-1');
  });

  it('finds a sandbox company on the sandbox host, and records that it is one', async () => {
    stubFetch({
      [TOKEN_URL]: { body: TOKENS },
      'https://quickbooks.api.intuit.com/': { status: 401, body: { fault: { error: [{ message: 'AuthenticationFailed' }] } } },
      [`https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM}/companyinfo/${REALM}`]: { body: { CompanyInfo: { CompanyName: 'Sandbox Company_US_1' } } },
    });
    const out = await quickbooksProvider.exchange({ query: { code: 'c0de', realmId: REALM }, redirectUri: REDIRECT });

    expect(out).toMatchObject({ ok: true, credentials: { environment: 'sandbox', companyName: 'Sandbox Company_US_1' } });
    expect(quickbooksProvider.summarize((out as Extract<typeof out, { ok: true }>).credentials)).toEqual({ account: `Sandbox Company_US_1 (company ${REALM}, sandbox)` });
  });

  it('keeps a login whose company name Intuit would not give, with a generic name', async () => {
    stubFetch({ [TOKEN_URL]: { body: TOKENS } });
    const out = await quickbooksProvider.exchange({ query: { code: 'c0de', realmId: REALM }, redirectUri: REDIRECT });

    expect(out).toMatchObject({ ok: true, credentials: { companyName: null, environment: 'production' }, displayName: `QuickBooks — company ${REALM}` });
  });

  it('refuses without a company, before spending the code', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: TOKENS } });

    await expect(quickbooksProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_company' });
    await expect(quickbooksProvider.exchange({ query: { code: 'c0de', realmId: '12; DROP' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'missing_company' });
    expect(calls).toHaveLength(0);
  });

  it('passes on a decline as a short code, and Intuit\'s refusal of the code as its own', async () => {
    await expect(quickbooksProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
    await expect(quickbooksProvider.exchange({ query: { error: 'something <script>' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'authorization_refused' });

    stubFetch({ [TOKEN_URL]: { status: 400, body: { error: 'invalid_grant' } } });

    await expect(quickbooksProvider.exchange({ query: { code: 'stale', realmId: REALM }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('refreshes with HTTP Basic and keeps the rotated refresh token Intuit returns', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 } } });
    const fresh = await refreshQuickbooksGrant('rt-1');

    expect(fresh).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(new URLSearchParams(calls[0]!.body).get('refresh_token')).toBe('rt-1');
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('refresh_token');
    expect(calls[0]!.authorization).toMatch(/^Basic /);
  });

  it('keeps the refresh token it sent when Intuit returns none', async () => {
    stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-3', expires_in: 3600 } } });

    await expect(refreshQuickbooksGrant('rt-1')).resolves.toMatchObject({ accessToken: 'at-3', refreshToken: 'rt-1' });
  });

  it('says plainly when the server has no Intuit app to refresh on', async () => {
    env.QUICKBOOKS_CLIENT_ID = undefined;

    await expect(refreshQuickbooksGrant('rt-1')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('summarizes a login as its company and id, and nothing else', () => {
    expect(quickbooksProvider.summarize({ accessToken: 'a', refreshToken: 'r', expiresAt: 'x', realmId: REALM, companyName: 'Larkfield Systems', environment: 'production' }))
      .toEqual({ account: `Larkfield Systems (company ${REALM})` });
    expect(quickbooksProvider.summarize({ token: 'pasted' })).toBeNull();
  });
});
