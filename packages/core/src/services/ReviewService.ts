/**
 * ReviewService — ONE review queue across the planes.
 *
 * Gated work shows up in three places (paused workflow runs, missions
 * awaiting review, pending actions) and the MCP autonomy gate vs the UI
 * review queue didn't share a view. This unifies them: `listPending`
 * returns a single normalized queue, and `decide` dispatches
 * approve/reject to the right underlying service — so a gated mutation
 * is reviewed the same way regardless of which plane produced it
 * (firsthq/docs/platform-plan.md §4).
 */

import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, actionRunSchema, missionRunSchema, projectSchema, reviewAssignmentSchema, workflowRunSchema } from '@/models/Schema';
import { executeAction, rejectAction, updateActionInput } from '@/services/ActionService';
import { cancelMission, resumeMission } from '@/services/MissionService';
import { cancelWorkflow, resumeWorkflow } from '@/services/WorkflowService';

export type ReviewKind = 'workflow' | 'mission' | 'action';

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
  /** Restrict to one plane. Omit for the unified queue. */
  kind?: ReviewKind;
};

/** A page of the queue plus the total number of items the filters matched. */
export type PendingPage = {
  items: ReviewItem[];
  total: number;
  limit: number;
  offset: number;
};

/** The status that means "needs human review" for each kind. */
const PENDING_STATUS: Record<ReviewKind, string> = {
  workflow: 'paused',
  mission: 'awaiting_review',
  action: 'pending',
};

/**
 * Routing predicates shared by all three planes.
 *
 * Assignment and snooze live in one table, so the same two predicates apply
 * whichever run table it is joined to. They run in SQL rather than over the
 * fetched rows so a page never has to load the rows it is about to discard.
 * @param opts
 * @param now - Evaluation time for the snooze window.
 */
function routingFilters(opts: ListOptions, now: Date): SQL[] {
  const filters: SQL[] = [];
  if (!opts.includeSnoozed) {
    filters.push(or(
      isNull(reviewAssignmentSchema.snoozedUntil),
      lte(reviewAssignmentSchema.snoozedUntil, now),
    )!);
  }
  if (opts.assignedTo === null) {
    // The triage queue: no assignment row, or one that names nobody.
    filters.push(isNull(reviewAssignmentSchema.assignedTo));
  } else if (opts.assignedTo !== undefined) {
    filters.push(eq(reviewAssignmentSchema.assignedTo, opts.assignedTo));
  }
  return filters;
}

/**
 * The LEFT JOIN that hangs an item's routing off its run row.
 * @param orgId
 * @param kind
 * @param runIdColumn - The run table's primary key.
 */
function assignmentJoin(orgId: string, kind: ReviewKind, runIdColumn: PgColumn): SQL {
  return and(
    eq(reviewAssignmentSchema.orgId, orgId),
    eq(reviewAssignmentSchema.kind, kind),
    eq(reviewAssignmentSchema.runId, runIdColumn),
  )!;
}

/** One plane's slice of the queue, plus how many rows that plane holds in total. */
type PlaneResult = { items: ReviewItem[]; total: number };

/**
 * How many rows the plane holds, given the slice already fetched.
 *
 * A short read answers the question for free: fewer rows came back than were
 * asked for, so that is all there is. Only a full read needs a COUNT.
 * @param fetched - Rows the capped query returned.
 * @param cap - The cap that query ran under, or undefined for an uncapped read.
 * @param countRows - Runs the COUNT, only called when the read came back full.
 */
async function planeTotal(
  fetched: number,
  cap: number | undefined,
  countRows: () => Promise<number>,
): Promise<number> {
  if (cap === undefined || fetched < cap) {
    return fetched;
  }
  return countRows();
}

/**
 * Paused workflow runs awaiting a human.
 * @param orgId
 * @param opts
 * @param now
 * @param cap - Most rows to fetch. Undefined fetches every match.
 */
