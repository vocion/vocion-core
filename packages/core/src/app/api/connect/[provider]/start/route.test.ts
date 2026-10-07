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
  // A refusal is a link's answer: back to Sources in the same tab with the
  // reason in the URL (the callback's shape), never a JSON body — a person
  // tapped this from the Connectors page or a chip in chat.
  const landedWith = (res: Response, reason: string, source = 'slack') => {
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://agents.example/dashboard/sources?connect=error&reason=${reason}&source=${source}`);
  };

  it('sends a signed-out request back with the reason', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, orgId: null, userId: null });

    landedWith(await GET(request(), context()), 'signed_out');
  });

  it('sends a member back: connecting is an admin act, like pasting a key', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...admin, role: 'member' });

    landedWith(await GET(request(), context()), 'not_admin');

    expect(signState).not.toHaveBeenCalled();
  });

  it('sends back a link naming a provider that does not exist', async () => {
    landedWith(await GET(request(), context('nope')), 'unknown_provider');
  });

  it('sends back a source the provider does not connect', async () => {
    vi.mocked(findSourceBySlug).mockResolvedValue({ id: 8, slug: 'kb-strapi', connectorSlug: 'strapi' });

    landedWith(await GET(request('?source=kb-strapi'), context()), 'wrong_provider', 'kb-strapi');
  });

  it('sends back when the server has no login configured for the provider', async () => {
    configured.value = false;

    landedWith(await GET(request(), context()), 'not_configured');
  });

  it('fails closed when the server cannot sign a state or name its own origin', async () => {
    env.AUTH_SECRET = undefined;
    env.NEXT_PUBLIC_APP_URL = undefined;

    landedWith(await GET(request(), context()), 'server_unconfigured');

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

  it('sends an admin to the vendor with a state bound to org, source and person', async () => {
    const res = await GET(request(), context());

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://slack.com/oauth/v2/authorize?state=signed.state&redirect_uri=https%3A%2F%2Fagents.example%2Fapi%2Fconnect%2Fslack%2Fcallback',
    );
    expect(signState).toHaveBeenCalledWith({ provider: 'slack', orgId: 'org_1', sourceSlug: 'slack', userId: 'user_1' });
  });
});
