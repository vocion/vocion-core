import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const { ga4Connector } = await import('./ga4');

/**
 * Run one GA4 sync and collect the ids of its docs.
 * @param credentials - The stored credential bag.
 */
async function runSync(credentials: Record<string, unknown>): Promise<string[]> {
  const ids: string[] = [];
  const docs = ga4Connector.sync({ config: { propertyId: '123' }, credentials } as never);
  for await (const doc of docs) {
    ids.push(doc.externalId);
  }
  return ids;
}

describe('ga4 connector auth', () => {
  beforeEach(() => {
    env.GOOGLE_OAUTH_CLIENT_ID = 'env_client';
    env.GOOGLE_OAUTH_CLIENT_SECRET = 'env_client_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs with a Google login: the report is read with a token minted from the refresh token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'minted-ga4', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: '20260101' }, { value: '/' }], metricValues: [{ value: '5' }] }] })));

    const ids = await runSync({ accessToken: 'stale', refreshToken: 'ga4-login-refresh', expiresAt: '2000-01-01T00:00:00Z', email: 'a@b.c' });

    expect(ids).toEqual(['ga4:20260101|/']);

    const reportInit = fetchMock.mock.calls[1]![1] as { headers: Record<string, string> };

    expect(reportInit.headers.authorization).toBe('Bearer minted-ga4');
  });

  it('still syncs with a raw token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] })));

    await runSync({ token: 'raw-ga4' });

    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers.authorization).toBe('Bearer raw-ga4');
  });
});
