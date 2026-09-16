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

  it('finds runs marked on the column, not just ones carrying the old envelope key', async () => {
    await makePendingAction(ORG, { status: 'done', approvedByAgent: true, proposal: { confidence: 0.99 } });

    const out = await listAutoExecuted(ORG);

    expect(out.total).toBe(1);
    expect(out.items[0]!.approvedByAgent).toBe(true);
  });

  it('still finds pre-migration runs, whose column is null but whose envelope says auto-approved', async () => {
    // Narrowing this list to the column alone would silently empty the audit
    // trail of everything decided before the column shipped.
    await makePendingAction(ORG, { status: 'done', approvedByAgent: null, proposal: { autoApproved: true } });

    expect((await listAutoExecuted(ORG)).total).toBe(1);
  });

  it('leaves out a run a person decided, even when the old envelope key is set on it', async () => {
    // The column is the system of record: an explicit `false` beats a stale
    // envelope, or a human decision would be reported as the agent's work.
    await makePendingAction(ORG, { status: 'done', approvedByAgent: false, proposal: { autoApproved: true } });

    expect((await listAutoExecuted(ORG)).total).toBe(0);
  });
});

describe('approvedByAgent on the queue reads', () => {
  it('is null on a pending item, so an undecided card never reads as human-approved', async () => {
    await makePendingAction();

    const page = await listPendingPage(ORG, { kind: 'action' });

    expect(page.items[0]!.approvedByAgent).toBeNull();
  });

  it('comes back on the detail view for a run an agent approved', async () => {
    const id = await makePendingAction(ORG, { status: 'done', approvedByAgent: true, decidedBy: 'agent:event-scout' });

    const detail = await getReviewDetail(ORG, 'action', id);

    expect(detail!.approvedByAgent).toBe(true);
    // The agent and the timestamp travel with it, so a reviewer can audit the
    // decision without a second lookup.
    expect((detail!.record as { decidedBy?: string }).decidedBy).toBe('agent:event-scout');
  });

  it('comes back false on the detail view for a run a person decided', async () => {
    const id = await makePendingAction(ORG, { status: 'done', approvedByAgent: false, decidedBy: 'user_123' });

    expect((await getReviewDetail(ORG, 'action', id))!.approvedByAgent).toBe(false);
  });

  it('is null on planes that have no auto-approval path at all', async () => {
    const workflowId = await makePausedWorkflow();

    expect((await getReviewDetail(ORG, 'workflow', workflowId))!.approvedByAgent).toBeNull();
  });
});

describe('the approvedByAgent queue filter', () => {
  it('separates the two failed lanes, which is the whole point of it', async () => {
    // A failed run stays in the queue with its decision intact, so these three
    // are all pending work and only the filter tells them apart.
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true });
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: false });
    await makePendingAction();

    const agentApproved = await listPendingPage(ORG, { kind: 'action', approvedByAgent: true });
    const personApproved = await listPendingPage(ORG, { kind: 'action', approvedByAgent: false });

    expect(agentApproved.items).toHaveLength(1);
    expect(agentApproved.items[0]!.approvedByAgent).toBe(true);
    expect(personApproved.items).toHaveLength(1);
    expect(personApproved.items[0]!.approvedByAgent).toBe(false);
  });

  it('counts only the matching rows, so a filtered queue can say how much work it holds', async () => {
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true });
    await makePendingAction();
    await makePendingAction();

    const page = await listPendingPage(ORG, { kind: 'action', approvedByAgent: true, limit: 50 });

    expect(page.total).toBe(1);
  });

  it('asking for the undecided rows is a filter, not the absence of one', async () => {
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true });
    await makePendingAction();

    const undecided = await listPendingPage(ORG, { kind: 'action', approvedByAgent: null });

    // `= NULL` matches nothing in SQL, so getting the pending row back is what
    // proves this compiles to IS NULL rather than silently dropping the filter
    // or returning everything.
    expect(undecided.items).toHaveLength(1);
    expect(undecided.items[0]!.approvedByAgent).toBeNull();
  });

  it('omitting it returns the whole queue, decided rows included', async () => {
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true });
    await makePendingAction();

    expect((await listPendingPage(ORG, { kind: 'action' })).items).toHaveLength(2);
  });

  it('drops the planes no agent can decide when asked for a decided row', async () => {
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true });
    await makePausedWorkflow();
    await makeMissionAwaitingReview();

    const decidedByAgent = await listPendingPage(ORG, { approvedByAgent: true });

    // A paused workflow could never have been released by the trust ladder, so
    // returning it under this filter would answer a different question.
    expect(decidedByAgent.items).toHaveLength(1);
    expect(decidedByAgent.items[0]!.kind).toBe('action');
    expect(decidedByAgent.total).toBe(1);
  });

  it('keeps those planes when asked for the undecided rows, because that is what they are', async () => {
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true });
    await makePausedWorkflow();
    await makeMissionAwaitingReview();

    const undecided = await listPendingPage(ORG, { approvedByAgent: null });

    expect(undecided.items.map(item => item.kind).sort()).toEqual(['mission', 'workflow']);
  });

  it('composes with the action-type filter rather than replacing it', async () => {
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true, actionId: 'crm.update' });
    await makePendingAction(ORG, { status: 'failed', approvedByAgent: true, actionId: 'hubspot.update' });

    const page = await listPendingPage(ORG, {
      kind: 'action',
      approvedByAgent: true,
      actionIds: ['hubspot.update'],
    });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });
});
