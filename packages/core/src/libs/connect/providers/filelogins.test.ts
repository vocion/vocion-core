/**
 * "Connect with Dropbox" and "Connect with Box": each sends the person to the
 * vendor with read-only scopes (Dropbox asking for a refresh token), turns
 * the code into a login grant naming the account, refuses the vendor's
 * refusal by its code, and refreshes on the app the login was made with —
 * Dropbox keeping its refresh token, Box saving the rotated one.
 */
import type { LoginClient } from '../serverClients';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Env', () => ({ Env: {} }));
vi.mock('@/libs/DB', () => ({ db: {} }));

const { BOX_LOGIN_SCOPES, boxProvider, refreshBoxGrant } = await import('./box');
const { DROPBOX_LOGIN_SCOPES, dropboxProvider, refreshDropboxGrant } = await import('./dropbox');

const APP: LoginClient = { clientId: 'ws_client', clientSecret: 'ws_secret', owner: 'workspace' };
const REDIRECT = 'https://vocion.example/api/connect/dropbox/callback';

function vendor(route: (url: string) => unknown) {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: typeof init.body === 'string' ? init.body : '' });
    return new Response(JSON.stringify(route(url)), { status: 200 });
  }));
  return calls;
}

beforeEach(() => {
  vi.stubEnv('DROPBOX_CLIENT_ID', 'server_dropbox');
  vi.stubEnv('DROPBOX_CLIENT_SECRET', 'server_secret');
  vi.stubEnv('BOX_CLIENT_ID', 'server_box');
  vi.stubEnv('BOX_CLIENT_SECRET', 'server_secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('dropbox login', () => {
  it('asks for a refresh token and read-only scopes, on the chosen app', () => {
    const url = new URL(dropboxProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'dropbox', client: APP }));

    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('ws_client');
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toBe(DROPBOX_LOGIN_SCOPES.join(' '));
    expect(dropboxProvider.configured()).toBe(true);
  });

  it('turns the code into a grant naming the account, and keeps the refresh token across refreshes', async () => {
    vendor(url => (url.includes('get_current_account') ? { email: 'ops@northwind.example' } : { access_token: 'sl.a', refresh_token: 'rt-1', expires_in: 14_400, account_id: 'dbid:1' }));

    const out = await dropboxProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT, client: APP });

    expect(out).toMatchObject({ ok: true, displayName: 'Dropbox — ops@northwind.example', credentials: { accessToken: 'sl.a', refreshToken: 'rt-1', account: 'ops@northwind.example', accountId: 'dbid:1' } });
    expect(dropboxProvider.summarize((out as { credentials: Record<string, unknown> }).credentials)).toEqual({ account: 'ops@northwind.example (Dropbox)' });

    const calls = vendor(() => ({ access_token: 'sl.b', expires_in: 14_400 }));

    await expect(refreshDropboxGrant('rt-1', APP)).resolves.toMatchObject({ accessToken: 'sl.b', refreshToken: 'rt-1' });
    expect(new URLSearchParams(calls[0]!.body).get('client_id')).toBe('ws_client');
    await expect(dropboxProvider.exchange({ query: { error: 'access_denied' }, redirectUri: REDIRECT })).resolves.toEqual({ ok: false, reason: 'access_denied' });
  });
});

describe('box login', () => {
  it('asks for root_readonly on the chosen app, and falls back to the server\'s', () => {
    const url = new URL(boxProvider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector: 'box' }));

    expect(url.origin + url.pathname).toBe('https://account.box.com/api/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('server_box');
    expect(url.searchParams.get('scope')).toBe(BOX_LOGIN_SCOPES.join(' '));
  });

  it('turns the code into a grant, and a refresh returns the rotated refresh token to save', async () => {
    vendor(url => (url.includes('users/me') ? { login: 'ops@northwind.example' } : { access_token: 'box-a', refresh_token: 'rt-1', expires_in: 3600 }));

    await expect(boxProvider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT, client: APP })).resolves.toMatchObject({ ok: true, credentials: { accessToken: 'box-a', refreshToken: 'rt-1', account: 'ops@northwind.example' } });

    vendor(() => ({ access_token: 'box-b', refresh_token: 'rt-2', expires_in: 3600 }));

    await expect(refreshBoxGrant('rt-1', APP)).resolves.toMatchObject({ accessToken: 'box-b', refreshToken: 'rt-2' });

    vendor(() => ({ access_token: 'box-c' }));

    await expect(refreshBoxGrant('rt-2', APP)).rejects.toThrow(/no_token/);
  });

  it('says it is not set up when neither the workspace nor the server has an app', () => {
    vi.unstubAllEnvs();

    expect(boxProvider.configured()).toBe(false);
    expect(() => boxProvider.authorizeUrl({ state: 's', redirectUri: REDIRECT, connector: 'box' })).toThrow(/BOX_CLIENT_ID and BOX_CLIENT_SECRET/);
  });
});
