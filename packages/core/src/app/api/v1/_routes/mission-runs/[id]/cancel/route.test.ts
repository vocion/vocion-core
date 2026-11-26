/**
 * `POST /api/v1/mission-runs/:id/cancel` — stop a runaway run over a tenant
 * token. A settled run is not re-labelled; another org's run is not found.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_cancel_route';

function identity(orgId = ORG) {
  return { orgId, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] } };
}

function post(id: string, body?: unknown): Request {
  return new Request(`https://vocion.test/api/v1/mission-runs/${id}/cancel`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeRun(status: string, orgId = ORG): Promise<number> {
  const [row] = await db.insert(missionRunSchema).values({
    orgId,
    title: 'wiki-debrief: Completed work becomes the wiki',
    brief: 'check',
    status,
    team: { lead: 'wiki-researcher', members: [] },
    plan: { tasks: [] },
    createdBy: 'event:mission_run.completed',
    causedBy: [{ automationSlug: 'wiki-debrief', automationRunId: 41 }],
  }).returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  mockBearer.mockResolvedValue(identity() as never);
  await db.delete(missionRunSchema);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('POST /api/v1/mission-runs/:id/cancel', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    expect((await POST(post('1'), params('1'))).status).toBe(401);
  });

  it('cancels a running run with the reason given', async () => {
    const id = await makeRun('running');

    const res = await POST(post(String(id), { reason: 'runaway debrief loop' }), params(String(id)));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: 'cancelled', error: 'runaway debrief loop' });
  });

  it('cancels with no body at all', async () => {
    const id = await makeRun('planning');

    const res = await POST(post(String(id)), params(String(id)));

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('cancelled');
  });

  it('does not re-label a settled run', async () => {
    const id = await makeRun('completed');

    const res = await POST(post(String(id), {}), params(String(id)));

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('MISSION_RUN_SETTLED');
  });

  it('404s a run that is not this org\'s, and a run that does not exist', async () => {
    const id = await makeRun('running', 'org_someone_else');

    expect((await POST(post(String(id), {}), params(String(id)))).status).toBe(404);
    expect((await POST(post('999999', {}), params('999999'))).status).toBe(404);
    expect((await POST(post('abc', {}), params('abc'))).status).toBe(400);
  });
});
