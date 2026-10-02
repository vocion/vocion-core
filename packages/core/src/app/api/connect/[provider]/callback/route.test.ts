import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/connect/sources', () => ({ findSourceBySlug: vi.fn() }));
vi.mock('@/libs/connect/state', () => ({ verifyState: vi.fn() }));
vi.mock('@/services/connect/completeLogin', () => ({ completeLogin: vi.fn(), recordFailedLogin: vi.fn() }));
vi.mock('@/services/connect/createSourceOnLogin', () => ({ createSourceWhenNoConfigNeeded: vi.fn() }));
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
const { findSourceBySlug } = await import('@/libs/connect/sources');
const { verifyState } = await import('@/libs/connect/state');
const { completeLogin, recordFailedLogin } = await import('@/services/connect/completeLogin');
const { createSourceWhenNoConfigNeeded } = await import('@/services/connect/createSourceOnLogin');
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

function landing(res: Response): { path: string; connect?: string; reason?: string; source?: string; connector?: string } {
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
  vi.mocked(completeLogin).mockResolvedValue({ ok: true, tokenId: 'tok_1', linkedSourceIds: [7] });
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
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('passes the vendor refusal on as a code and stores nothing', async () => {
    exchange.mockResolvedValue({ ok: false, reason: 'invalid_code' });

    const res = await GET(request(), context());

    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'error', reason: 'invalid_code', connector: 'slack', source: 'slack-1727000000' });
    expect(completeLogin).not.toHaveBeenCalled();
    expect(recordFailedLogin).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_1', userId: 'user_1', connectorSlug: 'slack', reason: 'invalid_code' }));
  });

  it('hands the provider every query param but the state, with this deployment\'s callback', async () => {
    await GET(request('?code=c0de&state=signed.state&extra=1'), context());

    expect(exchange).toHaveBeenCalledWith({
      query: { code: 'c0de', extra: '1' },
      redirectUri: 'https://agents.example/api/connect/slack/callback',
    });
  });

  it('logs in for the connector, not the source row\'s own slug, and says so on the landing URL', async () => {
    // A source made in the UI is `slack-<timestamp>`; the login belongs to the
    // connector (`slack`) and the source is only linked to it afterwards.
    const res = await GET(request(), context());

    expect(completeLogin).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_1',
      userId: 'user_1',
      connectorSlug: 'slack',
      sourceSlug: 'slack-1727000000',
      exchanged: { credentials: { token: 'xoxb-1', teamId: 'T1' }, displayName: 'Slack — Noco' },
    }));
    expect(res.status).toBe(303);
    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'ok', connector: 'slack', source: 'slack-1727000000' });
  });

  it('after a stored login, asks for the source the login itself can make, with the sources it linked', async () => {
    await GET(request(), context());

    expect(createSourceWhenNoConfigNeeded).toHaveBeenCalledWith({ orgId: 'org_1', userId: 'user_1', connector: 'slack', linkedSourceIds: [7] });
  });

  it('makes no source when the login was not stored', async () => {
    vi.mocked(completeLogin).mockResolvedValue({ ok: false, reason: 'token_step_failed:an API token' });

    await GET(request(), context());

    expect(createSourceWhenNoConfigNeeded).not.toHaveBeenCalled();
  });

  it('logs in from a connector alone, with no source row, and hands the chat card on', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: true, payload: { ...payload, sourceSlug: undefined, connectorSlug: 'slack', conversationId: 7, cardId: 'card_1' } });

    const res = await GET(request(), context());

    expect(findSourceBySlug).not.toHaveBeenCalled();
    expect(completeLogin).toHaveBeenCalledWith(expect.objectContaining({ connectorSlug: 'slack', sourceSlug: undefined, card: { conversationId: 7, cardId: 'card_1' } }));
    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'ok', connector: 'slack' });
  });

  it('records a refusal on the card too, but never before the state\'s own checks pass', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: true, payload: { ...payload, connectorSlug: 'slack', conversationId: 7, cardId: 'card_1' } });
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, userId: 'user_2' });

    await GET(request(), context());

    expect(recordFailedLogin).not.toHaveBeenCalled();

    vi.mocked(clerkAuth).mockResolvedValue(admin);
    exchange.mockResolvedValue({ ok: false, reason: 'access_denied' });
    await GET(request(), context());

    expect(recordFailedLogin).toHaveBeenCalledWith(expect.objectContaining({ reason: 'access_denied', card: { conversationId: 7, cardId: 'card_1' } }));
  });

  it('records a login the provider could not finish with the step\'s own reason', async () => {
    vi.mocked(completeLogin).mockResolvedValue({ ok: false, reason: 'token_step_failed:an API token' });

    const res = await GET(request(), context());

    expect(recordFailedLogin).toHaveBeenCalledWith(expect.objectContaining({ reason: 'token_step_failed:an API token' }));
    expect(landing(res)).toMatchObject({ connect: 'error', reason: 'token_step_failed_an_API_token' });
  });

  it('lands back in the conversation the connect started from, success or refusal', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: true, payload: { ...payload, returnTo: '/dashboard/chat?conversation=7' } });

    const ok = await GET(request(), context());

    expect(landing(ok)).toEqual({ path: '/dashboard/chat', conversation: '7', connect: 'ok', connector: 'slack', source: 'slack-1727000000' });

    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' as never });
    const refused = await GET(request(), context());

    expect(landing(refused)).toMatchObject({ path: '/dashboard/chat', connect: 'error', reason: 'not_admin' });
  });

  it('never redirects off-site, even if a state somehow carried a foreign returnTo', async () => {
    vi.mocked(verifyState).mockReturnValue({ ok: true, payload: { ...payload, returnTo: '//evil.example' } });

    const res = await GET(request(), context());

    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'ok', connector: 'slack', source: 'slack-1727000000' });
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
    expect(completeLogin).not.toHaveBeenCalled();
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
    vi.mocked(completeLogin).mockRejectedValue(new Error('vault down'));

    const res = await GET(request(), context());
    const location = res.headers.get('location')!;

    expect(location).not.toContain('c0de');
    expect(landing(res)).toEqual({ path: '/dashboard/sources', connect: 'error', reason: 'store_failed', connector: 'slack', source: 'slack-1727000000' });
  });
});
