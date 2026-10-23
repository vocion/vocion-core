/**
 * `GET /api/v1/spend`, the spend ledger read one way: fenced to the token's
 * workspace, grouped as asked, money in micro-cents.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { modelCallSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_spend_route';
const OTHER = 'org_spend_route_other';

function tokenPrincipal(orgId: string, grants: string[] = ['*']) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants.includes('*') ? 'owner' as const : 'specialist' as const, scope: { orgId }, grants },
  };
}

function requestFor(query: string): Request {
  return new Request(`https://vocion.test/api/v1/spend?${query}`, { headers: { authorization: 'Bearer vcn_live_fake_token' } });
}

const row = (orgId: string, agentSlug: string, model: string, microCents: number) => ({ orgId, agentSlug, feature: 'agent.turn', model, inputTokens: 100, outputTokens: 10, microCents });

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(modelCallSchema);
  await db.insert(modelCallSchema).values([
    row(ORG, 'revenue-lead', 'claude-opus-5-5', 5_000_000),
    row(ORG, 'revenue-lead', 'claude-sonnet-5', 1_000_000),
    row(ORG, 'controller', 'claude-sonnet-5', 2_000_000),
    row(OTHER, 'revenue-lead', 'claude-opus-5-5', 900_000_000),
  ]);
});

describe('GET /api/v1/spend', () => {
  it('403s a token that does not hold manage_sources', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG, ['draft']) as never);

    expect((await GET(requestFor('group_by=agent'))).status).toBe(403);
  });

  it('refuses a grouping it does not know', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    expect((await GET(requestFor('group_by=planet'))).status).toBe(400);
  });

  it('groups this workspace\'s calls by agent, biggest first, and never reads another workspace', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(requestFor('group_by=agent&period=7d'))).json();

    expect(body.rows.map((r: { key: string }) => r.key)).toEqual(['revenue-lead', 'controller']);
    expect(body.rows[0]).toMatchObject({ calls: 2, tokens: 220, micro_cents: 6_000_000 });
    expect(body.total).toEqual({ calls: 3, tokens: 330, micro_cents: 8_000_000 });
  });

  it('narrows by a filter', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(requestFor('group_by=model&agent=controller'))).json();

    expect(body.rows).toEqual([expect.objectContaining({ key: 'claude-sonnet-5', calls: 1 })]);
  });
});
