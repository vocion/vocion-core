/**
 * `GET /api/v1/budgets`, the agent budget rows, limits included.
 *
 * The limits are the point: the dashboard renders cents totals only, so
 * "would this agent's next run be refused?" could not be answered from outside
 * the database at all. Reading also rolls a period boundary that has passed,
 * which is why a stale row comes back zeroed rather than over its cap.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_budgets_route';
const AGENT = 'event-ingestion-lead';

function tokenPrincipal(orgId: string, grants: string[] = ['*']) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants.includes('*') ? 'owner' as const : 'specialist' as const, scope: { orgId }, grants },
  };
}

function requestFor(): Request {
  return new Request('https://vocion.test/api/v1/budgets', {
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(agentBudgetSchema);
});

afterAll(async () => {
  await db.delete(agentBudgetSchema);
});

describe('GET /api/v1/budgets', () => {
  it('rejects a request with no credential at all', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await GET(new Request('https://vocion.test/api/v1/budgets'));

    expect(res.status).toBe(401);
  });

  it('403s a token that does not hold manage_sources', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG, ['draft']) as never);

    const res = await GET(requestFor());

    expect(res.status).toBe(403);
  });

  it('returns an empty list for an org with no budget rows', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ budgets: [] });
  });

  it('exposes the limit columns beside the current usage', async () => {
    await db.insert(agentBudgetSchema).values({
      orgId: ORG,
      agentSlug: AGENT,
      period: 'daily',
      currentTokens: 42_000,
      currentCents: 37,
      softTokenLimit: 150_000,
      softCentsLimit: 150,
      hardTokenLimit: 400_000,
      hardCentsLimit: 300,
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(requestFor())).json() as { budgets: Array<Record<string, unknown>> };

    expect(body.budgets).toHaveLength(1);
    expect(body.budgets[0]).toMatchObject({
      agentSlug: AGENT,
      period: 'daily',
      currentTokens: 42_000,
      currentCents: 37,
      softTokenLimit: 150_000,
      softCentsLimit: 150,
      hardTokenLimit: 400_000,
      hardCentsLimit: 300,
    });
    expect(typeof body.budgets[0]!.periodStartedAt).toBe('string');
  });

  it('rolls a period that has already passed, so the counters are the active period\'s', async () => {
    await db.insert(agentBudgetSchema).values({
      orgId: ORG,
      agentSlug: AGENT,
      period: 'daily',
      currentTokens: 999_999,
      currentCents: 500,
      hardTokenLimit: 400_000,
      periodStartedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(requestFor())).json() as { budgets: Array<Record<string, unknown>> };

    expect(body.budgets[0]).toMatchObject({ currentTokens: 0, currentCents: 0, hardTokenLimit: 400_000 });
  });

  it('never shows another org\'s budgets', async () => {
    await db.insert(agentBudgetSchema).values({ orgId: 'some_other_org', agentSlug: AGENT, period: 'daily' });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    expect(await (await GET(requestFor())).json()).toEqual({ budgets: [] });
  });
});
