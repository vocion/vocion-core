/**
 * The read side of the review queue against PGlite: paging, the kind filter,
 * the single-item detail view, and the auto-executed audit list. These are what
 * an external client renders its own review screen from, so tenant scoping and
 * a truthful total both matter here.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, missionRunSchema, reviewAssignmentSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { getReviewDetail, listAutoExecuted, listPending, listPendingPage } = await import('@/services/ReviewService');

const ORG = 'org_reads';
const OTHER_ORG = 'org_not_yours';

async function makePendingAction(orgId = ORG, overrides: Record<string, unknown> = {}): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({
      orgId,
      actionId: 'crm.update',
      input: { field: 'value' },
      status: 'pending',
      proposal: { confidence: 0.9, rationale: 'the deal closed', evidence: ['thread/1'] },
      ...overrides,
    })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

async function makePausedWorkflow(orgId = ORG): Promise<number> {
  const [workflow] = await db
    .insert(workflowSchema)
    .values({ orgId, slug: 'weekly-digest', name: 'Weekly digest', trigger: { type: 'manual' }, steps: [] })
    .returning({ id: workflowSchema.id });
  const [row] = await db
    .insert(workflowRunSchema)
    .values({ orgId, workflowId: workflow!.id, input: { week: 12 }, status: 'paused' })
    .returning({ id: workflowRunSchema.id });
  return row!.id;
}

async function makeMissionAwaitingReview(orgId = ORG): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId,
      title: 'Daily briefing',
      brief: 'b',
      team: { lead: 'revenue-lead', members: [] },
      status: 'awaiting_review',
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(workflowRunSchema);
  await db.delete(workflowSchema);
  await db.delete(missionRunSchema);
});

afterAll(async () => {
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(workflowRunSchema);
  await db.delete(workflowSchema);
  await db.delete(missionRunSchema);
});

describe('listPending — kind filter', () => {
  it('narrows to one plane', async () => {
    await makePendingAction();
    await makePausedWorkflow();
    await makeMissionAwaitingReview();

    expect(await listPending(ORG)).toHaveLength(3);
    expect(await listPending(ORG, { kind: 'action' })).toHaveLength(1);
    expect((await listPending(ORG, { kind: 'workflow' }))[0]!.kind).toBe('workflow');
    expect(await listPending(ORG, { kind: 'mission' })).toHaveLength(1);
  });

  it('drops an action whose suggestion has gone stale', async () => {
    await makePendingAction(ORG, { expiresAt: new Date(Date.now() - 60_000) });
    await makePendingAction(ORG, { expiresAt: new Date(Date.now() + 60_000) });

    expect(await listPending(ORG, { kind: 'action' })).toHaveLength(1);
  });
});

describe('listPendingPage', () => {
  it('returns a window and the real total', async () => {
    await makePendingAction();
    await makePendingAction();
    await makePendingAction();

    const page = await listPendingPage(ORG, { limit: 2, offset: 0 });

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);

    const second = await listPendingPage(ORG, { limit: 2, offset: 2 });

    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
  });

  it('does not repeat a row across pages', async () => {
    await makePendingAction();
    await makePendingAction();
    await makePendingAction();

    const first = await listPendingPage(ORG, { limit: 2, offset: 0 });
    const second = await listPendingPage(ORG, { limit: 2, offset: 2 });
    const seen = [...first.items, ...second.items].map(i => `${i.kind}:${i.id}`);

    expect(new Set(seen).size).toBe(3);
  });

  it('counts only what the filters matched', async () => {
    await makePendingAction();
    await makePausedWorkflow();

    expect((await listPendingPage(ORG, { kind: 'action' })).total).toBe(1);
  });

  it('sees nothing belonging to another org', async () => {
    await makePendingAction(OTHER_ORG);

    expect((await listPendingPage(ORG)).total).toBe(0);
  });
});

describe('getReviewDetail', () => {
  it('returns the proposal envelope for an action', async () => {
    const id = await makePendingAction();

    const detail = await getReviewDetail(ORG, 'action', id);

    expect(detail).not.toBeNull();
    expect(detail!.input).toEqual({ field: 'value' });
    expect(detail!.proposal).toMatchObject({ confidence: 0.9, rationale: 'the deal closed' });
    expect(detail!.record).toMatchObject({ actionId: 'crm.update' });
  });

  it('returns the run input for a workflow', async () => {
    const id = await makePausedWorkflow();

    const detail = await getReviewDetail(ORG, 'workflow', id);

    expect(detail!.status).toBe('paused');
    expect(detail!.input).toEqual({ week: 12 });
  });

  it('returns the title for a mission', async () => {
    const id = await makeMissionAwaitingReview();

    expect((await getReviewDetail(ORG, 'mission', id))!.title).toBe('Daily briefing');
  });

  it('carries the routing an item already has', async () => {
    const id = await makePendingAction();
    await db.insert(reviewAssignmentSchema).values({
      orgId: ORG,
      kind: 'action',
      runId: id,
      assignedTo: null,
      note: 'chase this one',
      status: 'open',
    });

    expect((await getReviewDetail(ORG, 'action', id))!.note).toBe('chase this one');
  });

  it('is null for an item another org owns', async () => {
    const id = await makePendingAction(OTHER_ORG);

    expect(await getReviewDetail(ORG, 'action', id)).toBeNull();
  });

  it('is null for an id that does not exist', async () => {
    expect(await getReviewDetail(ORG, 'action', 999_999)).toBeNull();
  });
});

describe('listAutoExecuted', () => {
  it('returns only proposals the gate approved on its own', async () => {
    await makePendingAction(ORG, { status: 'done', proposal: { confidence: 0.99, autoApproved: true } });
    await makePendingAction(ORG, { proposal: { confidence: 0.4, autoApproved: false } });
    await makePendingAction();

    const out = await listAutoExecuted(ORG);

    expect(out.total).toBe(1);
    expect(out.items[0]!.proposal).toMatchObject({ autoApproved: true });
  });

  it('is scoped to the org', async () => {
    await makePendingAction(OTHER_ORG, { status: 'done', proposal: { autoApproved: true } });

    expect((await listAutoExecuted(ORG)).total).toBe(0);
  });

  it('pages', async () => {
    await makePendingAction(ORG, { status: 'done', proposal: { autoApproved: true } });
    await makePendingAction(ORG, { status: 'done', proposal: { autoApproved: true } });

    const page = await listAutoExecuted(ORG, { limit: 1, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});
