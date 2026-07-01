/**
 * ReviewService — ONE review queue across the planes.
 *
 * Gated work shows up in three places today (skill runs, paused workflow runs,
 * missions awaiting review) and the MCP autonomy gate vs the UI review queue
 * didn't share a view. This unifies them: `listPending` returns a single
 * normalized queue, and `decide` dispatches approve/reject to the right
 * underlying service — so a gated mutation is reviewed the same way regardless
 * of which plane produced it (firsthq/docs/platform-plan.md §4).
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, missionRunSchema, reviewAssignmentSchema, skillRunSchema, workflowRunSchema } from '@/models/Schema';
import { executeAction, rejectAction } from '@/services/ActionService';
import { cancelMission, resumeMission } from '@/services/MissionService';
import { approveSkillRun, rejectSkillRun } from '@/services/SkillService';
import { cancelWorkflow, resumeWorkflow } from '@/services/WorkflowService';

export type ReviewKind = 'skill' | 'workflow' | 'mission' | 'action';

export type ReviewItem = {
  kind: ReviewKind;
  id: number;
  orgId: string;
  title: string;
  status: string;
  /** Org user this item is routed to (null = unassigned). */
  assignedTo?: string | null;
  /** When snoozed, hidden from the active queue until this time. */
  snoozedUntil?: Date | null;
  note?: string | null;
};

export type ListOptions = {
  /** Filter to items routed to this user id; pass `null` for the unassigned queue. Omit for all. */
  assignedTo?: string | null;
  /** Include snoozed items (default: hide items snoozed into the future). */
  includeSnoozed?: boolean;
};

/** The status that means "needs human review" for each kind. */
const PENDING_STATUS: Record<ReviewKind, string> = {
  skill: 'pending',
  workflow: 'paused',
  mission: 'awaiting_review',
  action: 'pending',
};

/**
 * The single pending-review queue for an org, newest-first within each kind.
 * Decorated with routing: each item carries its assignee + snooze. Pass
 * `opts.assignedTo` for a per-person queue (a user id, or `null` for the
 * unassigned/triage queue); snoozed items are hidden unless `includeSnoozed`.
 * @param orgId
 * @param opts
 */
export async function listPending(orgId: string, opts: ListOptions = {}): Promise<ReviewItem[]> {
  const [skills, workflows, missions, actions] = await Promise.all([
    db
      .select({ id: skillRunSchema.id, status: skillRunSchema.status })
      .from(skillRunSchema)
      .where(and(eq(skillRunSchema.orgId, orgId), eq(skillRunSchema.status, PENDING_STATUS.skill)))
      .orderBy(desc(skillRunSchema.id)),
    db
      .select({ id: workflowRunSchema.id, status: workflowRunSchema.status })
      .from(workflowRunSchema)
      .where(and(eq(workflowRunSchema.orgId, orgId), eq(workflowRunSchema.status, PENDING_STATUS.workflow)))
      .orderBy(desc(workflowRunSchema.id)),
    db
      .select({ id: missionRunSchema.id, title: missionRunSchema.title, status: missionRunSchema.status })
      .from(missionRunSchema)
      .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.status, PENDING_STATUS.mission)))
      .orderBy(desc(missionRunSchema.id)),
    db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, status: actionRunSchema.status })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, PENDING_STATUS.action)))
      .orderBy(desc(actionRunSchema.id)),
  ]);

  const base: ReviewItem[] = [
    ...skills.map(r => ({ kind: 'skill' as const, id: r.id, orgId, title: `Skill run #${r.id}`, status: r.status ?? 'pending' })),
    ...workflows.map(r => ({ kind: 'workflow' as const, id: r.id, orgId, title: `Workflow run #${r.id}`, status: r.status })),
    ...missions.map(r => ({ kind: 'mission' as const, id: r.id, orgId, title: r.title, status: r.status })),
    ...actions.map(r => ({ kind: 'action' as const, id: r.id, orgId, title: `Action · ${r.actionId}`, status: r.status })),
  ];

  // Decorate with routing. One fetch of the org's assignments, keyed by kind:id.
  const assignments = await db
    .select()
    .from(reviewAssignmentSchema)
    .where(eq(reviewAssignmentSchema.orgId, orgId));
  const byKey = new Map(assignments.map(a => [`${a.kind}:${a.runId}`, a]));

  const now = new Date();
  let items = base.map((item) => {
    const a = byKey.get(`${item.kind}:${item.id}`);
    return { ...item, assignedTo: a?.assignedTo ?? null, snoozedUntil: a?.snoozedUntil ?? null, note: a?.note ?? null };
  });

  if (!opts.includeSnoozed) {
    items = items.filter(i => !i.snoozedUntil || i.snoozedUntil <= now);
  }
  if (opts.assignedTo !== undefined) {
    items = items.filter(i => i.assignedTo === opts.assignedTo);
  }
  return items;
}

