/**
 * A mission run parked on its questions is waiting by design, not stranded:
 * the reaper leaves it for its resume gate, however long the answer takes,
 * and still reaps a run that is merely paused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/durable/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/libs/durable/jobs')>('@/libs/durable/jobs');
  return { ...actual, startJob: vi.fn() };
});

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { reapStaleMissionRuns } = await import('@/services/MissionService');

const ORG = 'org_reap_parked';

beforeEach(async () => {
  await db.delete(missionRunSchema);
});

describe('reapStaleMissionRuns — parked runs', () => {
  it('leaves a run parked on its questions alone, days later', async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const [parked] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Parked', brief: 'b', status: 'paused', pauseReason: 'waiting_on_asks:4', team: { lead: 'x', members: [] }, updatedAt: weekAgo }).returning();
    const [stale] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Stale', brief: 'b', status: 'paused', pauseReason: null, team: { lead: 'x', members: [] }, updatedAt: weekAgo }).returning();

    const out = await reapStaleMissionRuns();

    expect(out.ids).toEqual([stale!.id]);
    expect(out.ids).not.toContain(parked!.id);
  });
});
