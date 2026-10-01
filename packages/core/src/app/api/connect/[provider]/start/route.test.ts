import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/connect/sources', () => ({ findSourceBySlug: vi.fn(), clearLinkedCredential: vi.fn() }));
vi.mock('@/libs/connect/state', () => ({ signState: vi.fn(() => 'signed.state') }));
const env: Record<string, string | undefined> = {};
vi.mock('@/libs/Env', () => ({ Env: env }));

const configured = { value: true };
vi.mock('@/libs/connect/registry', () => {
  const slack = {
    id: 'slack',
    connectorSlugs: ['slack'],
    label: 'Slack',
    requiredEnv: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
    configured: () => configured.value,
    authorizeUrl: ({ state, redirectUri }: { state: string; redirectUri: string }) =>
      `https://slack.com/oauth/v2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
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

  it('names the missing env vars when the server is not configured', async () => {
    configured.value = false;

    const res = await GET(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Connecting with Slack needs SLACK_CLIENT_ID, SLACK_CLIENT_SECRET on the server.',
    });
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

    expect(signState).toHaveBeenLastCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', userId: 'user_1', returnTo: '/dashboard/chat?conversation=7' });

    await GET(request('?source=slack&returnTo=%2F%2Fevil.example'), context());

    expect(signState).toHaveBeenLastCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', userId: 'user_1' });
  });

  it('sends an admin to the vendor with a state bound to org, source and person', async () => {
    const res = await GET(request(), context());

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://slack.com/oauth/v2/authorize?state=signed.state&redirect_uri=https%3A%2F%2Fagents.example%2Fapi%2Fconnect%2Fslack%2Fcallback',
    );
    expect(signState).toHaveBeenCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', userId: 'user_1' });
  });
});
