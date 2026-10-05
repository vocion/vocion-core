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

  it('falls back to a raw access token when there is no refresh token', async () => {
    expect(await resolveGoogleAccessToken({ token: 'raw-token' })).toBe('raw-token');
  });
});
