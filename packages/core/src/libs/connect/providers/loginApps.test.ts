/**
 * Every provider a workspace can bring its own login app for (#1080): the
 * login, the code exchange and the refresh all run on the app the caller
 * chose, and on the server's env app only when no app was chosen. One table,
 * so a provider added to the login apps without honouring the chosen client
 * fails here rather than at a customer's consent screen.
 */
import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// The providers import the refresh, which imports the database; none of these calls reach it.
vi.mock('@/libs/DB', () => ({ db: {} }));

const { apolloProvider, refreshApolloGrant } = await import('./apollo');
const { atlassianProvider } = await import('./atlassian');
const { googleProvider } = await import('./google');
const { hubspotProvider, refreshHubspotGrant } = await import('./hubspot');
const { notionProvider } = await import('./notion');
const { slackProvider } = await import('./slack');
const { refreshZoomGrant, zoomProvider } = await import('./zoom');
const { refreshAtlassianGrant } = await import('@/libs/atlassian/oauth');
const { connectProviders } = await import('../registry');
const { loginAppPlatformFor } = await import('@/libs/platforms/registry');

const WORKSPACE_APP: LoginClient = { clientId: 'ws_client', clientSecret: 'ws_secret', owner: 'workspace' };
const REDIRECT = 'https://v.example/api/connect/any/callback';

/** Each provider with a login app, and a connector it serves. */
const LOGIN_APP_PROVIDERS: Array<{ provider: ConnectProvider; connector: string }> = [
  { provider: googleProvider, connector: 'gmail' },
  { provider: slackProvider, connector: 'slack' },
  { provider: atlassianProvider, connector: 'jira' },
  { provider: hubspotProvider, connector: 'hubspot' },
  { provider: notionProvider, connector: 'notion' },
  { provider: zoomProvider, connector: 'zoom' },
  { provider: apolloProvider, connector: 'apollo' },
];

/** Each refresh that takes the login's app, by the provider it belongs to. */
const REFRESHES: Array<{ id: string; refresh: (refreshToken: string, client?: LoginClient) => Promise<unknown> }> = [
  { id: 'hubspot', refresh: refreshHubspotGrant },
  { id: 'zoom', refresh: refreshZoomGrant },
  { id: 'apollo', refresh: refreshApolloGrant },
  { id: 'atlassian', refresh: refreshAtlassianGrant },
];

/**
 * The query of an authorize URL, including Apollo's, which sits after a `#`.
 * @param url - The URL the provider sends the person to.
 */
function authorizeParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const query = parsed.search || parsed.hash.slice(parsed.hash.indexOf('?'));
  return new URLSearchParams(query);
}

/**
 * The client a token request carried: in an HTTP Basic header, a JSON body or a form body.
 * @param init - The request the provider sent.
 */
function clientSentWith(init: RequestInit | undefined): { clientId: string | null; clientSecret: string | null } {
  const authorization = new Headers(init?.headers).get('authorization');
  if (authorization?.startsWith('Basic ')) {
    const [clientId = null, clientSecret = null] = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8').split(':');
    return { clientId, clientSecret };
  }
  const body = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
  if (body.trim().startsWith('{')) {
    const json = JSON.parse(body) as Record<string, string | undefined>;
    return { clientId: json.client_id ?? null, clientSecret: json.client_secret ?? null };
  }
  const form = new URLSearchParams(body);
  return { clientId: form.get('client_id'), clientSecret: form.get('client_secret') };
}

/** A vendor that refuses every token request, so each call sends exactly one. */
function refusingVendor() {
  return vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
}

describe('a workspace\'s own login app, for every provider that takes one', () => {
  beforeEach(() => {
    for (const id of ['SLACK', 'HUBSPOT', 'NOTION', 'ZOOM', 'APOLLO']) {
      env[`${id}_CLIENT_ID`] = `server_${id.toLowerCase()}`;
      env[`${id}_CLIENT_SECRET`] = 'server_secret';
    }
    env.GOOGLE_OAUTH_CLIENT_ID = 'server_google';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'server_secret';
    vi.stubEnv('ATLASSIAN_CLIENT_ID', 'server_atlassian');
    vi.stubEnv('ATLASSIAN_CLIENT_SECRET', 'server_secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('the table covers every provider with a login app, so a new one cannot skip these checks', () => {
    const withLoginApp = connectProviders().filter(provider => loginAppPlatformFor(provider.id)).map(provider => provider.id).sort();

    expect(LOGIN_APP_PROVIDERS.map(entry => entry.provider.id).sort()).toEqual(withLoginApp);
  });

  it.each(LOGIN_APP_PROVIDERS)('$provider.id sends the person to the vendor with the workspace app\'s client ID, not the server\'s', ({ provider, connector }) => {
    const url = provider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector, client: WORKSPACE_APP });

    expect(authorizeParams(url).get('client_id')).toBe('ws_client');
  });

  it.each(LOGIN_APP_PROVIDERS)('$provider.id falls back to the server\'s app when no app was chosen', ({ provider, connector }) => {
    const url = provider.authorizeUrl({ state: 'st.ate', redirectUri: REDIRECT, connector });

    expect(authorizeParams(url).get('client_id')).toBe(`server_${provider.id}`);
  });

  it.each(LOGIN_APP_PROVIDERS)('$provider.id trades the code with the workspace app\'s client ID and secret, the pair the consent was given to', async ({ provider }) => {
    const vendor = refusingVendor();
    vi.stubGlobal('fetch', vendor);

    await provider.exchange({ query: { code: 'c0de' }, redirectUri: REDIRECT, client: WORKSPACE_APP });

    const calls = vendor.mock.calls as unknown as Array<[string, RequestInit]>;

    expect(calls).toHaveLength(1);
    expect(clientSentWith(calls[0]![1])).toEqual({ clientId: 'ws_client', clientSecret: 'ws_secret' });
  });

  it.each(REFRESHES)('$id refreshes with the app the login was made on', async ({ refresh }) => {
    const vendor = refusingVendor();
    vi.stubGlobal('fetch', vendor);

    await expect(refresh('refresh-1', WORKSPACE_APP)).rejects.toThrow();

    const calls = vendor.mock.calls as unknown as Array<[string, RequestInit]>;

    expect(clientSentWith(calls[0]![1])).toEqual({ clientId: 'ws_client', clientSecret: 'ws_secret' });
  });
});
