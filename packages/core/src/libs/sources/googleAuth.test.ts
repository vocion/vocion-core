import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// A login refreshes on the app it was made with, which may be the workspace's
// own Google login app in the credential store: a real in-memory database.
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, sourceDekSchema } = await import('@/models/Schema');
const { storePlatformKey } = await import('@/services/ApiTokenService');
const { resolveGoogleAccessToken } = await import('./googleAuth');

const ORG = 'org_google_auth';

/**
 * Save the workspace's own Google login app, as an admin does on the Developers page.
 * @param clientId - The app's client ID.
 * @param clientSecret - The app's client secret.
 */
async function saveWorkspaceGoogleApp(clientId: string, clientSecret: string): Promise<void> {
  await storePlatformKey({ orgId: ORG, name: 'Our Google app', platform: 'google-login-app', values: { clientId, clientSecret } });
}

/**
 * A fetch answer for Google's token endpoint.
 * @param accessToken - The token to hand back.
 */
function tokenResponse(accessToken: string): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }));
}

describe('resolveGoogleAccessToken', () => {
  beforeEach(() => {
    env.GOOGLE_OAUTH_CLIENT_ID = 'env_client';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'env_client_key';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // api_token references source_dek, so credentials go first.
    await db.delete(apiTokenSchema);
    await db.delete(sourceDekSchema);
  });

  it('refreshes a login bag with the deployment\'s OAuth client, since the bag stores none', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('fresh-login'));

    const token = await resolveGoogleAccessToken({ accessToken: 'old', refreshToken: 'login-refresh-1', expiresAt: '2000-01-01T00:00:00Z', email: 'a@b.c' }, ORG);

    expect(token).toBe('fresh-login');

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));

    expect(body.get('client_id')).toBe('env_client');
    expect(body.get('client_secret')).toBe('env_client_key');
    expect(body.get('refresh_token')).toBe('login-refresh-1');
  });

  it('keeps using a pasted client over the deployment\'s', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('fresh-pasted'));

    await resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-1', clientId: 'own_client', clientSecret: 'own_client_key' }, ORG);

    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)).get('client_id')).toBe('own_client');
  });

  it('a pasted client missing its secret is refused, never refreshed with the deployment\'s client it was not minted for', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-3', clientId: 'own_client' }, ORG)).rejects.toThrow(/only half of its OAuth client/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with no Google app on the server or the workspace, says where to save one instead of calling Google with an empty client', async () => {
    env.GOOGLE_OAUTH_CLIENT_SECRET = undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-2' }, ORG)).rejects.toThrow('No Google app is set up any more, on this server or on the Developers page, so this login cannot be refreshed. An admin needs to save a Google login app on the Developers page (or set the Google app up on the server), then log in with Google again.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a login Google will not refresh says to log in with Google again, without echoing Google\'s description', async () => {
    // Google's answer to a revoked refresh token, or one from a "Testing" app older than 7 days.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-3' }, ORG))
      .rejects
      .toThrow(/^Google would not refresh the login \(invalid_grant\)\. An admin needs to log in with Google again on the Connectors page\.$/);
  });

  it('a pasted refresh token Google refuses asks for a new paste or a login, since the pasted client is not this deployment\'s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-4', clientId: 'own_client', clientSecret: 'own_client_key' }, ORG))
      .rejects
      .toThrow('Google refused the pasted refresh token (invalid_grant). An admin needs to paste a new one, or log in with Google, on the Connectors page.');
  });

  it('a Google outage says to try again later, not to log in again', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Service Unavailable</html>', { status: 503 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-4' }, ORG)).rejects.toThrow('Google could not refresh the access token just now (http_503). Try again in a few minutes.');
  });

  it('a login refused for this server\'s OAuth client names the server settings, since logging in again cannot fix it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }), { status: 401 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-5' }, ORG))
      .rejects
      .toThrow('Google refused this server\'s OAuth client (invalid_client), so logging in again will not help. An admin needs to check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on the server.');
  });

  it('a pasted client Google refuses says to paste it again, since this server\'s settings are not the problem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-7', clientId: 'own_client', clientSecret: 'own_client_key' }, ORG))
      .rejects
      .toThrow('Google refused the pasted OAuth client (invalid_client). An admin needs to paste the client ID and secret again, or log in with Google, on the Connectors page.');
  });

  it('a refresh answered without an access token is refused rather than cached as an empty token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-6' }, ORG)).rejects.toThrow('Google answered the token refresh without an access token.');
  });

  it('a login made on the workspace\'s own Google login app refreshes on that app, not the server\'s, since the refresh token only works with its own client', async () => {
    await saveWorkspaceGoogleApp('ws_client', 'ws_client_key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('fresh-workspace'));

    const token = await resolveGoogleAccessToken({ refreshToken: 'login-refresh-ws-1', loginClientId: 'ws_client' }, ORG);

    expect(token).toBe('fresh-workspace');

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));

    expect(body.get('client_id')).toBe('ws_client');
    expect(body.get('client_secret')).toBe('ws_client_key');
  });

  it('a login made before workspace login apps keeps refreshing on the server\'s app, even once the workspace saves its own', async () => {
    await saveWorkspaceGoogleApp('ws_client', 'ws_client_key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('fresh-legacy'));

    await resolveGoogleAccessToken({ refreshToken: 'login-refresh-legacy-1' }, ORG);

    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)).get('client_id')).toBe('env_client');
  });

  it('a login whose login app the workspace replaced says to log in again, without calling Google with the wrong client', async () => {
    await saveWorkspaceGoogleApp('ws_client_new', 'ws_client_new_key');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-ws-2', loginClientId: 'ws_client_old' }, ORG))
      .rejects
      .toThrow('This Google login was made with a Google app that is no longer set up (it was replaced or removed), so it cannot be refreshed. An admin needs to log in with Google again on the Connectors page, first saving a Google login app on the Developers page if there is none.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a workspace login app Google refuses points at the Developers page, not the server settings', async () => {
    await saveWorkspaceGoogleApp('ws_client', 'ws_client_key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-ws-3', loginClientId: 'ws_client' }, ORG))
      .rejects
      .toThrow('Google refused this workspace\'s Google login app (invalid_client), so logging in again will not help. An admin needs to check its client ID and secret on the Developers page.');
  });

  it('falls back to a raw access token when there is no refresh token', async () => {
    expect(await resolveGoogleAccessToken({ token: 'raw-token' }, ORG)).toBe('raw-token');
  });
});
