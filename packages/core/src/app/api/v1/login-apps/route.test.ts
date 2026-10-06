/**
 * `/api/v1/login-apps` (#1080): a script saves, replaces, lists and revokes a
 * workspace's vendor login app, as an admin does on the Developers page, so a
 * workspace can be set up without the dashboard or a server redeploy. Against
 * PGlite, with only the bearer check and the session stubbed.
 */
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ApiTokenService')>();
  // `storePlatformKey` runs for real unless a test queues a one-off failure.
  return { ...actual, authenticateBearer: vi.fn(), storePlatformKey: vi.fn(actual.storePlatformKey) };
});
vi.mock('@/libs/connect/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/connect/routes')>();
  return { ...actual, connectOrigin: vi.fn(() => 'https://vocion.test') };
});

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { connectOrigin } = await import('@/libs/connect/routes');
const { logger } = await import('@/libs/Logger');
const { authenticateBearer, listTokens, resolvePlatformCredential, storePlatformKey } = await import('@/services/ApiTokenService');
const { GET } = await import('./route');
const { DELETE, PUT } = await import('./[provider]/route');

const ORG = 'org_login_apps_api';
const OTHER_ORG = 'org_someone_else';
const SECRET = 'not-a-real-secret-0001';

/**
 * A tenant token's caller, as `authenticateBearer` answers for it.
 * @param role - The role the token was minted with.
 * @param orgId - The workspace it belongs to.
 */
function tokenCaller(role: 'admin' | 'member', orgId: string = ORG) {
  return { orgId, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role, scope: { orgId }, grants: [] } };
}

/**
 * A signed-in dashboard session in this workspace.
 * @param userId - The person.
 * @param role - Their workspace role.
 */
function sessionAs(userId: string, role: 'admin' | 'member') {
  vi.mocked(clerkAuth).mockResolvedValue({ userId, orgId: ORG, role, workspaceRole: role, has: () => role === 'admin' } as never);
}

/**
 * A request with no `Authorization` header, so the session is used.
 * @param method - The HTTP method.
 * @param provider - The `:provider` segment, or none for the list.
 * @param body - The JSON body, if any.
 */