export async function pendingCount(orgId: string, opts: ListOptions = {}): Promise<number> {
  return (await listPending(orgId, opts)).length;
}

async function upsertAssignment(
  orgId: string,
  item: { kind: ReviewKind; id: number },
  patch: { assignedTo?: string | null; assignedBy?: string | null; note?: string | null; status?: string; snoozedUntil?: Date | null },
): Promise<void> {
  const [existing] = await db
    .select({ id: reviewAssignmentSchema.id })
    .from(reviewAssignmentSchema)
    .where(and(eq(reviewAssignmentSchema.kind, item.kind), eq(reviewAssignmentSchema.runId, item.id)))
    .limit(1);
  if (existing) {
    await db.update(reviewAssignmentSchema).set(patch).where(eq(reviewAssignmentSchema.id, existing.id));
  } else {
    await db.insert(reviewAssignmentSchema).values({ orgId, kind: item.kind, runId: item.id, ...patch });
  }
}

/**
 * Route a queue item to a user (or `null` to unassign). Idempotent per item.
 * @param orgId
 * @param item
 * @param item.kind
 * @param item.id
 * @param opts
 * @param opts.assignedTo
 * @param opts.assignedBy
 * @param opts.note
 */
export async function assign(
  orgId: string,
  item: { kind: ReviewKind; id: number },
  opts: { assignedTo: string | null; assignedBy?: string; note?: string },
): Promise<void> {
  await upsertAssignment(orgId, item, {
    assignedTo: opts.assignedTo,
    assignedBy: opts.assignedBy ?? null,
    note: opts.note ?? null,
    status: 'open',
    snoozedUntil: null,
  });
}

/**
 * Snooze a queue item until `until` — hidden from the active queue meanwhile.
 * @param orgId
 * @param item
 * @param item.kind
 * @param item.id
 * @param until
 * @param byUserId
 */
export async function snooze(
  orgId: string,
  item: { kind: ReviewKind; id: number },
  until: Date,
  byUserId?: string,
): Promise<void> {
  await upsertAssignment(orgId, item, { status: 'snoozed', snoozedUntil: until, assignedBy: byUserId ?? null });
}

/**
 * Approve or reject a queued item — dispatches to the owning service so the
 * single queue and the per-kind logic stay in sync.
 * @param item
 * @param item.kind
 * @param item.id
 * @param action
 * @param orgId
 * @param opts
 * @param opts.reason
 * @param opts.reviewedBy
 */
export async function decide(
  item: { kind: ReviewKind; id: number },
  action: 'approve' | 'reject',
  orgId: string,
  opts?: { reason?: string; reviewedBy?: string },
): Promise<void> {
  const reviewedBy = opts?.reviewedBy ?? 'review-service';
  switch (item.kind) {
    case 'skill':
      action === 'approve'
        ? await approveSkillRun({ orgId, runId: item.id, reviewedBy })
        : await rejectSkillRun({ orgId, runId: item.id, reviewedBy, feedback: opts?.reason ? { note: opts.reason, rating: 'down' } : undefined });
      return;
    case 'workflow':
      action === 'approve'
        ? await resumeWorkflow(item.id, orgId)
        : await cancelWorkflow(item.id, orgId, opts?.reason);
      return;
    case 'mission':
      action === 'approve'
        ? await resumeMission(item.id, orgId)
        : await cancelMission(item.id, orgId, opts?.reason);
      return;
    case 'action':
      action === 'approve'
        ? await executeAction(item.id, orgId)
        : await rejectAction(item.id, orgId, opts?.reason);
  }
}
