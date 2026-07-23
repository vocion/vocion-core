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
import { executeAction, rejectAction, updateActionInput } from '@/services/ActionService';
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
  opts?: { reason?: string; reviewedBy?: string; editedInput?: Record<string, unknown> },
): Promise<void> {
  const reviewedBy = opts?.reviewedBy ?? 'review-service';
  switch (item.kind) {
    case 'skill':
      // `transitionStatus` in SkillService records the adoption event for
      // this kind — every skill-decision entry path funnels through it.
      action === 'approve'
        ? await approveSkillRun({ orgId, runId: item.id, reviewedBy })
        : await rejectSkillRun({ orgId, runId: item.id, reviewedBy, feedback: opts?.reason ? { note: opts.reason, rating: 'down' } : undefined });
      return;
    case 'workflow':
      action === 'approve'
        ? await resumeWorkflow(item.id, orgId)
        : await cancelWorkflow(item.id, orgId, opts?.reason);
      trackDecision(item, action, orgId, reviewedBy);
      return;
    case 'mission':
      action === 'approve'
        ? await resumeMission(item.id, orgId)
        : await cancelMission(item.id, orgId, opts?.reason);
      trackDecision(item, action, orgId, reviewedBy);
      return;
    case 'action':
      if (action === 'approve') {
        // Edit-then-approve: if the operator edited the draft in the queue,
        // persist the edited payload FIRST (re-validated in ActionService),
        // so executeAction — which re-reads the row — sends what they see.
        if (opts?.editedInput) {
          await updateActionInput(item.id, orgId, opts.editedInput);
        }
        await executeAction(item.id, orgId);
      } else {
        await rejectAction(item.id, orgId, opts?.reason);
      }
      // Typed signal: edit-then-approve is a distinct signal from a clean
      // approve (the operator changed the wording → weaker tone match).
      await recordActionSignal({
        orgId,
        runId: item.id,
        userId: reviewedBy,
        signal: action === 'approve' ? (opts?.editedInput ? 'edit' : 'approve') : 'reject',
      }).catch(() => {});
      // The decision is training signal: record what a good/bad proposal
      // looks like in the `crm-updates` learning step so agents check their
      // next proposals against real operator judgment. Never blocks the
      // decision itself.
      await recordActionDecisionLearning(item.id, orgId, action, opts?.reason).catch(() => {});
  }
}

/**
 * Adoption-stream capture for HITL decisions. One `review.decided` event
 * with the run kind in metadata — a new kind routed through `decide()`
 * inherits tracking with zero extra code. Fire-and-forget.
 * @param item
 * @param item.kind
 * @param item.id
 * @param action
 * @param orgId
 * @param reviewedBy
 */
function trackDecision(
  item: { kind: ReviewKind; id: number },
  action: 'approve' | 'reject',
  orgId: string,
  reviewedBy: string,
): void {
  void (async () => {
    const { trackReviewDecision } = await import('@/services/adoption/attribution');
    await trackReviewDecision(
      { orgId, userId: reviewedBy },
      item,
      action === 'approve' ? 'approved' : 'rejected',
    );
  })();
}

/** Every distinct triage decision on an agent-suggested action. */
export type ActionSignal = 'approve' | 'edit' | 'reject' | 'skip' | 'save' | 'rewrite';

const SIGNAL_TO_DECISION = {
  approve: 'approved',
  edit: 'edited',
  reject: 'rejected',
  skip: 'skipped',
  save: 'saved',
  rewrite: 'rewritten',
} as const;

/**
 * Record a TYPED triage signal on the adoption stream — approve/edit/reject
 * are terminal; skip/save leave the item pending; rewrite = the human asked AI
 * to redo the draft. Distinct signals so downstream scoring/alignment + the
 * per-user tone prompt can weight them differently (an edit or rewrite says
 * "close but wrong voice"; a reject says "wrong call"). Fire-and-forget.
 */
export async function recordActionSignal(opts: { orgId: string; runId: number; signal: ActionSignal; userId?: string; hint?: string }): Promise<void> {
  try {
    const [run] = await db
      .select({ invokedBy: actionRunSchema.invokedBy, actionId: actionRunSchema.actionId })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1);
    const agentSlug = run?.invokedBy?.startsWith('agent:') ? run.invokedBy.slice('agent:'.length) : undefined;
    const { track } = await import('@/services/adoption/track');
    // Scope dimensions travel together: userId (individual) + orgId (workspace)
    // on the actor, actionId (action type) in meta.
    await track({ orgId: opts.orgId, userId: opts.userId ?? 'web' }, 'review.decided', {
      agentSlug,
      resource: ['action_run', opts.runId],
      meta: { kind: 'action', decision: SIGNAL_TO_DECISION[opts.signal], ...(run?.actionId ? { actionId: run.actionId } : {}), ...(opts.hint ? { hint: opts.hint } : {}) },
    });
  } catch {
    /* signal capture never blocks the decision */
  }
}

