import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// loginGrant.ts imports the database; these tests never touch it.
vi.mock('@/libs/DB');

const { metaProvider, META_LOGIN_SCOPES, refreshMetaGrant } = await import('./meta');

const REDIRECT = 'https://v.example/api/connect/meta/callback';
const TOKEN_URL = 'https://graph.facebook.com/v23.0/oauth/access_token';
const ACCOUNTS_URL = 'https://graph.facebook.com/v23.0/me/adaccounts';

type Call = { url: string; body: string };

/**
 * Stub `fetch`: each URL prefix answers with its queue of bodies in turn.
 * @param answers - URL prefix to the bodies (and statuses) it answers with.
 */
function stubFetch(answers: Record<string, Array<{ status?: number; body: unknown }>>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    const key = Object.keys(answers).find(prefix => String(url).startsWith(prefix));
    const answer = key ? answers[key]!.shift() ?? { status: 404, body: {} } : { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }));
  return calls;
}

beforeEach(() => {
  env.META_APP_ID = 'meta_app';
  env.META_APP_SECRET = 'meta_secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('meta connect provider', () => {
  it('is configured only when the app id and secret are both set, and refuses to start otherwise', () => {
    expect(metaProvider.configured()).toBe(true);

    env.META_APP_SECRET = undefined;

    expect(metaProvider.configured()).toBe(false);
    expect(() => metaProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'meta-ads' })).toThrow(/META_APP_ID and META_APP_SECRET/);
  });

  it('sends the person to Facebook Login for the ads scopes, with the callback and state', () => {
    const url = new URL(metaProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'meta-ads' }));

    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('meta_app');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st.ate');
    expect(url.searchParams.get('scope')).toBe(META_LOGIN_SCOPES.join(','));
    expect(META_LOGIN_SCOPES).toContain('ads_read');
  });

  it('prefers the workspace\'s own Meta login app', () => {
    const url = new URL(metaProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'meta-ads', client: { clientId: 'ws_app', clientSecret: 'ws_secret', owner: 'workspace' } }));

    expect(url.searchParams.get('client_id')).toBe('ws_app');
  });

  it('trades the code for a long-lived token and stores it as a renewable grant with the ad accounts it reaches', async () => {
    const calls = stubFetch({
      [TOKEN_URL]: [{ body: { access_token: 'short-1', expires_in: 7200 } }, { body: { access_token: 'long-1', expires_in: 5_184_000 } }],
      [ACCOUNTS_URL]: [{ body: { data: [{ account_id: '1000001', name: 'Northwind Brand' }, { id: 'act_1000002', name: 'Northwind Hiring' }] } }],
    });

    const result = await metaProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'Meta — 2 ad accounts',
      credentials: {
        accessToken: 'long-1',
        refreshToken: 'long-1',
        adAccounts: [{ id: 'act_1000001', name: 'Northwind Brand' }, { id: 'act_1000002', name: 'Northwind Hiring' }],
        accounts: ['Northwind Brand', 'Northwind Hiring'],
      },
    });
    expect(calls[0]!.body).toContain('code=c0de');
    expect(calls[1]!.body).toContain('grant_type=fb_exchange_token');
    expect(calls[1]!.body).toContain('fb_exchange_token=short-1');
    // The token rides a header to list accounts, never the URL.
    expect(calls[2]!.url).not.toContain('long-1');
  });

  it('turns a refusal on the callback into a safe code, never Meta\'s free text', async () => {
    expect(await metaProvider.exchange({ query: { error: 'access_denied', error_reason: 'user_denied', error_description: 'The user said no <script>' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'user_denied' });
    expect(await metaProvider.exchange({ query: {}, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'missing_code' });
  });

  it('fails the login when Meta refuses the code', async () => {
    stubFetch({ [TOKEN_URL]: [{ status: 400, body: { error: { message: 'bad code', code: 100 } } }] });

    const result = await metaProvider.exchange({ query: { code: 'stale' }, redirectUri: REDIRECT });

    expect(result.ok).toBe(false);
  });

  it('still logs in when the ad accounts cannot be listed', async () => {
    stubFetch({
      [TOKEN_URL]: [{ body: { access_token: 'short-2' } }, { body: { access_token: 'long-2' } }],
      [ACCOUNTS_URL]: [{ status: 403, body: { error: { code: 200 } } }],
    });

    const result = await metaProvider.exchange({ query: { code: 'c' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({ ok: true, displayName: 'Meta — ad accounts', credentials: { accessToken: 'long-2', adAccounts: [] } });
  });

  it('renews a valid long-lived token by trading it for a fresh one', async () => {
    const calls = stubFetch({ [TOKEN_URL]: [{ body: { access_token: 'long-3', expires_in: 5_184_000 } }] });

    const fresh = await refreshMetaGrant('long-2');

    expect(fresh).toMatchObject({ accessToken: 'long-3', refreshToken: 'long-3' });
    expect(calls[0]!.body).toContain('fb_exchange_token=long-2');
  });

  it('refuses to renew without an app', async () => {
    env.META_APP_ID = undefined;

    await expect(refreshMetaGrant('long-2')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('summarizes the grant by ad account name only', () => {
    expect(metaProvider.summarize({ accessToken: 'x', accounts: ['Northwind Brand'] })).toEqual({ account: 'Meta Ads Manager', granted: { label: 'Ad accounts', items: ['Northwind Brand'] } });
    expect(metaProvider.summarize({ token: 'pasted' })).toBeNull();
  });
});
