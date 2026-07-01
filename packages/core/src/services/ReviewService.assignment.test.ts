/**
 * Review-queue routing/assignment against PGlite — the multi-user team queue.
 * Verifies decorate + per-user filter + unassigned queue + snooze.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// ReviewService imports the dispatch services for `decide`; stub them so the
// module loads without dragging their internals into this assignment test.
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { missionRunSchema, reviewAssignmentSchema, userSchema } = await import('@/models/Schema');
const { assign, listPending, snooze } = await import('@/services/ReviewService');

const ORG = 'org_rev';

async function makeMission(): Promise<number> {
  const [r] = await db
    .insert(missionRunSchema)
    .values({ orgId: ORG, title: 'Daily briefing', brief: 'b', team: { lead: 'revenue-lead', members: [] }, status: 'awaiting_review' })
    .returning({ id: missionRunSchema.id });
  return r!.id;
}

beforeEach(async () => {
  await db.delete(reviewAssignmentSchema);
  await db.delete(missionRunSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values([
    { id: 'u_chris', email: 'chris@metacto.com', name: 'Chris' },
    { id: 'u_andrew', email: 'andrew@metacto.com', name: 'Andrew' },
  ]);
});

afterAll(async () => {
  await db.delete(reviewAssignmentSchema);
  await db.delete(missionRunSchema);
  await db.delete(userSchema);
});

describe('ReviewService routing', () => {
  it('decorates the queue and filters to a person', async () => {
    const id = await makeMission();
    await assign(ORG, { kind: 'mission', id }, { assignedTo: 'u_chris', assignedBy: 'u_chris' });

    const all = await listPending(ORG);

    expect(all).toHaveLength(1);
    expect(all[0]!.assignedTo).toBe('u_chris');

    expect(await listPending(ORG, { assignedTo: 'u_chris' })).toHaveLength(1);
    expect(await listPending(ORG, { assignedTo: 'u_andrew' })).toHaveLength(0);
    expect(await listPending(ORG, { assignedTo: null })).toHaveLength(0); // it's assigned
  });

  it('an unassigned item shows in the unassigned queue only', async () => {
    await makeMission();

    expect(await listPending(ORG, { assignedTo: null })).toHaveLength(1);
    expect(await listPending(ORG, { assignedTo: 'u_chris' })).toHaveLength(0);
  });

  it('reassigning routes to the new owner', async () => {
    const id = await makeMission();
    await assign(ORG, { kind: 'mission', id }, { assignedTo: 'u_chris' });
    await assign(ORG, { kind: 'mission', id }, { assignedTo: 'u_andrew' });

    expect(await listPending(ORG, { assignedTo: 'u_chris' })).toHaveLength(0);
    expect(await listPending(ORG, { assignedTo: 'u_andrew' })).toHaveLength(1);
  });

  it('snooze hides from the active queue until includeSnoozed', async () => {
    const id = await makeMission();
    await snooze(ORG, { kind: 'mission', id }, new Date(Date.now() + 3600_000), 'u_chris');

    expect(await listPending(ORG)).toHaveLength(0);
    expect(await listPending(ORG, { includeSnoozed: true })).toHaveLength(1);
  });
});
