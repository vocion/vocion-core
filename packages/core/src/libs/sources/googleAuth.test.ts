import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { resolveGoogleAccessToken } = await import('./googleAuth');

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes a login bag with the deployment\'s OAuth client, since the bag stores none', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('fresh-login'));

    const token = await resolveGoogleAccessToken({ accessToken: 'old', refreshToken: 'login-refresh-1', expiresAt: '2000-01-01T00:00:00Z', email: 'a@b.c' });

    expect(token).toBe('fresh-login');

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));

    expect(body.get('client_id')).toBe('env_client');
    expect(body.get('client_secret')).toBe('env_client_key');
    expect(body.get('refresh_token')).toBe('login-refresh-1');
  });

  it('keeps using a pasted client over the deployment\'s', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('fresh-pasted'));

    await resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-1', clientId: 'own_client', clientSecret: 'own_client_key' });

    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)).get('client_id')).toBe('own_client');
  });

  it('a pasted client missing its secret is refused, never refreshed with the deployment\'s client it was not minted for', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-3', clientId: 'own_client' })).rejects.toThrow(/only half of its OAuth client/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the server client is unset instead of calling Google with an empty one', async () => {
    env.GOOGLE_OAUTH_CLIENT_SECRET = undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-2' })).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a login Google will not refresh says to log in with Google again, without echoing Google\'s description', async () => {
    // Google's answer to a revoked refresh token, or one from a "Testing" app older than 7 days.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-3' }))
      .rejects
      .toThrow(/^Google would not refresh the login \(invalid_grant\)\. Log in with Google again on the Connectors page\.$/);
  });

  it('a pasted refresh token Google refuses asks for a new paste or a login, since the pasted client is not this deployment\'s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'pasted-refresh-4', clientId: 'own_client', clientSecret: 'own_client_key' }))
      .rejects
      .toThrow('Google refused the pasted refresh token (invalid_grant). Paste a new one, or log in with Google on the Connectors page.');
  });

  it('a Google outage says the next sync tries again, not to log in again', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Service Unavailable</html>', { status: 503 }));

    await expect(resolveGoogleAccessToken({ refreshToken: 'login-refresh-4' })).rejects.toThrow('Google did not answer the token refresh (http_503). The next sync tries again.');
  });

  it('falls back to a raw access token when there is no refresh token', async () => {
    expect(await resolveGoogleAccessToken({ token: 'raw-token' })).toBe('raw-token');
  });
});
