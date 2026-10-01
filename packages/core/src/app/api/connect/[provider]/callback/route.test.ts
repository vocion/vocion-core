import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/connect/sources', () => ({ findSourceBySlug: vi.fn(), clearLinkedCredential: vi.fn() }));
vi.mock('@/libs/connect/state', () => ({ verifyState: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({ storeCredentialForSource: vi.fn() }));
const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const exchange = vi.fn();
vi.mock('@/libs/connect/registry', () => {
  const slack = {
    id: 'slack',
    connectorSlugs: ['slack'],
    label: 'Slack',
    requiredEnv: [],
    configured: () => true,
    authorizeUrl: () => 'https://slack.example',
    exchange: (input: unknown) => exchange(input),
  };
  return {
    providerFor: (id: string) => (id === 'slack' ? slack : null),
    providerForConnector: (slug: string) => (slug === 'slack' ? slack : null),
  };
});

const { clerkAuth } = await import('@/libs/Auth');
const { clearLinkedCredential, findSourceBySlug } = await import('@/libs/connect/sources');
const { verifyState } = await import('@/libs/connect/state');
const { storeCredentialForSource } = await import('@/services/SourceCredentialService');
const { GET } = await import('./route');

const admin = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  workspaceRole: 'admin' as const,
  has: () => true,
};

const payload = { v: 1 as const, provider: 'slack', orgId: 'org_1', sourceSlug: 'slack-1727000000', userId: 'user_1', nonce: 'n', exp: 1 };

function request(query = '?code=c0de&state=signed.state') {
  return new NextRequest(`https://agents.example/api/connect/slack/callback${query}`, {
    headers: { 'host': 'agents.example', 'x-forwarded-proto': 'https' },
  });
}

function context(provider = 'slack') {
  return { params: Promise.resolve({ provider }) };
}

function landing(res: Response): { path: string; connect?: string; reason?: string; source?: string } {
  const url = new URL(res.headers.get('location')!);
  return { path: url.pathname, ...Object.fromEntries(url.searchParams) };
}

beforeEach(() => {
  vi.clearAllMocks();
  env.NEXT_PUBLIC_APP_URL = 'https://agents.example';
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  vi.mocked(verifyState).mockReturnValue({ ok: true, payload });
  vi.mocked(findSourceBySlug).mockResolvedValue({ id: 7, slug: 'slack-1727000000', connectorSlug: 'slack' });
  exchange.mockResolvedValue({ ok: true, credentials: { token: 'xoxb-1', teamId: 'T1' }, displayName: 'Slack — Noco' });
  vi.mocked(storeCredentialForSource).mockResolvedValue({ installId: 1, credentialId: 2 });
});

describe('GET /api/connect/[provider]/callback', () => {
  it('lands on the sources page with a short code when the state cannot be trusted', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: false, reason: 'bad_signature' });

    const res = await GET(request(), context());

    expect(res.status).toBe(303);
    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'error', reason: 'state_bad_signature' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('refuses a state minted in another workspace than the one signed in', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: 'org_2', projectId: 'org_2' });

    const res = await GET(request(), context());

    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'error', reason: 'wrong_workspace', source: 'slack-1727000000' });
    expect(exchange).not.toHaveBeenCalled();
    expect(storeCredentialForSource).not.toHaveBeenCalled();
  });

  it('passes the vendor refusal on as a code and stores nothing', async () => {
    exchange.mockResolvedValue({ ok: false, reason: 'invalid_code' });

    const res = await GET(request(), context());

    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'error', reason: 'invalid_code', source: 'slack-1727000000' });
    expect(storeCredentialForSource).not.toHaveBeenCalled();
  });

  it('hands the provider every query param but the state, with this deployment\'s callback', async () => {
    await GET(request('?code=c0de&state=signed.state&extra=1'), context());

    expect(exchange).toHaveBeenCalledWith({
      query: { code: 'c0de', extra: '1' },
      redirectUri: 'https://agents.example/api/connect/slack/callback',
    });
  });

  it('stores the bag under the CONNECTOR, where sync reads it, not the source row\'s own slug', async () => {
    // A source made in the UI is `slack-<timestamp>`; sync resolves the
    // install by config._connector (`slack`). Storing under the row's slug
    // would put the grant where nothing reads it.
    const res = await GET(request(), context());

    expect(storeCredentialForSource).toHaveBeenCalledWith({
      orgId: 'org_1',
      sourceSlug: 'slack',
      raw: { token: 'xoxb-1', teamId: 'T1' },
      displayName: 'Slack — Noco (slack-1727000000)',
      userId: 'user_1',
    });
    expect(clearLinkedCredential).toHaveBeenCalledWith('org_1', 7);
    expect(res.status).toBe(303);
    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'ok', source: 'slack-1727000000' });
  });

  it('lands back in the conversation the connect started from, success or refusal', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: true, payload: { ...payload, returnTo: '/dashboard/chat?conversation=7' } });

    const ok = await GET(request(), context());

    expect(landing(ok)).toEqual({ path: '/dashboard/chat', conversation: '7', connect: 'ok', source: 'slack-1727000000' });

    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' as never });
    const refused = await GET(request(), context());

    expect(landing(refused)).toMatchObject({ path: '/dashboard/chat', connect: 'error', reason: 'not_admin' });
  });

  it('never redirects off-site, even if a state somehow carried a foreign returnTo', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: true, payload: { ...payload, returnTo: '//evil.example' } });

    const res = await GET(request(), context());

    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'ok', source: 'slack-1727000000' });
  });

  it('refuses a signed-out person with its own code, so the message can say to sign in', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null, userId: null, role: null });

    const res = await GET(request(), context());

    expect(landing(res).reason).toBe('signed_out');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('refuses a state started by another person, even in the same workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, userId: 'user_2' });

    const res = await GET(request(), context());

    expect(landing(res).reason).toBe('wrong_person');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('refuses a member who somehow holds an admin\'s state', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await GET(request(), context());

    expect(landing(res).reason).toBe('not_admin');
    expect(storeCredentialForSource).not.toHaveBeenCalled();
  });

  it('lands with a code instead of a 500 when AUTH_SECRET is unset and verify throws', async () => {
    vi.mocked(verifyState).mockImplementation(() => {
      throw new Error('AUTH_SECRET is required to sign a connect state');
    });

    const res = await GET(request(), context());

    expect(res.status).toBe(303);
    expect(landing(res).reason).toBe('server_unconfigured');
  });

  it('never puts the vendor code in the landing URL, even when storing fails', async () => {
    vi.mocked(storeCredentialForSource).mockRejectedValue(new Error('vault down'));

    const res = await GET(request(), context());
    const location = res.headers.get('location')!;

    expect(location).not.toContain('c0de');
    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'error', reason: 'store_failed', source: 'slack-1727000000' });
  });
});
