/**
 * The Zoom provider against a mocked `fetch`: the authorize URL carries what
 * zoom.us requires, the exchange turns a code into the grant bag (Basic auth,
 * form body) or refuses with a safe reason, and a refresh keeps Zoom's
 * rotated refresh token.
 */

import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/DB');

const { TokenRequestError } = await import('@/libs/connect/loginGrant');
const { refreshZoomGrant, zoomProvider } = await import('@/libs/connect/providers/zoom');

type Call = { url: string; init: RequestInit };

/**
 * Stub `fetch` with one handler and return the calls it saw.
 * @param handler - Maps a URL to a response.
 */
function stubFetch(handler: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input));
  });
  return calls;
}

const TOKEN = { access_token: 'at-1', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-1', scope: 'user:read:user' };
const REDIRECT = 'https://v.example/api/connect/zoom/callback';

beforeEach(() => {
  env.ZOOM_CLIENT_ID = 'zoom-cid';
  env.ZOOM_CLIENT_SECRET = 'zoom-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zoomProvider authorize and configuration', () => {
  it('is configured only when both halves of the app are set', () => {
    expect(zoomProvider.configured()).toBe(true);

    env.ZOOM_CLIENT_SECRET = '';

    expect(zoomProvider.configured()).toBe(false);
  });

  it('refuses to build an authorize URL without an app, so nobody is sent to Zoom with an empty client id', () => {
    env.ZOOM_CLIENT_ID = '';

    expect(() => zoomProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'zoom' })).toThrow(/ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET/);
  });

  it('sends the client id, the callback and the signed state with response_type=code', () => {
    const url = new URL(zoomProvider.authorizeUrl({ state: 'st.sig', redirectUri: REDIRECT, connector: 'zoom' }));

    expect(`${url.origin}${url.pathname}`).toBe('https://zoom.us/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('zoom-cid');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('st.sig');
  });
});

describe('zoomProvider exchange', () => {
  it('stores the grant with the person\'s email, signs the request with Basic auth, and never puts the secret in the body', async () => {
    const calls = stubFetch(url => url.includes('/oauth/token')
      ? Response.json(TOKEN)
      : Response.json({ email: 'ana@acme.com', account_id: 'acct-9' }));

    const result = await zoomProvider.exchange({ query: { code: 'c1' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({
      ok: true,
      displayName: 'Zoom — ana@acme.com',
      credentials: { accessToken: 'at-1', refreshToken: 'rt-1', email: 'ana@acme.com', accountId: 'acct-9' },
    });

    const tokenCall = calls.find(call => call.url.includes('/oauth/token'))!;
    const headers = tokenCall.init.headers as Record<string, string>;

    expect(headers.authorization).toBe(`Basic ${Buffer.from('zoom-cid:zoom-secret').toString('base64')}`);
    expect(String(tokenCall.init.body)).not.toContain('zoom-secret');
    expect(new URLSearchParams(String(tokenCall.init.body)).get('grant_type')).toBe('authorization_code');
    expect(calls.find(call => call.url.endsWith('/users/me'))!.init.headers).toMatchObject({ authorization: 'Bearer at-1' });
  });

  it('still stores the login, under a plain name, when Zoom will not say who it is', async () => {
    stubFetch(url => url.includes('/oauth/token') ? Response.json(TOKEN) : new Response('nope', { status: 401 }));

    const result = await zoomProvider.exchange({ query: { code: 'c1' }, redirectUri: REDIRECT });

    expect(result).toMatchObject({ ok: true, displayName: 'Zoom', credentials: { email: null } });
  });

  it('reports a declined consent by its safe code, and a callback without a code as missing_code', async () => {
    expect(await zoomProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'access_denied' });
    expect(await zoomProvider.exchange({ query: { error: 'bad value with spaces & <script>' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'authorization_refused' });
    expect(await zoomProvider.exchange({ query: {}, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'missing_code' });
  });

  it('reports Zoom\'s refusal of the code by its OAuth error code, not its free text', async () => {
    stubFetch(() => Response.json({ error: 'invalid_grant', reason: 'Invalid authorization code: c1' }, { status: 400 }));

    expect(await zoomProvider.exchange({ query: { code: 'c1' }, redirectUri: REDIRECT })).toEqual({ ok: false, reason: 'invalid_grant' });
  });
});

describe('refreshZoomGrant', () => {
  it('returns the rotated refresh token so the next sync does not use the dead one', async () => {
    const calls = stubFetch(() => Response.json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }));

    const refreshed = await refreshZoomGrant('rt-1');

    expect(refreshed).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('refresh_token')).toBe('rt-1');
  });

  it('throws a TokenRequestError carrying Zoom\'s code when the refresh token is dead', async () => {
    stubFetch(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));

    await expect(refreshZoomGrant('rt-old')).rejects.toBeInstanceOf(TokenRequestError);
    await expect(refreshZoomGrant('rt-old')).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('zoomProvider summarize', () => {
  it('shows the email for a login and nothing for a pasted Server-to-Server bag', () => {
    expect(zoomProvider.summarize({ accessToken: 'a', refreshToken: 'r', expiresAt: 'x', email: 'ana@acme.com' })).toEqual({ account: 'ana@acme.com' });
    expect(zoomProvider.summarize({ accountId: 'a', clientId: 'c', clientSecret: 's' })).toBeNull();
  });
});
