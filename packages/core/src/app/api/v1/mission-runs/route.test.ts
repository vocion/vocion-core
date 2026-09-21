/**
 * `GET /api/v1/mission-runs` — the operator's run list: status and mission
 * filters, a clamped limit, and the total the filters matched.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionRunSchema, missionSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const ORG = 'org_mission_runs_list';

function get(query = ''): Request {
  return new Request(`https://vocion.test/api/v1/mission-runs${query}`, { headers: { authorization: 'Bearer vcn_live_fake' } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: ORG, tokenId: 't1', principal: { kind: 'user', id: 'token:t1', role: 'owner', scope: { orgId: ORG }, grants: ['*'] } } as never);
  await db.delete(missionRunSchema);
  await db.delete(missionSchema);
  const [mission] = await db.insert(missionSchema).values({ orgId: ORG, slug: 'wiki-debrief', name: 'wiki-debrief', goal: 'g', agentSlug: 'wiki-researcher' }).returning({ id: missionSchema.id });
  const runs = [
    ...Array.from({ length: 7 }, (_, i) => ({ status: 'running', missionId: mission!.id, title: `wiki-debrief ${i}` })),
    { status: 'completed', missionId: mission!.id, title: 'done' },
    { status: 'running', missionId: null, title: 'ad hoc' },
  ];
  for (const r of runs) {
    await db.insert(missionRunSchema).values({ orgId: ORG, brief: 'b', team: { lead: 'x', members: [] }, plan: { tasks: [] }, ...r });
  }
  await db.insert(missionRunSchema).values({ orgId: 'org_other', brief: 'b', team: { lead: 'x', members: [] }, plan: { tasks: [] }, status: 'running', title: 'not ours' });
});

afterAll(async () => {
  await db.delete(missionRunSchema);
  await db.delete(missionSchema);
});

describe('GET /api/v1/mission-runs', () => {
  it('rejects an unauthenticated request', async () => {
    vi.mocked(authenticateBearer).mockResolvedValue(null);

    expect((await GET(get())).status).toBe(401);
  });

  it('lists this org\'s runs newest first with the total', async () => {
    const body = await (await GET(get())).json();

    expect(body.total).toBe(9);
    expect(body.runs).toHaveLength(9);
    expect(body.runs.every((r: { title: string }) => r.title !== 'not ours')).toBe(true);
  });

  it('filters by status and by the mission\'s slug, and clamps the limit', async () => {
    const running = await (await GET(get('?status=running&limit=3'))).json();

    expect(running.total).toBe(8);
    expect(running.runs).toHaveLength(3);
    expect(running.runs.every((r: { status: string }) => r.status === 'running')).toBe(true);

    const ofMission = await (await GET(get('?status=running&missionSlug=wiki-debrief&limit=500'))).json();

    expect(ofMission.total).toBe(7);
    expect(ofMission.runs).toHaveLength(7);
    expect(ofMission.runs.every((r: { missionSlug: string }) => r.missionSlug === 'wiki-debrief')).toBe(true);

    expect((await GET(get('?limit=0'))).status).toBe(400);
  });
});
