/**
 * Test connection for a Zendesk OAuth client, through the real inspect route
 * and the real connector hook, with Zendesk faked at `fetch`. The route test
 * beside this one covers the route with a stand-in hook; this one proves the
 * Zendesk hook is what answers, and that a value it cannot use comes back as
 * a 400 the person can act on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeZendesk, tokenAnswer } from '@/libs/zendesk/fakeZendesk';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/sources/registry', () => ({ getConnector: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(),
  storedCredentialIdForSource: vi.fn(),
}));
vi.mock('@/services/SourceSyncService', () => ({ getSourceById: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { getConnector } = await import('@/libs/sources/registry');
const { zendeskConnector } = await import('@/libs/sources/zendesk');
const { POST } = await import('./route');

const admin = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  workspaceRole: 'admin' as const,
  has: () => true,
};

let clientCount = 0;

/**
 * A Test connection request with these credential values.
 * @param credentials - As the form sends them.
 */
function testConnection(credentials: Record<string, unknown>): Request {
  return new Request('http://test/rpc/connectors/zendesk/inspect', {
    method: 'POST',
    body: JSON.stringify({ config: {}, credentials }),
  });
}

/** Credential values with a client ID no other test has used. */
function typedCredentials(): Record<string, unknown> {
  clientCount += 1;
  return { subdomain: 'acme', clientId: `vocion-route-${clientCount}`, clientSecret: 'fixture-secret-0001' };
}

const context = { params: Promise.resolve({ slug: 'zendesk', locale: 'en' }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  vi.mocked(getConnector).mockReturnValue(zendeskConnector as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /rpc/connectors/zendesk/inspect', () => {
  it('answers with the Zendesk checklist', async () => {
    const fake = new FakeZendesk({
      '/oauth/tokens': [tokenAnswer('tok-1')],
      '/api/v2/users/me.json': [{ status: 200, body: { user: { id: 4242, role: 'admin' } } }],
    });
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => fake.send(url, init));

    const res = await POST(testConnection(typedCredentials()), context);

    expect(res.status).toBe(200);

    const { inspection } = await res.json();

    expect(inspection).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(inspection.checks.map((check: { key: string }) => check.key)).toEqual(['token', 'acts-as']);
    expect(fake.calls.every(call => call.url.startsWith('https://acme.zendesk.com/'))).toBe(true);
  });

  it('answers 400 with a sentence for a subdomain that is not a zendesk.com account, and calls nothing', async () => {
    const fake = new FakeZendesk({});
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => fake.send(url, init));

    const res = await POST(testConnection({ ...typedCredentials(), subdomain: 'evil.com' }), context);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: expect.stringMatching(/before \.zendesk\.com/) });
    expect(fake.calls).toEqual([]);
  });

  it('answers 200 with the failure, not a 5xx, when Zendesk refuses the client', async () => {
    const fake = new FakeZendesk({ '/oauth/tokens': [{ status: 401, body: { error: 'invalid_client' } }] });
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => fake.send(url, init));

    const res = await POST(testConnection(typedCredentials()), context);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ inspection: { authorized: false, error: expect.stringMatching(/refused the OAuth client/) } });
  });
});
