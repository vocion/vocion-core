import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/connect/sources', () => ({ findSourceBySlug: vi.fn() }));
vi.mock('@/libs/connect/state', () => ({ signState: vi.fn(() => 'signed.state') }));
const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));
// The workspace's own login app, when a test saves one; none by default.
vi.mock('@/libs/connect/loginClient', () => ({ loginClientForNewLogin: vi.fn(async () => null) }));

// Whose workspace this is, and whether the personal gate lets the login through.
vi.mock('@/services/personal/connections', () => ({ ownPersonalWorkspace: vi.fn(async () => null), personalConnectGate: vi.fn() }));
const personalApp = { value: true };
vi.mock('@/libs/connect/serverClients', () => ({
  PERSONAL_CLIENT_ENV: { slack: ['SLACK_PERSONAL_CLIENT_ID', 'SLACK_PERSONAL_CLIENT_SECRET'] },
  personalLoginClient: () => (personalApp.value ? { clientId: 'personal_slack', clientSecret: 's', owner: 'server' } : null),
}));

const configured = { value: true };
vi.mock('@/libs/connect/registry', () => {
  const slack = {
    id: 'slack',
    connectorSlugs: ['slack'],
    label: 'Slack',
    requiredEnv: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
    configured: () => configured.value,
    personal: { configured: () => personalApp.value },
    authorizeUrl: ({ state, redirectUri, client, audience }: { state: string; redirectUri: string; client?: { clientId: string }; audience?: string }) =>
      `https://slack.com/oauth/v2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}${client ? `&client_id=${client.clientId}` : ''}${audience ? `&audience=${audience}` : ''}`,
    exchange: vi.fn(),
  };
  return {
    providerFor: (id: string) => (id === 'slack' ? slack : null),
    providerForConnector: (slug: string) => (slug === 'slack' ? slack : null),
  };
});

const { clerkAuth } = await import('@/libs/Auth');
const { findSourceBySlug } = await import('@/libs/connect/sources');
const { signState } = await import('@/libs/connect/state');
const { loginClientForNewLogin } = await import('@/libs/connect/loginClient');
const { ownPersonalWorkspace, personalConnectGate } = await import('@/services/personal/connections');
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

function request(query = '?source=slack') {
  return new NextRequest(`https://agents.example${'/api/connect/slack/start'}${query}`, {
    headers: { 'host': 'agents.example', 'x-forwarded-proto': 'https' },
  });
}

function context(provider = 'slack') {
  return { params: Promise.resolve({ provider }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  configured.value = true;
  personalApp.value = true;
  env.AUTH_SECRET = 'secret';
  env.NEXT_PUBLIC_APP_URL = 'https://agents.example';
  vi.mocked(clerkAuth).mockResolvedValue(admin);
  vi.mocked(findSourceBySlug).mockResolvedValue({ id: 7, slug: 'slack', connectorSlug: 'slack' });
});

describe('GET /api/connect/[provider]/start', () => {
  it('refuses a signed-out request', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null, userId: null });

    const res = await GET(request(), context());

    expect(res.status).toBe(401);
  });

  it('refuses a member: connecting is an admin act, like pasting a key', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    const res = await GET(request(), context());

    expect(res.status).toBe(403);
  });

  it('answers 404 for a provider that does not exist', async () => {
    const res = await GET(request(), context('nope'));

    expect(res.status).toBe(404);
  });

  it('refuses a source the provider does not connect', async () => {
    vi.mocked(findSourceBySlug).mockResolvedValue({ id: 8, slug: 'kb-strapi', connectorSlug: 'strapi' });

    const res = await GET(request('?source=kb-strapi'), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'kb-strapi is not a Slack source' });
  });

  it('names the missing env vars, and the login app a workspace could save instead, when there is no app to log in with', async () => {
    configured.value = false;

    const res = await GET(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Connecting with Slack needs SLACK_CLIENT_ID, SLACK_CLIENT_SECRET on the server, or a Slack login app saved on the Developers page.',
    });
  });

  it('with no app on the server but one saved by the workspace, the login starts on the workspace\'s client', async () => {
    configured.value = false;
    vi.mocked(loginClientForNewLogin).mockResolvedValueOnce({ clientId: 'ws_slack', clientSecret: 'ws_secret', owner: 'workspace' });

    const res = await GET(request(), context());

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('client_id')).toBe('ws_slack');
    expect(loginClientForNewLogin).toHaveBeenCalledWith('org_1', 'slack');
    // The state names the app, so the callback trades the code on this one
    // even if an admin replaces the login app before the person comes back.
    expect(signState).toHaveBeenLastCalledWith(expect.objectContaining({ loginClientId: 'ws_slack' }));
  });

  it('a saved login app that cannot be read stops the login with the fix, rather than starting it on the server\'s app', async () => {
    vi.mocked(loginClientForNewLogin).mockRejectedValueOnce(new Error('vault'));

    const res = await GET(request(), context());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'The saved Slack login app could not be read. An admin needs to save it again on the Developers page.' });
    expect(signState).not.toHaveBeenCalled();
  });

  it('fails closed when the server cannot sign a state or name its own origin', async () => {
    env.AUTH_SECRET = undefined;
    env.NEXT_PUBLIC_APP_URL = undefined;

    const res = await GET(request(), context());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Connecting at a vendor needs AUTH_SECRET, NEXT_PUBLIC_APP_URL on the server.' });
    expect(signState).not.toHaveBeenCalled();
  });

  it('never builds the redirect_uri from the request host', async () => {
    env.NEXT_PUBLIC_APP_URL = 'https://configured.example';

    const res = await GET(
      new NextRequest('https://evil.example/api/connect/slack/start?source=slack', { headers: { 'host': 'evil.example', 'x-forwarded-host': 'evil.example' } }),
      context(),
    );

    expect(res.headers.get('location')).toContain(encodeURIComponent('https://configured.example/api/connect/slack/callback'));
  });

  it('signs a dashboard returnTo into the state and drops an off-site one', async () => {
    await GET(request('?source=slack&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7'), context());

    expect(signState).toHaveBeenLastCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', connectorSlug: 'slack', userId: 'user_1', returnTo: '/dashboard/chat?conversation=7' });

    await GET(request('?source=slack&returnTo=%2F%2Fevil.example'), context());

    expect(signState).toHaveBeenLastCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', connectorSlug: 'slack', userId: 'user_1' });
  });

  it('sends an admin to the vendor with a state bound to org, source and person', async () => {
    const res = await GET(request(), context());

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://slack.com/oauth/v2/authorize?state=signed.state&redirect_uri=https%3A%2F%2Fagents.example%2Fapi%2Fconnect%2Fslack%2Fcallback',
    );
    expect(signState).toHaveBeenCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', connectorSlug: 'slack', userId: 'user_1' });
  });

  it('starts from a connector alone: no source row is looked up, and the chat card rides in the state', async () => {
    const res = await GET(request('?connector=slack&conversation=7&card=card_1'), context());

    expect(res.status).toBe(302);
    expect(findSourceBySlug).not.toHaveBeenCalled();
    expect(signState).toHaveBeenCalledWith({ provider: 'slack', orgId: 'org_1', userId: 'user_1', connectorSlug: 'slack', conversationId: 7, cardId: 'card_1' });
  });

  it('refuses a connector this provider does not serve', async () => {
    const res = await GET(request('?connector=github'), context());

    expect(res.status).toBe(400);
    expect(signState).not.toHaveBeenCalled();
  });

  it('drops a conversation or card id that is not shaped like one, rather than signing it', async () => {
    await GET(request('?connector=slack&conversation=-3&card=card_1'), context());

    expect(signState).toHaveBeenLastCalledWith({ provider: 'slack', orgId: 'org_1', userId: 'user_1', connectorSlug: 'slack' });

    await GET(request('?connector=slack&conversation=7&card=a%20b%2F..'), context());

    expect(signState).toHaveBeenLastCalledWith({ provider: 'slack', orgId: 'org_1', userId: 'user_1', connectorSlug: 'slack' });
  });
});

