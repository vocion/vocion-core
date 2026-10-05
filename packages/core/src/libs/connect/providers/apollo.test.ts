import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant.ts imports the database; these tests never touch it.
vi.mock('@/libs/DB');

const { apolloProvider, APOLLO_LOGIN_SCOPES, refreshApolloGrant } = await import('./apollo');

const REDIRECT = 'https://v.example/api/connect/apollo/callback';
const TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token';
const PROFILE_URL = 'https://app.apollo.io/api/v1/users/api_profile';

type Call = { url: string; body: string; authorization: string | null };

/**
 * Stub `fetch` with one answer per URL, and record each call.
 * @param answers - URL to the JSON body (and optional status) it answers with.
 */
function stubFetch(answers: Record<string, { status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), body: String(init?.body ?? ''), authorization: headers.authorization ?? null });
    const answer = answers[String(url)] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

beforeEach(() => {
  env.APOLLO_CLIENT_ID = 'ap_client';
  env.APOLLO_CLIENT_SECRET = 'ap_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apollo connect provider', () => {
  it('is configured only when both app credentials are set', () => {
    expect(apolloProvider.configured()).toBe(true);

    env.APOLLO_CLIENT_ID = undefined;

    expect(apolloProvider.configured()).toBe(false);
    expect(() => apolloProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'apollo' })).toThrow(/not configured/);
  });

  it('puts the query AFTER the hash route, because Apollo\'s consent page is a hash route', () => {
    const raw = apolloProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'apollo' });
    const [beforeHash, afterHash] = raw.split('#');

    // A query before the `#` would never reach Apollo's page.
    expect(beforeHash).toBe('https://app.apollo.io/');
    expect(afterHash!.startsWith('/oauth/authorize?')).toBe(true);

    const params = new URLSearchParams(afterHash!.slice(afterHash!.indexOf('?') + 1));

    expect(params.get('client_id')).toBe('ap_client');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe(APOLLO_LOGIN_SCOPES.join(' '));
    expect(params.get('redirect_uri')).toBe(REDIRECT);
    expect(params.get('state')).toBe('st.ate');
  });

  it('turns the code into a login bag and names the account from the profile, read from either body shape', async () => {
    const calls = stubFetch({
      [TOKEN_URL]: { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 2_592_000, scope: 'read_user_profile app_scopes' } },
      [PROFILE_URL]: { body: { user: { email: 'mara@acme.com', name: 'Mara Okafor' } } },
    });

    const result = await apolloProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'Apollo — mara@acme.com',
      credentials: { accessToken: 'at-1', refreshToken: 'rt-1', account: 'mara@acme.com', scope: 'read_user_profile app_scopes' },
    });
    expect(calls.find(call => call.url === PROFILE_URL)?.authorization).toBe('Bearer at-1');

    stubFetch({
      [TOKEN_URL]: { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 2_592_000 } },
      [PROFILE_URL]: { body: { name: 'Mara Okafor' } },
    });

    await expect(apolloProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT }))
      .resolves
      .toMatchObject({ ok: true, displayName: 'Apollo — Mara Okafor' });
  });

  it('expires the 30 day token five minutes early', async () => {
    stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 2_592_000 } }, [PROFILE_URL]: { body: {} } });
    const before = Date.now();

    const result = await apolloProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT });
    const expiresAt = Date.parse((result as unknown as { credentials: { expiresAt: string } }).credentials.expiresAt);

    expect(expiresAt - before).toBeGreaterThan(2_592_000_000 - 301_000);
    expect(expiresAt - before).toBeLessThanOrEqual(2_592_000_000 - 295_000);
  });

  it('refuses with Apollo\'s short code, and without calling Apollo, when the person declined or no code came back', async () => {
    const calls = stubFetch({});

    await expect(apolloProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'access_denied' });
    await expect(apolloProvider.exchange({ query: {}, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'missing_code' });
    expect(calls).toEqual([]);
  });

  it('shows a refused code as Apollo\'s error code', async () => {
    stubFetch({ [TOKEN_URL]: { status: 400, body: { error: 'invalid_grant', error_description: 'echoes the code' } } });

    await expect(apolloProvider.exchange({ query: { code: 'stale' }, redirectUri: REDIRECT }))
      .resolves
      .toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('summarizes a login as its account, and nothing for a pasted API key', () => {
    expect(apolloProvider.summarize({ accessToken: 'a', refreshToken: 'r', expiresAt: 'x', account: 'mara@acme.com' }))
      .toEqual({ account: 'mara@acme.com (Apollo)' });
    expect(apolloProvider.summarize({ token: 'pasted-key' })).toBeNull();
  });
});

describe('refreshApolloGrant', () => {
  it('returns the NEW refresh token Apollo rotated to, because the old pair is revoked', async () => {
    const calls = stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 2_592_000 } } });

    const refreshed = await refreshApolloGrant('rt-1');

    expect(refreshed).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
  });

  it('keeps the refresh token it was given when the response carries none', async () => {
    stubFetch({ [TOKEN_URL]: { body: { access_token: 'at-2', expires_in: 2_592_000 } } });

    await expect(refreshApolloGrant('rt-1')).resolves.toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-1' });
  });

  it('throws the vendor code of a refusal so the sync can say to log in again', async () => {
    stubFetch({ [TOKEN_URL]: { status: 400, body: { error: 'invalid_grant' } } });

    await expect(refreshApolloGrant('rt-1')).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});