async function listWorkflowPlane(orgId: string, opts: ListOptions, now: Date, cap?: number): Promise<PlaneResult> {
  const where = and(
    eq(workflowRunSchema.orgId, orgId),
    eq(workflowRunSchema.status, PENDING_STATUS.workflow),
    ...routingFilters(opts, now),
  );
  const query = db
    .select({
      id: workflowRunSchema.id,
      status: workflowRunSchema.status,
      assignedTo: reviewAssignmentSchema.assignedTo,
      snoozedUntil: reviewAssignmentSchema.snoozedUntil,
      note: reviewAssignmentSchema.note,
    })
    .from(workflowRunSchema)
    .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'workflow', workflowRunSchema.id))
    .where(where)
    .orderBy(desc(workflowRunSchema.id));
  const rows = cap === undefined ? await query : await query.limit(cap);

  const items = rows.map(row => ({
    kind: 'workflow' as const,
    id: row.id,
    orgId,
    title: `Workflow run #${row.id}`,
    status: row.status,
    assignedTo: row.assignedTo,
    snoozedUntil: row.snoozedUntil,
    note: row.note,
  }));
  const total = await planeTotal(items.length, cap, async () => {
    const [counted] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(workflowRunSchema)
      .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'workflow', workflowRunSchema.id))
      .where(where);
    return counted?.total ?? 0;
  });
  return { items, total };
}

/**
 * Missions parked at a review gate.
 * @param orgId
 * @param opts
 * @param now
 * @param cap - Most rows to fetch. Undefined fetches every match.
 */
async function listMissionPlane(orgId: string, opts: ListOptions, now: Date, cap?: number): Promise<PlaneResult> {
  const where = and(
    eq(missionRunSchema.orgId, orgId),
    eq(missionRunSchema.status, PENDING_STATUS.mission),
    ...routingFilters(opts, now),
  );
  const query = db
    .select({
      id: missionRunSchema.id,
      title: missionRunSchema.title,
      status: missionRunSchema.status,
      assignedTo: reviewAssignmentSchema.assignedTo,
      snoozedUntil: reviewAssignmentSchema.snoozedUntil,
      note: reviewAssignmentSchema.note,
    })
    .from(missionRunSchema)
    .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'mission', missionRunSchema.id))
    .where(where)
    .orderBy(desc(missionRunSchema.id));
  const rows = cap === undefined ? await query : await query.limit(cap);

  const items = rows.map(row => ({
    kind: 'mission' as const,
    id: row.id,
    orgId,
    title: row.title,
    status: row.status,
    assignedTo: row.assignedTo,
    snoozedUntil: row.snoozedUntil,
    note: row.note,
  }));
  const total = await planeTotal(items.length, cap, async () => {
    const [counted] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(missionRunSchema)
      .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'mission', missionRunSchema.id))
      .where(where);
    return counted?.total ?? 0;
  });
  return { items, total };
}

/**
 * Proposed actions waiting on approval, minus the ones that have expired.
 * @param orgId
 * @param opts
 * @param now
 * @param cap - Most rows to fetch. Undefined fetches every match.
 */
async function listActionPlane(orgId: string, opts: ListOptions, now: Date, cap?: number): Promise<PlaneResult> {
  const where = and(
    eq(actionRunSchema.orgId, orgId),
    eq(actionRunSchema.status, PENDING_STATUS.action),
    // Stale suggestions drop out of the queue, matching the dashboard list.
    or(isNull(actionRunSchema.expiresAt), gt(actionRunSchema.expiresAt, now)),
    ...routingFilters(opts, now),
  );
  const query = db
    .select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      status: actionRunSchema.status,
      assignedTo: reviewAssignmentSchema.assignedTo,
      snoozedUntil: reviewAssignmentSchema.snoozedUntil,
      note: reviewAssignmentSchema.note,
    })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'action', actionRunSchema.id))
    .where(where)
    .orderBy(desc(actionRunSchema.id));
  const rows = cap === undefined ? await query : await query.limit(cap);

  const items = rows.map(row => ({
    kind: 'action' as const,
    id: row.id,
    orgId,
    title: `Action · ${row.actionId}`,
    status: row.status,
    assignedTo: row.assignedTo,
    snoozedUntil: row.snoozedUntil,
    note: row.note,
  }));
  const total = await planeTotal(items.length, cap, async () => {
    const [counted] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(actionRunSchema)
      .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'action', actionRunSchema.id))
      .where(where);
    return counted?.total ?? 0;
  });
  return { items, total };
}

/** An empty plane, for the kinds a `kind` filter excludes. */
const EMPTY_PLANE: PlaneResult = { items: [], total: 0 };