describe('GET /api/connect/[provider]/start, in a person\'s own Personal workspace', () => {
  const member = { ...admin, role: 'member' as const };
  const own = { projectId: 'org_1', accountId: 'acct_1' };

  beforeEach(() => {
    vi.mocked(clerkAuth).mockResolvedValue(member);
    vi.mocked(ownPersonalWorkspace).mockResolvedValue(own);
    vi.mocked(personalConnectGate).mockResolvedValue({ ok: true, accountId: 'acct_1', connection: { connector: 'slack', provider: 'slack', label: 'Slack DMs', unlocks: '', tools: [] } });
  });

  it('lets a member connect their own account: no admin needed, on the personal app, asking for the personal access', async () => {
    const res = await GET(request('?connector=slack'), context());

    expect(res.status).toBe(302);

    const location = new URL(res.headers.get('location')!);

    expect(location.searchParams.get('client_id')).toBe('personal_slack');
    expect(location.searchParams.get('audience')).toBe('personal');
    expect(signState).toHaveBeenCalledWith({ provider: 'slack', orgId: 'org_1', userId: 'user_1', connectorSlug: 'slack', loginClientId: 'personal_slack' });
    // A personal login never looks up or makes a source, and never runs on a workspace login app.
    expect(findSourceBySlug).not.toHaveBeenCalled();
    expect(loginClientForNewLogin).not.toHaveBeenCalled();
  });

  it('refuses when the Org turned personal connections off, with the gate\'s sentence', async () => {
    vi.mocked(personalConnectGate).mockResolvedValue({ ok: false, status: 403, reason: 'personal_off', error: 'Your Org has turned off personal connections.' });

    const res = await GET(request('?connector=slack'), context());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Your Org has turned off personal connections.' });
    expect(signState).not.toHaveBeenCalled();
  });

  it('names the personal app\'s env vars when the server has none for this vendor', async () => {
    personalApp.value = false;

    const res = await GET(request('?connector=slack'), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Connecting your own Slack needs SLACK_PERSONAL_CLIENT_ID, SLACK_PERSONAL_CLIENT_SECRET on the server.' });
  });

  it('starts from a connection, never a source', async () => {
    const res = await GET(request('?source=slack'), context());

    expect(res.status).toBe(400);
    expect(signState).not.toHaveBeenCalled();
  });

  it('outside a Personal workspace a member is still refused', async () => {
    vi.mocked(ownPersonalWorkspace).mockResolvedValue(null);

    const res = await GET(request('?connector=slack'), context());

    expect(res.status).toBe(403);
  });
});
