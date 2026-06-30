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
import { missionRunSchema, skillRunSchema, workflowRunSchema } from '@/models/Schema';
import { cancelMission, resumeMission } from '@/services/MissionService';
import { approveSkillRun, rejectSkillRun } from '@/services/SkillService';
import { cancelWorkflow, resumeWorkflow } from '@/services/WorkflowService';

export type ReviewKind = 'skill' | 'workflow' | 'mission';

export type ReviewItem = {
  kind: ReviewKind;
  id: number;
  orgId: string;
  title: string;
  status: string;
};

/** The status that means "needs human review" for each kind. */
const PENDING_STATUS: Record<ReviewKind, string> = {
  skill: 'pending',
  workflow: 'paused',
  mission: 'awaiting_review',
};

/**
 * The single pending-review queue for an org, newest-first within each kind.
 * @param orgId
 */
export async function listPending(orgId: string): Promise<ReviewItem[]> {
  const [skills, workflows, missions] = await Promise.all([
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
  ]);

  return [
    ...skills.map(r => ({ kind: 'skill' as const, id: r.id, orgId, title: `Skill run #${r.id}`, status: r.status ?? 'pending' })),
    ...workflows.map(r => ({ kind: 'workflow' as const, id: r.id, orgId, title: `Workflow run #${r.id}`, status: r.status })),
    ...missions.map(r => ({ kind: 'mission' as const, id: r.id, orgId, title: r.title, status: r.status })),
  ];
}

export async function pendingCount(orgId: string): Promise<number> {
  return (await listPending(orgId)).length;
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
  }
}