/**
 * Every plane the options ask for, each capped at `cap` rows.
 * @param orgId
 * @param opts
 * @param cap - Most rows to fetch per plane. Undefined fetches every match.
 */
async function listPlanes(orgId: string, opts: ListOptions, cap?: number): Promise<PlaneResult[]> {
  const now = new Date();
  const wants = (kind: ReviewKind) => opts.kind === undefined || opts.kind === kind;
  return Promise.all([
    wants('workflow') ? listWorkflowPlane(orgId, opts, now, cap) : EMPTY_PLANE,
    wants('mission') ? listMissionPlane(orgId, opts, now, cap) : EMPTY_PLANE,
    wants('action') ? listActionPlane(orgId, opts, now, cap) : EMPTY_PLANE,
  ]);
}

/**
 * The single pending-review queue for an org, newest-first within each kind.
 * Decorated with routing: each item carries its assignee + snooze. Pass
 * `opts.assignedTo` for a per-person queue (a user id, or `null` for the
 * unassigned/triage queue); snoozed items are hidden unless `includeSnoozed`.
 *
 * Returns every matching row. Anything serving a client should call
 * `listPendingPage` instead, which asks the database for one page.
 * @param orgId
 * @param opts
 */
export async function listPending(orgId: string, opts: ListOptions = {}): Promise<ReviewItem[]> {
  const planes = await listPlanes(orgId, opts);
  return planes.flatMap(plane => plane.items);
}

export async function pendingCount(orgId: string, opts: ListOptions = {}): Promise<number> {
  // Cap of 0 fetches no rows, so every plane falls through to its COUNT.
  const planes = await listPlanes(orgId, opts, 0);
  return planes.reduce((sum, plane) => sum + plane.total, 0);
}

/**
 * One page of the pending queue, plus the total the filters matched.
 *
 * The queue spans three tables, so the window is applied after the three
 * per-plane queries are merged — but each of those queries only ever fetches
 * `offset + limit` rows, which is every row the window could possibly draw
 * from. The queue can therefore grow without the cost of a page growing with
 * it. Ordering is workflow, then mission, then action, newest id first inside
 * each — a stable order, so paging never shows the same row twice.
 * @param orgId
 * @param opts
 * @param opts.limit - Rows per page. Defaults to every matching row.
 * @param opts.offset - Rows to skip.
 */
export async function listPendingPage(
  orgId: string,
  opts: ListOptions & { limit?: number; offset?: number } = {},
): Promise<PendingPage> {
  const offset = opts.offset ?? 0;
  const cap = opts.limit === undefined ? undefined : offset + opts.limit;
  const planes = await listPlanes(orgId, opts, cap);

  const merged = planes.flatMap(plane => plane.items);
  const total = planes.reduce((sum, plane) => sum + plane.total, 0);
  const limit = opts.limit ?? total;
  return { items: merged.slice(offset, offset + limit), total, limit, offset };
}

/** A queue item with everything a reviewer needs to decide it. */
export type ReviewDetail = ReviewItem & {
  /** The payload the decision would act on — the action input, or the run input. */
  input: Record<string, unknown> | null;
  /** Agent-proposal envelope: confidence, rationale, evidence. Actions only. */
  proposal: Record<string, unknown> | null;
  /** The action's own rendering of itself, when it defines a `reviewCard`. */
  card: unknown | null;
  /** Everything else about the underlying row, kept verbatim for the client. */
  record: Record<string, unknown>;
};

/**
 * One queue item in full, or `null` when the org does not own it.
 *
 * `listPending` deliberately returns a thin row so the queue stays cheap to
 * poll. A client rendering its own review screen needs the rest — the proposed
 * input, why the agent proposed it, and the action's card — which is what this
 * returns.
 * @param orgId
 * @param kind
 * @param id
 */
