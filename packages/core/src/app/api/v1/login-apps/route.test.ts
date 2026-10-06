/**
 * `/api/v1/login-apps` (#1080): a script saves, replaces, lists and revokes a
 * workspace's vendor login app, as an admin does on the Developers page, so a
 * workspace can be set up without the dashboard or a server redeploy. Against
 * PGlite, with only the bearer check and the session stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ApiTokenService')>();
  return { ...actual, authenticateBearer: vi.fn() };
});
vi.mock('@/libs/connect/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/connect/routes')>();
  return { ...actual, connectOrigin: () => 'https://vocion.test' };
});

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer, listTokens, resolvePlatformCredential } = await import('@/services/ApiTokenService');
const { GET } = await import('./route');
const { DELETE, PUT } = await import('./[provider]/route');

const ORG = 'org_login_apps_api';
const SECRET = 'not-a-real-secret-0001';

/**
 * A tenant token's caller, as `authenticateBearer` answers for it.
 * @param role - The role the token was minted with.
 * @param grants - Its action grants.
 */
function tokenCaller(role: 'admin' | 'member', grants: string[] = ['*']) {
  return { orgId: ORG, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role, scope: { orgId: ORG }, grants } };
}

/**
 * A request to the login-app API with a tenant token.
 * @param method - The HTTP method.
 * @param provider - The `:provider` segment, or none for the list.
 * @param body - The JSON body, if any.
 */
function apiRequest(method: string, provider?: string, body?: unknown): Request {
  return new Request(`https://vocion.test/api/v1/login-apps${provider ? `/${provider}` : ''}`, {
    method,
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * The route context for one `:provider`.
 * @param provider - The path segment.
 */
function paramsFor(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

/**
 * Save a Google login app through the API.
 * @param clientId - The app's client ID.
 * @param clientSecret - The app's secret.
 */
async function putGoogleApp(clientId: string, clientSecret: string = SECRET) {
  return PUT(apiRequest('PUT', 'google', { clientId, clientSecret, name: 'Acme Google app' }), paramsFor('google'));
}

beforeEach(() => {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(tokenCaller('admin') as never);
});

afterEach(async () => {
  // api_token references source_dek, so credentials go first.
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

describe('saving a login app through the API', () => {
  it('an admin token saves the app encrypted, and the answer carries the masked client ID and the redirect URL but never the secret', async () => {
    const res = await putGoogleApp('ws-google-client');
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ loginApp: { provider: 'google', name: 'Acme Google app', keyHint: expect.any(String), redirectUrl: 'https://vocion.test/api/connect/google/callback', replaced: false } });
    expect(text).not.toContain(SECRET);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toEqual({ clientId: 'ws-google-client', clientSecret: SECRET });
  });

  it('saving again replaces the app, leaves one live, and says the old app\'s logins need logging in again', async () => {
    await putGoogleApp('ws-google-old');

    const res = await putGoogleApp('ws-google-new', 'not-a-real-secret-0002');
    const body = await res.json();

    expect(body.loginApp).toMatchObject({ replaced: true, note: expect.stringContaining('need an admin to log in with Google again') });
    expect((await listTokens(ORG)).filter(row => row.platform === 'google-login-app')).toHaveLength(1);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'ws-google-new' });
  });

  it('refuses half an app with the Developers form\'s sentence, and stores nothing', async () => {
    const blank = await putGoogleApp('ws-google-client', '   ');
    const missing = await PUT(apiRequest('PUT', 'google', { clientId: 'ws-google-client' }), paramsFor('google'));

    expect(blank.status).toBe(400);
    expect((await blank.json()).error.message).toBe('Enter the Client secret.');
    expect(missing.status).toBe(400);
    expect(await listTokens(ORG)).toEqual([]);
  });

  it('answers 404 for a vendor with no login app, GitHub and PostHog included, naming the ones that have one', async () => {
    for (const provider of ['github', 'posthog', 'not-a-vendor']) {
      const res = await PUT(apiRequest('PUT', provider, { clientId: 'x', clientSecret: SECRET }), paramsFor(provider));

      expect(res.status).toBe(404);
      expect((await res.json()).error.message).toContain('google, slack, atlassian, hubspot, notion, zoom and apollo');
    }

    expect(await listTokens(ORG)).toEqual([]);
  });
});

describe('who may manage login apps', () => {
  it('refuses a request with no token or session', async () => {
    const res = await PUT(new Request('https://vocion.test/api/v1/login-apps/google', { method: 'PUT', body: JSON.stringify({ clientId: 'x', clientSecret: SECRET }) }), paramsFor('google'));

    expect(res.status).toBe(401);
  });

  it('refuses a member\'s token and a member\'s session, as the Developers page does, and stores nothing', async () => {
    vi.mocked(authenticateBearer).mockResolvedValue(tokenCaller('member') as never);

    expect((await putGoogleApp('ws-google-client')).status).toBe(403);

    vi.mocked(clerkAuth).mockResolvedValue({ userId: 'user_member', orgId: ORG, role: 'member', workspaceRole: 'member', has: () => false } as never);
    const sessionPut = await PUT(new Request('https://vocion.test/api/v1/login-apps/google', { method: 'PUT', body: JSON.stringify({ clientId: 'x', clientSecret: SECRET }) }), paramsFor('google'));

    expect(sessionPut.status).toBe(403);
    expect(await listTokens(ORG)).toEqual([]);
  });

  it('lets an admin\'s dashboard session save one too', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ userId: 'user_admin', orgId: ORG, role: 'admin', workspaceRole: 'admin', has: () => true } as never);
    const res = await PUT(new Request('https://vocion.test/api/v1/login-apps/hubspot', { method: 'PUT', body: JSON.stringify({ clientId: 'ws-hubspot', clientSecret: SECRET }) }), paramsFor('hubspot'));

    expect(res.status).toBe(200);
    await expect(resolvePlatformCredential(ORG, 'hubspot-login-app')).resolves.toMatchObject({ clientId: 'ws-hubspot' });
  });
});

describe('listing and revoking login apps', () => {
  it('lists every vendor with whether it has an app, without a secret', async () => {
    await putGoogleApp('ws-google-client');

    const res = await GET(apiRequest('GET'));
    const text = await res.text();
    const { loginApps } = JSON.parse(text) as { loginApps: Array<{ provider: string; saved: boolean; name: string | null }> };

    expect(loginApps.map(app => app.provider)).toEqual(['google', 'slack', 'atlassian', 'hubspot', 'notion', 'zoom', 'apollo']);
    expect(loginApps.filter(app => app.saved)).toEqual([expect.objectContaining({ provider: 'google', name: 'Acme Google app' })]);
    expect(text).not.toContain(SECRET);
  });

  it('revokes the app so new logins stop using it, and a second revoke is safe', async () => {
    await putGoogleApp('ws-google-client');

    const first = await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));
    const second = await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));

    expect(await first.json()).toEqual({ revoked: true });
    expect(await second.json()).toEqual({ revoked: false });
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toBeNull();
  });

  it('revokes only this workspace\'s app', async () => {
    await putGoogleApp('ws-google-client');
    vi.mocked(authenticateBearer).mockResolvedValue({ ...tokenCaller('admin'), orgId: 'org_someone_else', principal: { ...tokenCaller('admin').principal, scope: { orgId: 'org_someone_else' } } } as never);

    expect(await (await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'))).json()).toEqual({ revoked: false });
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'ws-google-client' });
  });
});
