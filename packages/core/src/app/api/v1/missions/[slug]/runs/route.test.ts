/**
 * `GET /api/v1/missions/:slug/runs` — tenant-token authenticated the same
 * way as every other `/api/v1` route (see `_shared.ts`). Cross-org access
 * 404s rather than 403ing, matching the rest of `/api/v1`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionSchema, missionRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_mission_runs_route';
const OTHER_ORG = 'org_mission_runs_route_other';

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function requestFor(slug: string, query = ''): Request {
  return new Request(`https://vocion.test/api/v1/missions/${slug}/runs${query}`, {
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

function paramsFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

async function makeMission(slug: string, orgId = ORG): Promise<number> {
  const [row] = await db
    .insert(missionSchema)
    .values({ orgId, slug, name: `Mission ${slug}`, goal: 'do the thing', agentSlug: 'event-ingestion-lead' })
    .returning({ id: missionSchema.id });
  return row!.id;
}

async function makeRun(missionId: number, orgId = ORG): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId,
      missionId,
      title: 'A run',
      brief: 'do it',
      status: 'completed',
      team: { lead: 'event-ingestion-lead', members: [] },
      plan: { tasks: [{ id: 't1', title: 'task', ownerAgentSlug: 'event-ingestion-lead', type: 'action', status: 'completed', output: 'found 3, refreshed 3, failed 0' }] as never },
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(missionRunSchema);
  await db.delete(missionSchema);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
  await db.delete(missionSchema);
});

describe('GET /api/v1/missions/:slug/runs', () => {
  it('rejects a request with no credential at all', async () => {
    mockBearer.mockResolvedValue(null);
    const req = new Request('https://vocion.test/api/v1/missions/anything/runs');

    const res = await GET(req, paramsFor('anything'));

    expect(res.status).toBe(401);
  });

  it('rejects an invalid bearer token', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await GET(requestFor('anything'), paramsFor('anything'));

    expect(res.status).toBe(401);
  });

  it('404s a mission that does not exist', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor('no-such-mission'), paramsFor('no-such-mission'));

    expect(res.status).toBe(404);
  });

  it('404s a mission that belongs to another org, never leaking that it exists', async () => {
    await makeMission('veerio-event-ingestion', OTHER_ORG);
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor('veerio-event-ingestion'), paramsFor('veerio-event-ingestion'));

    expect(res.status).toBe(404);
  });

  it('returns an empty list for a mission with no runs yet', async () => {
    await makeMission('fresh-mission');
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor('fresh-mission'), paramsFor('fresh-mission'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ runs: [] });
  });

  it('lists the runs for the named mission with plan.tasks[0].output populated', async () => {
    const missionId = await makeMission('veerio-event-ingestion');
    const runId = await makeRun(missionId);
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor('veerio-event-ingestion'), paramsFor('veerio-event-ingestion'));
    const body = await res.json() as { runs: Array<{ id: number; missionSlug: string; plan: { tasks: Array<{ output?: string }> } }> };

    expect(res.status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]!.id).toBe(runId);
    expect(body.runs[0]!.missionSlug).toBe('veerio-event-ingestion');
    expect(body.runs[0]!.plan.tasks[0]!.output).toBe('found 3, refreshed 3, failed 0');
  });

  it('accepts a dashboard session with no bearer token', async () => {
    const missionId = await makeMission('veerio-event-ingestion');
    await makeRun(missionId);
    mockBearer.mockResolvedValue(null);
    mockSession.mockResolvedValue({ userId: 'u1', orgId: ORG, accountId: 'a1', projectId: ORG, role: 'admin', has: () => true } as never);

    const res = await GET(new Request(`https://vocion.test/api/v1/missions/veerio-event-ingestion/runs`), paramsFor('veerio-event-ingestion'));

    expect(res.status).toBe(200);
  });
});