export async function getReviewDetail(orgId: string, kind: ReviewKind, id: number): Promise<ReviewDetail | null> {
  const [assignment] = await db
    .select()
    .from(reviewAssignmentSchema)
    .where(and(
      eq(reviewAssignmentSchema.orgId, orgId),
      eq(reviewAssignmentSchema.kind, kind),
      eq(reviewAssignmentSchema.runId, id),
    ))
    .limit(1);

  const routing = {
    assignedTo: assignment?.assignedTo ?? null,
    snoozedUntil: assignment?.snoozedUntil ?? null,
    note: assignment?.note ?? null,
  };

  if (kind === 'action') {
    const [row] = await db
      .select()
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id)))
      .limit(1);
    if (!row) {
      return null;
    }
    return {
      kind,
      id: row.id,
      orgId,
      title: `Action · ${row.actionId}`,
      status: row.status,
      ...routing,
      input: row.input ?? null,
      proposal: (row.proposal as Record<string, unknown> | null) ?? null,
      card: await renderActionCard(orgId, row.actionId, row.input ?? {}),
      record: row as unknown as Record<string, unknown>,
    };
  }

  if (kind === 'workflow') {
    const [row] = await db
      .select()
      .from(workflowRunSchema)
      .where(and(eq(workflowRunSchema.orgId, orgId), eq(workflowRunSchema.id, id)))
      .limit(1);
    if (!row) {
      return null;
    }
    return {
      kind,
      id: row.id,
      orgId,
      title: `Workflow run #${row.id}`,
      status: row.status,
      ...routing,
      input: row.input ?? null,
      proposal: null,
      card: null,
      record: row as unknown as Record<string, unknown>,
    };
  }

  const [row] = await db
    .select()
    .from(missionRunSchema)
    .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, id)))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    kind,
    id: row.id,
    orgId,
    title: row.title,
    status: row.status,
    ...routing,
    input: null,
    proposal: null,
    card: null,
    record: row as unknown as Record<string, unknown>,
  };
}

/**
 * Render an action's own review card, or `null` when it defines none.
 *
 * A presenter is client code that can throw; a broken card must never take the
 * whole queue down, so a failure is logged and degrades to the generic view.
 * @param orgId
 * @param actionId
 * @param input
 */
async function renderActionCard(orgId: string, actionId: string, input: Record<string, unknown>): Promise<unknown | null> {
  const { getAction } = await import('@/libs/actions/registry');
  const presenter = getAction(actionId)?.reviewCard;
  if (!presenter) {
    return null;
  }
  try {
    return (await presenter({ orgId }, input)) ?? null;
  } catch (error) {
    console.error(`[ReviewService] reviewCard presenter for "${actionId}" failed`, error);
    return null;
  }
}

/**
 * Proposals the confidence gate executed without a human — the audit trail for
 * the trust ladder. Newest first.
 * @param orgId
 * @param opts
 * @param opts.limit
 * @param opts.offset
 */
