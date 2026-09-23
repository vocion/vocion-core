/**
 * `GET /api/v1/budgets/agents`, every agent with the cap it is actually held to
 * (#272).
 *
 * The point of the route is the agents `GET /api/v1/budgets` cannot show: a
 * new agent has no budget row, runs on a default cap, and without this there
 * is nowhere outside the database to see that cap or why a turn was refused.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, agentSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_budgets_agents_route';

function tokenPrincipal(orgId: string, grants: string[] = ['*']) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants.includes('*') ? 'owner' as const : 'specialist' as const, scope: { orgId }, grants },
  };
}

function requestFor(query = ''): Request {
  return new Request(`https://vocion.test/api/v1/budgets/agents${query}`, {
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

async function seedAgent(orgId: string, slug: string): Promise<void> {
  await db.insert(agentSchema).values({ orgId, slug, name: `Agent ${slug}`, systemPrompt: 'x' } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(agentBudgetSchema);
  await db.delete(agentSchema);
});

afterAll(async () => {
  await db.delete(agentBudgetSchema);
  await db.delete(agentSchema);
});

describe('GET /api/v1/budgets/agents', () => {
  it('403s a token that does not hold manage_sources', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG, ['draft']) as never);

    expect((await GET(requestFor())).status).toBe(403);
  });

  it('refuses a period it does not know rather than quietly reading the daily one', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    expect((await GET(requestFor('?period=weekly'))).status).toBe(400);
  });

  it('shows an agent with no budget row, the default cap it runs on, and whose setting that is', async () => {
    await seedAgent(ORG, 'fresh-agent');
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor());
    const body = await res.json() as { agents: Array<Record<string, unknown>>; builtInAgentDailyCents: number };

    expect(res.status).toBe(200);
    expect(body.builtInAgentDailyCents).toBe(10_000);
    expect(body.agents).toEqual([expect.objectContaining({
      agentSlug: 'fresh-agent',
      hardCentsLimit: 10_000,
      hardCentsLimitFrom: 'built_in_agent_default',
      spentCents: 0,
      blocked: false,
    })]);
  });

  it('reports an agent over its cap as blocked, with the refusal its next turn would get', async () => {
    await seedAgent(ORG, 'spent-agent');
    await db.insert(agentBudgetSchema).values({ orgId: ORG, agentSlug: 'spent-agent', period: 'daily', currentMicroCents: 400 * 1_000_000, hardCentsLimit: 300 });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(requestFor())).json() as { agents: Array<Record<string, unknown>> };

    expect(body.agents[0]).toMatchObject({
      blocked: true,
      hardCentsLimitFrom: 'own',
      remainingCents: 0,
      breach: { reason: 'hard_cents_exceeded', limit: 300, current: 400, limitFrom: 'own' },
    });
  });

  it('never shows another org\'s agents', async () => {
    await seedAgent('some_other_org', 'their-agent');
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    expect((await (await GET(requestFor())).json() as { agents: unknown[] }).agents).toEqual([]);
  });
});
