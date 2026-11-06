/**
 * "Connect with GitLab" through the real callback route: the code and the
 * PKCE verifier derived from the returned state go to GitLab's token
 * endpoint, and the grant that comes back is handed to `completeLogin`, the
 * one place a login is written to the vault. The route's own guards are
 * covered in `route.test.ts`; this pins the GitLab provider into it.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/DB');
vi.mock('@/libs/connect/sources', () => ({ findSourceBySlug: vi.fn() }));
vi.mock('@/libs/connect/state', () => ({
  verifyState: vi.fn(),
  stateIssuedAt: (state: { exp: number }) => new Date(state.exp - 600000),
  pkceVerifierFor: (state: string) => `verifier-of-${state}`,
}));
vi.mock('@/services/connect/completeLogin', () => ({ completeLogin: vi.fn(), recordFailedLogin: vi.fn(), approveLoginCard: vi.fn() }));
vi.mock('@/services/connect/createSourceOnLogin', () => ({ createSourceWhenNoConfigNeeded: vi.fn(async () => ({ created: false })), loginMakesItsSource: () => false }));
const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/connect/loginClient', () => ({ LOGIN_CLIENT_ID_KEY: 'loginClientId', loginClientForCallback: vi.fn(async () => null) }));
vi.mock('@/services/personal/connections', () => ({ ownPersonalWorkspace: vi.fn(async () => null), personalConnectGate: vi.fn() }));
vi.mock('@/libs/connect/registry', async () => {
  const { gitlabProvider } = await vi.importActual<typeof import('@/libs/connect/providers/gitlab')>('@/libs/connect/providers/gitlab');
  return {
    providerFor: (id: string) => (id === 'gitlab' ? gitlabProvider : null),
    providerForConnector: (slug: string) => (slug === 'gitlab' ? gitlabProvider : null),
  };
});

const { clerkAuth } = await import('@/libs/Auth');
const { findSourceBySlug } = await import('@/libs/connect/sources');
const { verifyState } = await import('@/libs/connect/state');
const { completeLogin } = await import('@/services/connect/completeLogin');
const { GET } = await import('./route');

const admin = { userId: 'user_1', orgId: 'org_1', accountId: null, projectId: 'org_1', role: 'admin' as const, workspaceRole: 'admin' as const, has: () => true };
const payload = { v: 1 as const, provider: 'gitlab', orgId: 'org_1', sourceSlug: 'gitlab-1727000000', userId: 'user_1', nonce: 'n', exp: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  env.NEXT_PUBLIC_APP_URL = 'https://agents.example';
  env.GITLAB_OAUTH_CLIENT_ID = 'gl_app';
  env.GITLAB_OAUTH_CLIENT_SECRET = 'gl_secret';
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  vi.mocked(verifyState).mockReturnValue({ ok: true, payload });
  vi.mocked(findSourceBySlug).mockResolvedValue({ id: 7, slug: 'gitlab-1727000000', connectorSlug: 'gitlab' });
  vi.mocked(completeLogin).mockResolvedValue({ ok: true, tokenId: 'tok_1', linkedSourceIds: [7] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/connect/gitlab/callback', () => {
  it('trades the code with the state\'s verifier and hands the grant to the vault write', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === 'https://gitlab.com/oauth/token') {
        bodies.push(String(init?.body));
        return new Response(JSON.stringify({ access_token: 'gl_at_1', refresh_token: 'gl_rt_1', expires_in: 7200, scope: 'api read_user' }), { status: 200 });
      }
      if (String(url) === 'https://gitlab.com/api/v4/user') {
        return new Response(JSON.stringify({ username: 'dana.northwind' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));

    const res = await GET(new NextRequest('https://agents.example/api/connect/gitlab/callback?code=c0de&state=signed.state', { headers: { 'host': 'agents.example', 'x-forwarded-proto': 'https' } }), { params: Promise.resolve({ provider: 'gitlab' }) });

    expect(res.status).toBe(303);
    expect(Object.fromEntries(new URLSearchParams(bodies[0]))).toMatchObject({ grant_type: 'authorization_code', code: 'c0de', code_verifier: 'verifier-of-signed.state', redirect_uri: 'https://agents.example/api/connect/gitlab/callback' });
    expect(completeLogin).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_1',
      connectorSlug: 'gitlab',
      sourceSlug: 'gitlab-1727000000',
      exchanged: {
        credentials: expect.objectContaining({ accessToken: 'gl_at_1', refreshToken: 'gl_rt_1', baseUrl: 'https://gitlab.com', account: 'dana.northwind', expiresAt: expect.any(String) }),
        displayName: 'GitLab — dana.northwind',
      },
    }));
  });
});
