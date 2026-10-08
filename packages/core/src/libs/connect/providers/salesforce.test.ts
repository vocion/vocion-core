/**
 * "Connect with Salesforce": the person is sent to the login host with PKCE
 * and the four scopes; the callback trades the code (with the verifier) for a
 * grant that keeps the org's instance URL and the username; a refusal stays a
 * short code; a refresh keeps the refresh token Salesforce did not rotate.
 * Every token, org and user here is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// The refresh imports the grant store, which imports the database; nothing here reaches it.
vi.mock('@/libs/DB', () => ({ db: {} }));

const { refreshSalesforceGrant, SALESFORCE_LOGIN_SCOPES, salesforceProvider } = await import('./salesforce');

const REDIRECT = 'https://v.example/api/connect/salesforce/callback';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  env.SALESFORCE_CLIENT_ID = 'server_sf';
  env.SALESFORCE_CLIENT_SECRET = 'server_secret';
  env.SALESFORCE_LOGIN_URL = undefined;
});

afterEach(() => vi.unstubAllGlobals());

describe('salesforceProvider', () => {
  it('is configured only with both env values, and names them', () => {
    expect(salesforceProvider.configured()).toBe(true);
    expect(salesforceProvider.requiredEnv).toEqual(['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET']);

    env.SALESFORCE_CLIENT_SECRET = undefined;

    expect(salesforceProvider.configured()).toBe(false);
  });

  it('sends the person to the login host with the four scopes and an S256 challenge', () => {
    const url = new URL(salesforceProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'salesforce', codeChallenge: 'chal' }));

    expect(url.origin + url.pathname).toBe('https://login.salesforce.com/services/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe(SALESFORCE_LOGIN_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).toBe('api refresh_token offline_access id');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(salesforceProvider.pkce).toBe(true);
  });

  it('logs a sandbox in at the login URL the server names', () => {
    env.SALESFORCE_LOGIN_URL = 'https://test.salesforce.com/';
    const url = salesforceProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'salesforce' });

    expect(url.startsWith('https://test.salesforce.com/services/oauth2/authorize?')).toBe(true);
  });

  it('trades the code with the verifier and keeps the instance URL and the username', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      if (url.endsWith('/services/oauth2/token')) {
        return json({ access_token: '00Dxx!access', refresh_token: 'refresh-1', instance_url: 'https://northwind.my.salesforce.com', id: 'https://login.salesforce.com/id/00Dxx0000000001AAA/005xx0000000001AAA', scope: 'api refresh_token id' });
      }
      return json({ username: 'ops@northwind.example', organization_id: '00Dxx0000000001AAA' });
    }));

    const out = await salesforceProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT, codeVerifier: 'verifier-1' });

    expect(out.ok).toBe(true);

    const form = new URLSearchParams(calls[0]!.body);

    expect(form.get('code_verifier')).toBe('verifier-1');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(out.ok && out.credentials).toMatchObject({ accessToken: '00Dxx!access', refreshToken: 'refresh-1', instanceUrl: 'https://northwind.my.salesforce.com', account: 'ops@northwind.example' });
    expect(out.ok && out.displayName).toBe('Salesforce — ops@northwind.example');
    expect(out.ok && salesforceProvider.summarize(out.credentials)).toEqual({ account: 'ops@northwind.example (Salesforce)' });
  });

  it('refuses a grant with no instance URL rather than store one nothing can call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ access_token: 'a', refresh_token: 'r' })));
    const out = await salesforceProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT });

    expect(out).toEqual({ ok: false, reason: 'no_instance_url' });
  });

  it('keeps only a short code from a refusal', async () => {
    expect(await salesforceProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'access_denied' });
    expect(await salesforceProvider.exchange({ query: { error: 'the person said <no>' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'authorization_refused' });
  });

  it('a refresh keeps the refresh token Salesforce did not rotate, and expires early', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ access_token: 'fresh', instance_url: 'https://northwind.my.salesforce.com' })));
    const before = Date.now();
    const tokens = await refreshSalesforceGrant('refresh-1');

    expect(tokens.accessToken).toBe('fresh');
    expect(tokens.refreshToken).toBe('refresh-1');
    // Trusted for the shortest session an org can set (15 minutes), less the five early.
    expect(Date.parse(tokens.expiresAt) - before).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });
});