function sessionRequest(method: string, provider?: string, body?: unknown): Request {
  return new Request(`https://vocion.test/api/v1/login-apps${provider ? `/${provider}` : ''}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * A request whose body is sent exactly as given, not JSON-encoded.
 * @param rawBody - The body text.
 */
function rawPut(rawBody: string): Request {
  return new Request('https://vocion.test/api/v1/login-apps/google', {
    method: 'PUT',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: rawBody,
  });
}

/**
 * The live Google login-app rows, read straight from the table so a test can
 * see who saved them.
 */
async function liveGoogleRows() {
  const rows = await db.select().from(apiTokenSchema);
  return rows.filter(row => row.platform === 'google-login-app' && row.revokedAt === null);
}

/** A database unique violation, as Postgres reports two saves landing at once. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "api_token_org_platform_live_idx"'), { code: '23505' });
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
  // Back to the real save and the fixed origin, dropping any failure or null a
  // test queued and did not use.
  vi.mocked(storePlatformKey).mockReset();
  vi.mocked(connectOrigin).mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  // api_token references source_dek, so credentials go first.
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

describe('saving a login app through the API', () => {
  it('an admin token saves the app encrypted, and the answer carries the masked client ID and the redirect URL but never the secret', async () => {
    const res = await putGoogleApp('ws-google-client');
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ loginApp: { provider: 'google', vendor: 'Google', name: 'Acme Google app', keyHint: expect.any(String), redirectUrl: 'https://vocion.test/api/connect/google/callback', replaced: false, loginsNeedLoggingInAgain: false, note: null } });
    expect(text).not.toContain(SECRET);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toEqual({ clientId: 'ws-google-client', clientSecret: SECRET });
  });

  it('saving a different app replaces it, leaves one live, and says the old app\'s logins need logging in again', async () => {
    await putGoogleApp('ws-google-old');

    const res = await putGoogleApp('ws-google-new', 'not-a-real-secret-0002');
    const body = await res.json();

    expect(body.loginApp).toMatchObject({ replaced: true, loginsNeedLoggingInAgain: true, note: expect.stringContaining('need an admin to log in with Google again') });
    expect((await listTokens(ORG)).filter(row => row.platform === 'google-login-app')).toHaveLength(1);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'ws-google-new' });
  });

  it('a new secret for the same app replaces it without telling anyone to log in again, since logins follow the client ID', async () => {
    await putGoogleApp('ws-google-client');

    const res = await putGoogleApp('  ws-google-client  ', 'not-a-real-secret-0002');

    expect((await res.json()).loginApp).toMatchObject({ replaced: true, loginsNeedLoggingInAgain: false, note: null });
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toEqual({ clientId: 'ws-google-client', clientSecret: 'not-a-real-secret-0002' });
  });

  it('saving after a revoke is a fresh save, not a replace', async () => {
    await putGoogleApp('ws-google-old');
    await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));

    const res = await putGoogleApp('ws-google-new');

    expect((await res.json()).loginApp).toMatchObject({ replaced: false, loginsNeedLoggingInAgain: false });
  });

  it('records who saved it: the token for a script, the person for a session', async () => {
    await putGoogleApp('ws-google-by-token');

    expect((await liveGoogleRows()).map(row => row.createdBy)).toEqual(['token:t1']);

    sessionAs('user_admin', 'admin');
    await PUT(sessionRequest('PUT', 'google', { clientId: 'ws-google-by-session', clientSecret: SECRET }), paramsFor('google'));

    expect((await liveGoogleRows()).map(row => row.createdBy)).toEqual(['user_admin']);
  });

  it('defaults the name to the vendor\'s login app and trims a given one', async () => {
    const unnamed = await PUT(apiRequest('PUT', 'slack', { clientId: 'ws-slack', clientSecret: SECRET }), paramsFor('slack'));
    const named = await PUT(apiRequest('PUT', 'zoom', { clientId: 'ws-zoom', clientSecret: SECRET, name: '  Acme Zoom  ' }), paramsFor('zoom'));

    expect((await unnamed.json()).loginApp.name).toBe('Slack login app');
    expect((await named.json()).loginApp.name).toBe('Acme Zoom');
    expect((await listTokens(ORG)).map(row => row.name).sort()).toEqual(['Acme Zoom', 'Slack login app']);
  });

  it('refuses half an app with the Developers form\'s sentence, and stores nothing', async () => {
    const blank = await putGoogleApp('ws-google-client', '   ');
    const missing = await PUT(apiRequest('PUT', 'google', { clientId: 'ws-google-client' }), paramsFor('google'));
    const nullId = await PUT(apiRequest('PUT', 'google', { clientId: null, clientSecret: SECRET }), paramsFor('google'));

    expect(blank.status).toBe(400);
    expect((await blank.json()).error.message).toBe('Enter the Client secret.');
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.details).toEqual({ field: 'clientSecret' });
    expect(nullId.status).toBe(400);
    expect((await nullId.json()).error.details).toEqual({ field: 'clientId' });
    expect(await listTokens(ORG)).toEqual([]);
  });

  it('refuses an over-long value or a bad name, naming the field, and stores nothing', async () => {
    const cases: Array<{ body: Record<string, unknown>; field: string }> = [
      { body: { clientId: 'x'.repeat(8193), clientSecret: SECRET }, field: 'clientId' },
      { body: { clientId: 'ws-google-client', clientSecret: 'x'.repeat(8193) }, field: 'clientSecret' },
      { body: { clientId: 'ws-google-client', clientSecret: SECRET, name: '   ' }, field: 'name' },
      { body: { clientId: 'ws-google-client', clientSecret: SECRET, name: 'x'.repeat(81) }, field: 'name' },
      { body: { clientId: 'ws-google-client', clientSecret: SECRET, name: 123 }, field: 'name' },
    ];
    for (const { body, field } of cases) {
      const res = await PUT(apiRequest('PUT', 'google', body), paramsFor('google'));

      expect(res.status).toBe(400);
      expect((await res.json()).error.details).toEqual({ field });
    }

    expect(await listTokens(ORG)).toEqual([]);
  });

  it('refuses a body that is not a JSON object, without logging the part of the secret a parse error quotes', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Unquoted, so the parser stops inside the secret and its message quotes
    // the text around it: `..."tSecret":not-a-real-"...`.
    const broken = await PUT(rawPut(`{"clientId":"ws-google-client","clientSecret":${SECRET}}`), paramsFor('google'));
    const array = await PUT(rawPut('[]'), paramsFor('google'));

    expect(broken.status).toBe(400);
    expect(array.status).toBe(400);
    expect(logged).toHaveBeenCalled();
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain(SECRET.slice(0, 10));
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

  it('a failed save answers 500 without the secret, in the answer or the log', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.mocked(storePlatformKey).mockRejectedValueOnce(new Error(`insert failed for values ("ws-google-client", "${SECRET}")`));

    const res = await putGoogleApp('ws-google-client');

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRET);
    expect(logged).toHaveBeenCalled();
    expect(inspect(logged.mock.calls, { depth: 5 })).not.toContain(SECRET);
  });
});