export async function listAutoExecuted(
  orgId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: Array<typeof actionRunSchema.$inferSelect>; total: number; limit: number; offset: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const autoApproved = and(
    eq(actionRunSchema.orgId, orgId),
    sql`${actionRunSchema.proposal} ->> 'autoApproved' = 'true'`,
  );
  const [items, [counted]] = await Promise.all([
    db
      .select()
      .from(actionRunSchema)
      .where(autoApproved)
      .orderBy(desc(actionRunSchema.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(actionRunSchema).where(autoApproved),
  ]);
  return { items, total: counted?.total ?? 0, limit, offset };
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
export class UnknownAssigneeError extends Error {
  constructor(userId: string) {
    super(`no member of this org with id ${JSON.stringify(userId)}`);
    this.name = 'UnknownAssigneeError';
  }
}

/**
 * Is this user a member of the account that owns the project?
 *
 * `assigned_to` is a foreign key, so an id that names nobody used to surface as
 * a database error — a 500 for what is really a bad request. Checking first
 * turns it into an answer the caller can act on, and stops one org routing work
 * to a user in another.
 * @param orgId
 * @param userId
 */
async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const [member] = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(and(eq(projectSchema.id, orgId), eq(accountMembershipSchema.userId, userId)))
    .limit(1);
  return member !== undefined;
}

export async function assign(
  orgId: string,
  item: { kind: ReviewKind; id: number },
  opts: { assignedTo: string | null; assignedBy?: string; note?: string },
): Promise<void> {
  if (opts.assignedTo !== null && !(await isOrgMember(orgId, opts.assignedTo))) {
    throw new UnknownAssigneeError(opts.assignedTo);
  }
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
 * @param opts
 * @param opts.note
 */
export async function snooze(
  orgId: string,
  item: { kind: ReviewKind; id: number },
  until: Date,
  byUserId?: string,
  opts?: { note?: string },
): Promise<void> {
  await upsertAssignment(orgId, item, {
    status: 'snoozed',
    snoozedUntil: until,
    assignedBy: byUserId ?? null,
    ...(opts?.note !== undefined ? { note: opts.note } : {}),
  });
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
 * @param opts.editedInput
 * @param opts.note
 * @param opts.externalRef
 * @param opts.externalRef.system
 * @param opts.externalRef.id
 */
export async function decide(
  item: { kind: ReviewKind; id: number },
  action: 'approve' | 'reject',
  orgId: string,
  opts?: {
    reason?: string;
    reviewedBy?: string;
    editedInput?: Record<string, unknown>;
    /** Reviewer's note for the agent — stored on the assignment, the triage signal, and the learning capture. */
    note?: string;
    /**
     * The record the approver just created in its own system. Passed straight
     * to the action, which links its domain row to it. Ignored on reject.
     */
    externalRef?: { system: string; id: string };
  },
): Promise<void> {
  const reviewedBy = opts?.reviewedBy ?? 'review-service';
  switch (item.kind) {
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
        await executeAction(item.id, orgId, { reviewedBy, externalRef: opts?.externalRef });
      } else {
        await rejectAction(item.id, orgId, opts?.reason ?? opts?.note, { reviewedBy });
      }
      // The reviewer's note rides every verb: assignment note (visible on the
      // item), triage signal hint, and the learning capture below.
      if (opts?.note) {
        await upsertAssignment(orgId, item, { note: opts.note }).catch(() => {});
      }
      // Typed signal: edit-then-approve is a distinct signal from a clean
      // approve (the operator changed the wording → weaker tone match).
      await recordActionSignal({
        orgId,
        runId: item.id,
        userId: reviewedBy,
        signal: action === 'approve' ? (opts?.editedInput ? 'edit' : 'approve') : 'reject',
        hint: opts?.note,
      }).catch(() => {});
      // The decision is training signal: record what a good/bad proposal
      // looks like in the `crm-updates` learning step so agents check their
      // next proposals against real operator judgment. Never blocks the
      // decision itself.
      await recordActionDecisionLearning(item.id, orgId, action, opts?.reason ?? opts?.note).catch(() => {});
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
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.signal
 * @param opts.userId
 * @param opts.hint
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
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.hint
 * @param opts.userId
 */
export async function rewriteDraft(opts: {
  orgId: string;
  runId: number;
  hint?: string;
  userId?: string;
  /**
   * Which piece of content to rewrite, by the card's content id (e.g.
   * `send-2`). Without it the run's single body is rewritten, as before — a
   * sequence has several, and a guided review asks about one at a time.
   */
  contentId?: string;
}): Promise<{ input: Record<string, unknown>; body: string; contentId?: string }> {
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
  // A targeted rewrite reads the addressed send; an untargeted one reads the
  // run's single body, which is what every non-sequence action has.
  const sends = Array.isArray(input.sends) ? input.sends as Array<Record<string, unknown>> : null;
  const targetStep = opts.contentId?.startsWith('send-') ? Number(opts.contentId.slice(5)) : null;
  const targetSend = sends && targetStep !== null
    ? sends.find(s => Number(s.step) === targetStep)
    : null;
  if (opts.contentId && !targetSend) {
    throw new Error(`no content ${opts.contentId} on action ${opts.runId}`);
  }
  const original = targetSend
    ? String(targetSend.body ?? '')
    : String(input.body ?? input.notes ?? props.notes ?? '');
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const model = await buildChatModelForOrg('main', opts.orgId, { temperature: 0.4, streaming: false, maxTokens: 1200 });
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
  if (targetSend && sends) {
    // The caller holds the revision and passes it back on approve, the same
    // edit-then-approve path the card already uses — nothing is persisted
    // behind the reviewer's back.
    return {
      input: {
        ...input,
        sends: sends.map(s => (Number(s.step) === targetStep ? { ...s, body: rewritten } : s)),
      },
      body: rewritten,
      contentId: opts.contentId,
    };
  }
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
