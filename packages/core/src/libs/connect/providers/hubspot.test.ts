import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant.ts imports the database; these tests never touch it.
vi.mock('@/libs/DB');

const { hubspotProvider, HUBSPOT_LOGIN_SCOPES, refreshHubspotGrant } = await import('./hubspot');

const REDIRECT = 'https://v.example/api/connect/hubspot/callback';

type Call = { url: string; body: string };

/**
 * Stub `fetch` with one answer per URL prefix, and record each call.
 * @param answers - Prefix of the URL to the JSON body (or a status) it answers with.
 */
function stubFetch(answers: Record<string, { status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    const key = Object.keys(answers).find(prefix => String(url).startsWith(prefix));
    const answer = key ? answers[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

beforeEach(() => {
  env.HUBSPOT_CLIENT_ID = 'hs_client';
  env.HUBSPOT_CLIENT_SECRET = 'hs_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot connect provider', () => {
  it('is configured only when both app credentials are set', () => {
    expect(hubspotProvider.configured()).toBe(true);

    env.HUBSPOT_CLIENT_SECRET = undefined;

    expect(hubspotProvider.configured()).toBe(false);
    expect(() => hubspotProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'hubspot' })).toThrow(/not configured/);
  });

  it('asks only for the read scopes the source syncs with, space separated, with the callback and state', () => {
    const url = new URL(hubspotProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'hubspot' }));

    expect(url.origin + url.pathname).toBe('https://app.hubspot.com/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('oauth crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read');
    expect(HUBSPOT_LOGIN_SCOPES.every(scope => scope === 'oauth' || scope.endsWith('.read'))).toBe(true);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('client_id')).toBe('hs_client');
  });

  it('turns the code into a login bag that names the person who consented, and expires the token early', async () => {
    const calls = stubFetch({
      'https://api.hubapi.com/oauth/v1/token': { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 } },
      'https://api.hubapi.com/oauth/v1/access-tokens/': { body: { hub_id: 4242, user: 'mara@acme.com', hub_domain: 'acme.com' } },
    });
    const before = Date.now();

    const result = await hubspotProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'HubSpot — mara@acme.com',
      credentials: { accessToken: 'at-1', refreshToken: 'rt-1', hubId: 4242, account: 'mara@acme.com' },
    });

    const bag = (result as unknown as { credentials: { expiresAt: string } }).credentials;
    const lifetimeMs = Date.parse(bag.expiresAt) - before;

    // 30 minutes minus the five-minute safety margin.
    expect(lifetimeMs).toBeGreaterThan(24 * 60_000);
    expect(lifetimeMs).toBeLessThanOrEqual(25 * 60_000 + 5_000);
    expect(new URLSearchParams(calls[0]!.body).get('grant_type')).toBe('authorization_code');
  });

  it('falls back to the hub domain, then the portal id, when HubSpot gives no user email', async () => {
    stubFetch({
      'https://api.hubapi.com/oauth/v1/token': { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 } },
      'https://api.hubapi.com/oauth/v1/access-tokens/': { body: { hub_id: 4242, hub_domain: 'acme.com' } },
    });

    await expect(hubspotProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT }))
      .resolves
      .toMatchObject({ ok: true, displayName: 'HubSpot — acme.com' });

    stubFetch({
      'https://api.hubapi.com/oauth/v1/token': { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 } },
      'https://api.hubapi.com/oauth/v1/access-tokens/': { body: { hub_id: 4242 } },
    });

    await expect(hubspotProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT }))
      .resolves
      .toMatchObject({ ok: true, displayName: 'HubSpot — portal 4242' });
  });

  it('still stores the login when the identity lookup fails, rather than losing the consent', async () => {
    stubFetch({
      'https://api.hubapi.com/oauth/v1/token': { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1800 } },
      'https://api.hubapi.com/oauth/v1/access-tokens/': { status: 500, body: {} },
    });

    await expect(hubspotProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT }))
      .resolves
      .toMatchObject({ ok: true, displayName: 'HubSpot — account', credentials: { accessToken: 'at-1', account: null } });
  });

  it('refuses with HubSpot\'s short code when the person declined, and never calls HubSpot', async () => {
    const calls = stubFetch({});

    await expect(hubspotProvider.exchange({ query: { error: 'access_denied', error_description: 'secret-looking free text' }, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'access_denied' });
    await expect(hubspotProvider.exchange({ query: {}, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'missing_code' });
    expect(calls).toEqual([]);
  });

  it('shows a refused code as HubSpot\'s error code, not its message', async () => {
    stubFetch({ 'https://api.hubapi.com/oauth/v1/token': { status: 400, body: { status: 'BAD_AUTH_CODE', error: 'invalid_grant', message: 'echoes the code' } } });

    await expect(hubspotProvider.exchange({ query: { code: 'stale' }, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('summarizes a login as its account, and nothing for a pasted private-app token', () => {
    expect(hubspotProvider.summarize({ accessToken: 'a', refreshToken: 'r', expiresAt: 'x', account: 'mara@acme.com' }))
      .toEqual({ account: 'mara@acme.com (HubSpot)' });
    expect(hubspotProvider.summarize({ token: 'pat-na1-1' })).toBeNull();
  });
});

describe('refreshHubspotGrant', () => {
  it('keeps the refresh token it was given when HubSpot does not send a new one', async () => {
    const calls = stubFetch({ 'https://api.hubapi.com/oauth/v1/token': { body: { access_token: 'at-2', expires_in: 1800 } } });

    const refreshed = await refreshHubspotGrant('rt-1');

    expect(refreshed).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-1' });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
  });

  it('saves a rotated refresh token when HubSpot sends one', async () => {
    stubFetch({ 'https://api.hubapi.com/oauth/v1/token': { body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 1800 } } });

    await expect(refreshHubspotGrant('rt-1')).resolves.toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
  });

  it('throws the vendor code of a refusal so the sync can say to log in again', async () => {
    stubFetch({ 'https://api.hubapi.com/oauth/v1/token': { status: 400, body: { error: 'invalid_grant' } } });

    await expect(refreshHubspotGrant('rt-1')).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});