describe('two saves of the same app at once', () => {
  it('a save that collides with another one tries again and wins, leaving one live app', async () => {
    await putGoogleApp('ws-google-first');
    vi.mocked(storePlatformKey).mockRejectedValueOnce(uniqueViolation());

    const res = await putGoogleApp('ws-google-second');

    expect(res.status).toBe(200);
    expect((await res.json()).loginApp).toMatchObject({ replaced: true, loginsNeedLoggingInAgain: true });
    expect(await liveGoogleRows()).toHaveLength(1);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'ws-google-second' });
  });

  it('answers 409, asking for the save again, when it keeps colliding', async () => {
    vi.mocked(storePlatformKey).mockRejectedValueOnce(uniqueViolation()).mockRejectedValueOnce(uniqueViolation());

    const res = await putGoogleApp('ws-google-client');

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Send this one again') });
  });
});

describe('who may manage login apps', () => {
  it('refuses a request with no token or session', async () => {
    const res = await PUT(sessionRequest('PUT', 'google', { clientId: 'x', clientSecret: SECRET }), paramsFor('google'));

    expect(res.status).toBe(401);
  });

  it('refuses a member\'s token on every call, and a member cannot revoke the workspace\'s app', async () => {
    await putGoogleApp('ws-google-client');
    vi.mocked(authenticateBearer).mockResolvedValue(tokenCaller('member') as never);

    expect((await putGoogleApp('ws-google-other')).status).toBe(403);
    expect((await GET(apiRequest('GET'))).status).toBe(403);
    expect((await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'))).status).toBe(403);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'ws-google-client' });
  });

  it('refuses a member\'s session on every call, as the Developers page does', async () => {
    sessionAs('user_member', 'member');

    expect((await PUT(sessionRequest('PUT', 'google', { clientId: 'x', clientSecret: SECRET }), paramsFor('google'))).status).toBe(403);
    expect((await GET(sessionRequest('GET'))).status).toBe(403);
    expect((await DELETE(sessionRequest('DELETE', 'google'), paramsFor('google'))).status).toBe(403);
    expect(await listTokens(ORG)).toEqual([]);
  });

  it('lets an admin\'s dashboard session save one too', async () => {
    sessionAs('user_admin', 'admin');
    const res = await PUT(sessionRequest('PUT', 'hubspot', { clientId: 'ws-hubspot', clientSecret: SECRET }), paramsFor('hubspot'));

    expect(res.status).toBe(200);
    await expect(resolvePlatformCredential(ORG, 'hubspot-login-app')).resolves.toMatchObject({ clientId: 'ws-hubspot' });
  });
});

describe('listing and revoking login apps', () => {
  it('lists every vendor with whether it has an app, its masked client ID and when it was saved, without a secret', async () => {
    await putGoogleApp('ws-google-client');

    const res = await GET(apiRequest('GET'));
    const text = await res.text();
    const { loginApps } = JSON.parse(text) as { loginApps: Array<{ provider: string; saved: boolean }> };

    expect(loginApps.map(app => app.provider)).toEqual(['google', 'slack', 'atlassian', 'hubspot', 'notion', 'zoom', 'apollo']);
    expect(loginApps.filter(app => app.saved)).toEqual([{ provider: 'google', vendor: 'Google', saved: true, name: 'Acme Google app', keyHint: expect.any(String), savedAt: expect.any(String), redirectUrl: 'https://vocion.test/api/connect/google/callback' }]);
    expect(loginApps.find(app => app.provider === 'slack')).toEqual({ provider: 'slack', vendor: 'Slack', saved: false, name: null, keyHint: null, savedAt: null, redirectUrl: 'https://vocion.test/api/connect/slack/callback' });
    expect(text).not.toContain(SECRET);
  });

  it('lists one app after a replace, and none after a revoke', async () => {
    await putGoogleApp('ws-google-old');
    const replaced = await (await putGoogleApp('ws-google-new')).json();

    const afterReplace = (await (await GET(apiRequest('GET'))).json()).loginApps.filter((app: { saved: boolean }) => app.saved);

    expect(afterReplace).toEqual([expect.objectContaining({ provider: 'google', keyHint: replaced.loginApp.keyHint })]);

    await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));
    const afterRevoke = (await (await GET(apiRequest('GET'))).json()).loginApps.find((app: { provider: string }) => app.provider === 'google');

    expect(afterRevoke).toMatchObject({ saved: false, name: null, keyHint: null, savedAt: null });
  });

  it('leaves the redirect URL out when the server has no public address', async () => {
    vi.mocked(connectOrigin).mockReturnValue(null);

    const listed = (await (await GET(apiRequest('GET'))).json()).loginApps;
    const saved = (await (await putGoogleApp('ws-google-client')).json()).loginApp;

    expect(listed.every((app: { redirectUrl: string | null }) => app.redirectUrl === null)).toBe(true);
    expect(saved.redirectUrl).toBeNull();
  });

  it('revokes the app so new logins stop using it, a second revoke is safe, and the audit line says who revoked it', async () => {
    const audit = vi.spyOn(logger, 'info');
    await putGoogleApp('ws-google-client');

    const first = await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));
    const second = await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));

    expect(await first.json()).toEqual({ revoked: true });
    expect(await second.json()).toEqual({ revoked: false });
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toBeNull();
    expect(audit).toHaveBeenCalledWith('[login-apps] login app revoked', expect.objectContaining({ orgId: ORG, provider: 'google', revokedBy: 'token:t1' }));
  });

  it('touches only the caller\'s workspace: another workspace\'s admin can neither revoke nor replace this one\'s app', async () => {
    await putGoogleApp('ws-google-client');
    vi.mocked(authenticateBearer).mockResolvedValue(tokenCaller('admin', OTHER_ORG) as never);

    const revoke = await DELETE(apiRequest('DELETE', 'google'), paramsFor('google'));
    const save = await putGoogleApp('other-google-client');

    expect(await revoke.json()).toEqual({ revoked: false });
    expect((await save.json()).loginApp.replaced).toBe(false);
    await expect(resolvePlatformCredential(ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'ws-google-client' });
    await expect(resolvePlatformCredential(OTHER_ORG, 'google-login-app')).resolves.toMatchObject({ clientId: 'other-google-client' });
  });
});
