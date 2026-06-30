/**
 * Unified review queue against PGlite. The dispatch services are mocked (we
 * only test the aggregation/normalization here); the per-kind approve/reject
 * logic is covered by their own services.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ resumeMission: vi.fn(), cancelMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ resumeWorkflow: vi.fn(), cancelWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { listPending, pendingCount } = await import('@/services/ReviewService');

const ORG = 'org_review_test';
const mission = (title: string, status: string, orgId = ORG) => ({
  orgId,
  title,
  brief: 'b',
  team: { lead: 'lead', members: [] as string[] },
  status,
});

beforeEach(async () => {
  await db.delete(missionRunSchema);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('ReviewService.listPending', () => {
  it('surfaces awaiting_review missions in one queue, excludes running', async () => {
    await db.insert(missionRunSchema).values(mission('Weekly report', 'awaiting_review'));
    await db.insert(missionRunSchema).values(mission('Still running', 'running'));

    const items = await listPending(ORG);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'mission', title: 'Weekly report', status: 'awaiting_review' });
    expect(await pendingCount(ORG)).toBe(1);
  });

  it('is org-scoped', async () => {
    await db.insert(missionRunSchema).values(mission('Other org', 'awaiting_review', 'org_other'));

    expect(await listPending(ORG)).toHaveLength(0);
  });
});