/**
 * Rewrite-with-AI on a pending action's draft. Returns the rewritten input
 * (NOT persisted — the human reviews it, then Send with editedInput) and
 * records a `rewrite` signal. The rewrite instruction is itself a tone signal:
 * the human wanted the agent's wording changed.
 */
export async function rewriteDraft(opts: { orgId: string; runId: number; hint?: string; userId?: string }): Promise<{ input: Record<string, unknown>; body: string }> {
  const [run] = await db
    .select({ input: actionRunSchema.input, actionId: actionRunSchema.actionId })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId), eq(actionRunSchema.status, 'pending')))
    .limit(1);
  if (!run) {
    throw new Error(`no pending action ${opts.runId}`);
  }
  const input = (run.input ?? {}) as Record<string, unknown>;
  const props = (input.properties ?? {}) as Record<string, unknown>;
  const original = String(input.body ?? input.notes ?? props.notes ?? '');
  const { buildChatModel } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const model = buildChatModel('main', { temperature: 0.4, streaming: false, maxTokens: 1200 });
  // Generic house-style rewrite — no workspace-specific voice baked into core.
  // (The learned per-user tone prompt, when built, will supply the voice.)
  const sys = 'You rewrite an outbound draft in the sender\'s established voice: concise, specific, no filler or "just checking in". Preserve the core ask and any concrete details/names. It stays a DRAFT for human review. Return ONLY the rewritten text, no preamble.';
  const user = `${opts.hint ? `Instruction: ${opts.hint}\n\n` : ''}Rewrite this:\n\n${original}`;
  let rewritten = original;
  try {
    const res = await model.invoke([new SystemMessage(sys), new HumanMessage(user)], { signal: AbortSignal.timeout(20_000) });
    const out = typeof res.content === 'string'
      ? res.content
      : (Array.isArray(res.content) ? res.content.map(c => (c as { text?: string }).text ?? '').join('') : '');
    rewritten = out.trim() || original;
  } catch {
    rewritten = original;
  }
  await recordActionSignal({ orgId: opts.orgId, runId: opts.runId, signal: 'rewrite', userId: opts.userId, hint: opts.hint });
  if (input.body === undefined && input.notes === undefined && props.notes !== undefined) {
    return { input: { ...input, properties: { ...props, notes: rewritten } }, body: rewritten };
  }
  const key = input.body !== undefined ? 'body' : 'notes';
  return { input: { ...input, [key]: rewritten }, body: rewritten };
}

/**
 * Approve/reject on a proposed action → a learning rule. This is the capture
 * side of the trust ladder: accumulated decisions teach agents which update
 * classes are safe (approved) vs which need stronger evidence (rejected).
 * No-ops quietly when the workspace has no `crm-updates` learning step.
 * @param runId
 * @param orgId
 * @param decision
 * @param reason
 */
async function recordActionDecisionLearning(
  runId: number,
  orgId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<void> {
  const [run] = await db
    .select({
      actionId: actionRunSchema.actionId,
      input: actionRunSchema.input,
      proposal: actionRunSchema.proposal,
      invokedBy: actionRunSchema.invokedBy,
    })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
    .limit(1);
  if (!run || !run.invokedBy?.startsWith('agent:')) {
    return; // only agent proposals train agents
  }
  const input = (run.input ?? {}) as { objectType?: string; properties?: Record<string, unknown> };
  const props = Object.keys(input.properties ?? {}).join(', ') || 'n/a';
  const conf = run.proposal?.confidence != null ? ` (confidence ${run.proposal.confidence})` : '';
  const rationale = run.proposal?.rationale ? ` Rationale was: ${run.proposal.rationale.slice(0, 140)}` : '';
  const ruleText = decision === 'approve'
    ? `APPROVED${conf}: ${run.actionId} on ${input.objectType ?? 'record'} updating [${props}].${rationale} — this class of update matched operator judgment; similar evidence justifies similar proposals.`
    : `REJECTED${conf}: ${run.actionId} on ${input.objectType ?? 'record'} updating [${props}].${reason ? ` Operator reason: ${reason.slice(0, 120)}.` : ''}${rationale} — do not propose this class again without stronger evidence.`;
  const { addLearning } = await import('./LearningsService');
  await addLearning({
    orgId,
    stepName: 'crm-updates',
    ruleText,
    source: `action_run:${runId}`,
    createdBy: 'review-decision',
  });
}
