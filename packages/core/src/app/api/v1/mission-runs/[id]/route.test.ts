/**
 * `GET /api/v1/mission-runs/:id` — same tenant-token auth as the rest of
 * `/api/v1`. Cross-org and missing ids both 404, never 403 or 500, so a
 * wrong-tenant token cannot distinguish "no such run" from "that run is
 * not yours."
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_mission_run_route';
const OTHER_ORG = 'org_mission_run_route_other';

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function requestFor(id: string): Request {
  return new Request(`https://vocion.test/api/v1/mission-runs/${id}`, {
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function makeRun(opts: { orgId?: string; error?: string | null } = {}): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId: opts.orgId ?? ORG,
      missionId: null,
      title: 'A run',
      brief: 'do it',
      status: 'completed',
      error: opts.error ?? null,
      createdBy: 'user_drew',
      team: { lead: 'event-ingestion-lead', members: [] },
      plan: { tasks: [{ id: 't1', title: 'task', ownerAgentSlug: 'event-ingestion-lead', type: 'action', status: 'failed', error: 'no matching skill', output: 'nothing to do' }] as never },
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(missionRunSchema);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('GET /api/v1/mission-runs/:id', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await GET(new Request('https://vocion.test/api/v1/mission-runs/1'), paramsFor('1'));

    expect(res.status).toBe(401);
  });

  it('rejects a non-numeric id before touching the database', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor('not-a-number'), paramsFor('not-a-number'));

    expect(res.status).toBe(400);
  });

  it('404s an id that does not exist', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor('999999'), paramsFor('999999'));

    expect(res.status).toBe(404);
  });

  it('404s a run belonging to another org', async () => {
    const runId = await makeRun({ orgId: OTHER_ORG });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor(String(runId)), paramsFor(String(runId)));

    expect(res.status).toBe(404);
  });

  it('returns the full task-level report, including a task error while the run itself shows no error', async () => {
    const runId = await makeRun();
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor(String(runId)), paramsFor(String(runId)));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: runId,
      missionSlug: null,
      status: 'completed',
      error: null,
      invokedBy: 'user_drew',
    });
    expect(body.plan.tasks[0]).toMatchObject({ status: 'failed', error: 'no matching skill', output: 'nothing to do' });
  });
});
