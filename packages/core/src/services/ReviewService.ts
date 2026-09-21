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
import type { LabelVerdict } from '@/libs/actions/labelVerdict';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import type { AlignmentScore } from '@/services/alignment/AlignmentService';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { policyKeyForRun } from '@/libs/actions/policyKey';
import { nextRevisionVersion, revisionsFor } from '@/libs/actions/revisions';
import { parseSuggestedDecision, parseSuggestedDecisionReason } from '@/libs/actions/suggestedDecision';
import { db } from '@/libs/DB';
import { FEATURES } from '@/libs/Langfuse/features';
import { logger } from '@/libs/Logger';
import { accountMembershipSchema, actionRunSchema, missionRunSchema, projectSchema, reviewAssignmentSchema, workflowRunSchema } from '@/models/Schema';
import { completeAction, executeAction, rejectAction, updateActionInput } from '@/services/ActionService';
import { recordActionAlignment, scoreFor } from '@/services/alignment/AlignmentService';
import { chargeModelCall } from '@/services/budget/chargeModelCall';
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
  /**
   * When the item entered the queue. On the thin row because "how long has
   * this been waiting" is a queue's own question, and a client that sorts or
   * ages a queue should not have to fetch each item's detail to ask it.
   *
   * All three planes have the column, so this is never undefined for a reason
   * the caller has to reason about.
   */
  createdAt?: Date | null;
  /**
   * What the agent recommended doing with this — `approve`, `reject` or
   * `snooze`. Undefined when the agent gave no view, and on every workflow and
   * mission item, which carry no proposal envelope at all.
   *
   * On the thin row on purpose. A client building a lane of "everything the
   * screener wants turned down" would otherwise need one detail fetch per item
   * just to label rows it already has in hand.
   */
  suggestedDecision?: SuggestedDecision;
  /**
   * The one sentence the proposer gave for that recommendation, so a lane of
   * "everything the screener wants turned down" can show WHY beside each row.
   *
   * Not `proposal.rationale`, which argues the payload is right. This argues
   * what should happen to the card, which is the part a reviewer is deciding.
   */
  suggestedDecisionReason?: string;
  /**
   * Who made the approval call: `true` an agent took it on its own via the
   * trust ladder, `false` a person decided it, `null` nobody has decided yet.
   *
   * Null on every item still waiting for a decision, and on every run decided
   * before the column shipped. Never read a missing value as a human approval;
   * it means unknown.
   *
   * Not always null in the queue, which is the part worth knowing: a run whose
   * approval stood but whose execution threw stays in the queue as `failed`,
   * so it carries the real answer — `true` when the trust ladder released it,
   * `false` when a person did.
   *
   * Workflow and mission items carry `null` too: neither plane has an
   * auto-approval path, so there is no honest value other than "no agent
   * decided this".
   */
  approvedByAgent?: boolean | null;
  /**
   * The payload the decision would act on, present ONLY when the caller asked
   * for it through `include`. Undefined otherwise, which is every caller that
   * existed before this option did.
   *
   * Same reasoning as `suggestedDecision` above, one step further. A client
   * that sorts the queue by something inside the payload - a proposal's date,
   * its venue, whether it is complete enough to publish - cannot do that from
   * a thin row, so it fetches every item's detail just to bucket it. At 428
   * pending items that is 428 round trips to build one screen.
   *
   * Opt-in because the payload is unbounded. A page of thin rows is a few KB;
   * the same page carrying inputs can be a megabyte, and no existing caller
   * should start paying that without asking.
   */
  input?: Record<string, unknown> | null;
  /**
   * The agent-proposal envelope - confidence, rationale, evidence - present
   * only when asked for. Actions only: a workflow or mission item carries no
   * envelope and keeps this undefined even when requested.
   */
  proposal?: Record<string, unknown> | null;
};

/** A payload a list caller may ask to have inlined on each item. */
export const REVIEW_INCLUDES = ['input', 'proposal'] as const;
export type ReviewInclude = (typeof REVIEW_INCLUDES)[number];

export type ListOptions = {
  /** Filter to items routed to this user id; pass `null` for the unassigned queue. Omit for all. */
  assignedTo?: string | null;
  /** Include snoozed items (default: hide items snoozed into the future). */
  includeSnoozed?: boolean;
  /** Restrict to one plane. Omit for the unified queue. */
  kind?: ReviewKind;
  /**
   * Restrict the action plane to these registered action ids
   * (`personalization.enroll`, `hubspot.update`, …). Omit for every type.
   *
   * `kind` is the PLANE — workflow, mission, action — and a queue holding 557
   * pending items can be 557 rows of one plane, which is exactly what
   * production holds. This is the filter that separates them, and it runs in
   * the WHERE clause so the per-plane `total` stays truthful under it.
   *
   * An empty array means "no action type matches", not "every type": that is
   * what a caller asking for a type this org has never produced must get.
   */
  actionIds?: string[];
  /**
   * Inline these payloads on each item instead of leaving each one to its own
   * detail fetch. Omit for the thin rows every caller gets today.
   *
   * Additive by construction: an item carries a key only when it was asked
   * for, so a caller that passes nothing gets a byte-identical response to the
   * one it got before this existed. Only the action plane has either payload
   * to give, and the columns are selected only when requested, so an unasked
   * query reads exactly the columns it always did.
   */
  include?: readonly ReviewInclude[];
  /**
   * Restrict to items where the AGENT recommended this — `approve`, `reject`
   * or `snooze`. Only action runs carry a recommendation, so this narrows the
   * queue to the action plane by definition: a workflow or mission item has no
   * proposal envelope to match, and returning them under a filter about what
   * an agent advised would be answering a different question than the one
   * asked.
   *
   * Runs in the WHERE clause, like `actionIds`, so the total stays truthful
   * rather than counting the whole queue and filtering the page.
   */
  suggestedDecision?: SuggestedDecision;
  /**
   * Restrict to items by WHO made the approval call: `true` the trust ladder
   * took it, `false` a person did, `null` nobody has yet.
   *
   * What this cuts is the failed lane. A run whose approval stood and whose
   * execution threw stays in the queue, so "the agent released this and it
   * broke" is a real set of rows and a different triage job from "a person
   * approved it and it broke" — until now they came back mixed together.
   *
   * `true` and `false` return the action plane alone: no workflow or mission
   * has an auto-approval path, so no row on those planes could ever match.
   * `null` keeps all three, because an item nobody has decided is exactly what
   * a paused workflow or a mission awaiting review is.
   *
   * Runs in the WHERE clause, like `actionIds` and `suggestedDecision`, so the
   * total stays truthful rather than counting the whole queue and filtering
   * the page. Omit the key for no filter — passing `null` is a filter, and
   * means something different.
   */
  approvedByAgent?: boolean | null;
};

/** A page of the queue plus the total number of items the filters matched. */
export type PendingPage = {
  items: ReviewItem[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * The agent's recommendation, read out of the proposal blob as a plain string.
 *
 * Written once and shared by the SELECT, the WHERE and the COUNT so the three
 * cannot drift into asking slightly different questions — and so the
 * expression matches `action_run_suggested_decision_idx` exactly, which is the
 * only way the index gets used at all.
 */
const suggestedDecisionColumn = sql<string | null>`${actionRunSchema.proposal} ->> 'suggestedDecision'`;
const suggestedDecisionReasonColumn = sql<string | null>`${actionRunSchema.proposal} ->> 'suggestedDecisionReason'`;

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
 * The WHERE clause for the `approvedByAgent` filter, or nothing when the
 * caller did not ask for one.
 *
 * Spread into the clause rather than returned as a value, because "no filter"
 * and "filter on null" are different requests and only an empty list can say
 * the first one. Asking for null compiles to IS NULL: `approved_by_agent =
 * NULL` is never true in SQL and would hand back an empty queue.
 * @param opts
 */
function approvedByAgentFilter(opts: ListOptions): SQL[] {
  if (opts.approvedByAgent === undefined) {
    return [];
  }
  if (opts.approvedByAgent === null) {
    return [isNull(actionRunSchema.approvedByAgent)];
  }
  return [eq(actionRunSchema.approvedByAgent, opts.approvedByAgent)];
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
      createdAt: workflowRunSchema.createdAt,
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
    createdAt: row.createdAt,
    // Stated, not omitted: `getReviewDetail` returns null for this plane, and
    // a key that is present on the detail but missing from the list is the
    // shape a client reads with `?? false` and gets wrong.
    approvedByAgent: null,
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
      createdAt: missionRunSchema.createdAt,
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
    createdAt: row.createdAt,
    // Same as the workflow plane: present and null, never absent.
    approvedByAgent: null,
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
    // Pending AND failed, matching listPendingActions: a failed execution is
    // open work, not a decided card.
    inArray(actionRunSchema.status, [PENDING_STATUS.action, 'failed']),
    // Stale suggestions drop out of the queue, matching the dashboard list.
    or(isNull(actionRunSchema.expiresAt), gt(actionRunSchema.expiresAt, now)),
    // In SQL, not over the fetched page: with 557 pending items and a window
    // of 50, filtering after the read would hand back whichever of the newest
    // 50 happened to match and call it the total.
    ...(opts.actionIds ? [inArray(actionRunSchema.actionId, opts.actionIds.length > 0 ? opts.actionIds : [''])] : []),
    // Reads the key out of the proposal blob. `action_run_suggested_decision_idx`
    // is the expression index behind this; it is partial on the same two
    // statuses the clause above names, so the two have to stay in step.
    ...(opts.suggestedDecision ? [eq(suggestedDecisionColumn, opts.suggestedDecision)] : []),
    // `null` is a value the caller can ask for, so the key being ABSENT is the
    // only thing that means "no filter" — `opts.approvedByAgent ? …` would
    // quietly turn a request for undecided rows into a request for all of them.
    // Asking for null needs IS NULL: `= NULL` matches nothing in SQL.
    ...approvedByAgentFilter(opts),
    ...routingFilters(opts, now),
  );
  // Two jsonb columns the queue has never read. They are selected only when a
  // caller asked for them, so the query an existing caller issues is unchanged
  // down to the column list, and nobody starts paying to haul payloads they
  // are not going to look at.
  const wantsInput = opts.include?.includes('input') ?? false;
  const wantsProposal = opts.include?.includes('proposal') ?? false;
  const query = db
    .select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      status: actionRunSchema.status,
      assignedTo: reviewAssignmentSchema.assignedTo,
      snoozedUntil: reviewAssignmentSchema.snoozedUntil,
      note: reviewAssignmentSchema.note,
      createdAt: actionRunSchema.createdAt,
      suggestedDecision: suggestedDecisionColumn,
      suggestedDecisionReason: suggestedDecisionReasonColumn,
      approvedByAgent: actionRunSchema.approvedByAgent,
      ...(wantsInput ? { input: actionRunSchema.input } : {}),
      ...(wantsProposal ? { proposal: actionRunSchema.proposal } : {}),
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
    // Parsed rather than cast: the column is jsonb, so a value written by an
    // older release or by hand can be any string at all, and a row claiming a
    // recommendation nobody defined should read as having none.
    suggestedDecision: parseSuggestedDecision(row.suggestedDecision),
    suggestedDecisionReason: parseSuggestedDecisionReason(row.suggestedDecisionReason),
    // Null for a run still waiting, and the real answer for a `failed` one —
    // that approval already happened, the execution is what threw. Carried on
    // every item either way, so a client reads one shape across the queue.
    approvedByAgent: row.approvedByAgent,
    createdAt: row.createdAt,
    // Spread rather than assigned, so an item that was not asked for a payload
    // has no key at all rather than a key holding undefined. That is what lets
    // `include` be provably additive: JSON.stringify of an unasked row is
    // byte-identical to what it was before this option existed.
    ...(wantsInput ? { input: (row as { input?: Record<string, unknown> | null }).input ?? null } : {}),
    ...(wantsProposal
      ? { proposal: (row as { proposal?: Record<string, unknown> | null }).proposal ?? null }
      : {}),
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

/** One card type present in the pending queue, with its real count. */
export type PendingActionType = {
  actionId: string;
  /** The action's own registered display name; the id itself when nothing is registered. */
  label: string;
  count: number;
};

/**
 * The card types actually pending for this org, each with a true count.
 *
 * One GROUP BY, so a chip reads "Enroll 46" rather than counting whatever the
 * current page happens to hold — with 557 pending items and a window of 50,
 * those are different numbers. The list is driven by what is present, never a
 * hardcoded set: the point of the card template is that a new object type
 * registers without a UI change.
 *
 * Labels come from the action registry, so `personalization.enroll` renders as
 * what its author called it and the slug stays available for the URL.
 * @param orgId - Tenant.
 * @param opts - The same routing filters the queue itself runs under, minus `actionIds`.
 */
export async function pendingActionTypes(orgId: string, opts: ListOptions = {}): Promise<PendingActionType[]> {
  const now = new Date();
  const rows = await db
    .select({ actionId: actionRunSchema.actionId, n: sql<number>`count(*)::int` })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, assignmentJoin(orgId, 'action', actionRunSchema.id))
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      // Failed runs count as open work, matching the queue feed: an approved
      // action whose execution threw still needs a human (see listPendingActions).
      inArray(actionRunSchema.status, [PENDING_STATUS.action, 'failed']),
      or(isNull(actionRunSchema.expiresAt), gt(actionRunSchema.expiresAt, now)),
      ...routingFilters(opts, now),
    ))
    .groupBy(actionRunSchema.actionId);

  const { getAction } = await import('@/libs/actions/registry');
  return rows
    .map(row => ({
      actionId: row.actionId,
      label: getAction(row.actionId)?.name ?? row.actionId,
      count: Number(row.n),
    }))
    .sort((a, b) => b.count - a.count || a.actionId.localeCompare(b.actionId));
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
  // A recommendation only exists on an action run, so asking for one excludes
  // the other two planes rather than returning rows that could never match.
  const planeCarriesRecommendation = (kind: ReviewKind) => kind === 'action' || opts.suggestedDecision === undefined;
  // Only an action run can have been decided by an agent, so asking for a
  // decided row — true or false — excludes the other two planes the same way.
  // Asking for `null` does NOT: an item nobody has decided is exactly what a
  // paused workflow or a mission awaiting review is, so those still belong.
  const planeCanBeDecided = (kind: ReviewKind) =>
    kind === 'action' || opts.approvedByAgent === undefined || opts.approvedByAgent === null;
  const wants = (kind: ReviewKind) =>
    (opts.kind === undefined || opts.kind === kind)
    && planeCarriesRecommendation(kind)
    && planeCanBeDecided(kind);
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
  /** How often this agent's recommendations of this kind matched the person (30d). Actions only. */
  alignment?: AlignmentScore | null;
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
      suggestedDecision: parseSuggestedDecision(row.proposal?.suggestedDecision),
      suggestedDecisionReason: parseSuggestedDecisionReason(row.proposal?.suggestedDecisionReason),
      approvedByAgent: row.approvedByAgent,
      card: await renderActionCard(orgId, row.actionId, row.input ?? {}),
      alignment: await scoreFor({
        orgId,
        subjectKey: policyKeyForRun(row.actionId, row.input),
        agentSlug: row.invokedBy?.startsWith('agent:') ? row.invokedBy.slice('agent:'.length) : row.proposal?.agentSlug ?? null,
      }).catch(() => null),
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
      // No auto-approval path on this plane, so no agent ever decides one.
      // Stated rather than omitted, so a client reads the same field on every
      // kind instead of having to know which planes carry it.
      approvedByAgent: null,
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
    // Same as the workflow plane: missions have no auto-approval path.
    approvedByAgent: null,
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
  // `approved_by_agent` is the whole question, and it is the whole question on
  // purpose: migration 0108 backfilled every pre-column run whose proposal
  // envelope said `autoApproved`, so there is no older population left to read
  // a jsonb key for. That matters for more than tidiness — an `OR` over a
  // jsonb expression cannot use `action_run_approved_by_agent_idx`, so the
  // fallback this replaced turned a one-page audit read into a scan of every
  // action run the org has ever recorded.
  const autoApproved = and(
    eq(actionRunSchema.orgId, orgId),
    eq(actionRunSchema.approvedByAgent, true),
  );
  const [items, [counted]] = await Promise.all([
    db
      .select()
      .from(actionRunSchema)
      .where(autoApproved)
      // Newest decision first, and in the index's own order so a page is read
      // off it rather than sorted out of the org's whole history. Backfilled
      // rows have no `decided_at` — we never knew when they were decided — and
      // sort last, where an undated row belongs; `id` only breaks ties.
      .orderBy(sql`${actionRunSchema.decidedAt} DESC NULLS LAST`, desc(actionRunSchema.id))
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
  // The assignment row only ever holds the CURRENT snooze — the next one
  // overwrites it — so the adoption event is the only record that a deferral
  // happened at all. Awaited (not fired and forgotten) because
  // `trackReviewSnooze` cannot reject and the caller is already awaiting a
  // write; ordering it here means a snooze and its event land together.
  const { trackReviewSnooze } = await import('@/services/adoption/attribution');
  await trackReviewSnooze({ orgId, userId: byUserId ?? 'web' }, item, until);
}

/**
 * What the decision did downstream. `execution` is set for approved actions
 * only: a `failed` status there means the approval stood but the action threw,
 * and the surface that clicked Approve must say so rather than look done.
 */
export type DecideResult = {
  execution?: { status: 'pending' | 'awaiting_execution' | 'done' | 'failed' | 'rejected' | 'undone'; error: string | null };
};

/**
 * The verbs a queued item takes. `done` is the hand-off's third verb
 * (`libs/actions/manual.ts`): a released run is marked done by whoever did
 * the work, with a note and where the result lives. Only an action can take
 * it, and only one in `awaiting_execution`.
 */
export type DecideVerb = 'approve' | 'reject' | 'done';

/** A verb the item cannot take — the caller's mistake, said plainly. */
class ReviewDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewDecisionError';
  }
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
 * @param opts.resultUrl
 * @param opts.note
 * @param opts.learn - `false` from an automated caller; trains nothing.
 * @param opts.externalRef
 * @param opts.externalRef.system
 * @param opts.externalRef.id
 */
export async function decide(
  item: { kind: ReviewKind; id: number },
  action: DecideVerb,
  orgId: string,
  opts?: {
    reason?: string;
    reviewedBy?: string;
    editedInput?: Record<string, unknown>;
    /** Where the outcome lives, on `done` — the merged PR, the deployment, the post. */
    resultUrl?: string;
    /** Reviewer's note for the agent — stored on the assignment, the triage signal, and the learning capture. */
    note?: string;
    /**
     * Whether this decision may train the proposing agent (default true).
     * An automated caller, a sweep that rejects every past-dated proposal
     * with one canned reason, passes `false`, so machine text never queues
     * as a learning candidate a person then has to read and reject.
     */
    learn?: boolean;
    /**
     * The record the approver just created in its own system. Passed straight
     * to the action, which links its domain row to it. Ignored on reject.
     */
    externalRef?: { system: string; id: string };
  },
): Promise<DecideResult> {
  const reviewedBy = opts?.reviewedBy ?? 'review-service';
  if (action === 'done' && item.kind !== 'action') {
    throw new ReviewDecisionError(`a ${item.kind} run is resumed or cancelled, never marked done by hand`);
  }
  switch (item.kind) {
    case 'workflow':
      action === 'approve'
        ? await resumeWorkflow(item.id, orgId)
        : await cancelWorkflow(item.id, orgId, opts?.reason);
      trackDecision(item, action as 'approve' | 'reject', orgId, reviewedBy);
      return {};
    case 'mission':
      action === 'approve'
        ? await resumeMission(item.id, orgId)
        : await cancelMission(item.id, orgId, opts?.reason);
      trackDecision(item, action as 'approve' | 'reject', orgId, reviewedBy);
      return {};
    case 'action': {
      if (action === 'done') {
        // The hand-off's close. The decision was recorded at approve — the
        // alignment row, the learning signal, the adoption event — so this
        // writes the execution only: who did it, when, and where it is. The
        // note rides the assignment so it reads on the item.
        const outcome = await completeAction(item.id, orgId, {
          by: reviewedBy,
          note: opts?.note ?? opts?.reason,
          resultUrl: opts?.resultUrl,
          externalRef: opts?.externalRef,
        });
        if (opts?.note ?? opts?.reason) {
          await upsertAssignment(orgId, item, { note: (opts.note ?? opts.reason)! }).catch(() => {});
        }
        return { execution: { status: outcome.status, error: outcome.error ?? null } };
      }
      let execution: DecideResult['execution'];
      let labels: Record<string, LabelVerdict> | undefined;
      if (action === 'approve') {
        // BEFORE the write, and only here: `updateActionInput` replaces
        // `input` wholesale and `onProposed` rewrites the object's metadata
        // after it, so this is the last moment the values the proposer wrote
        // still exist anywhere.
        labels = await labelVerdicts(item.id, orgId, opts?.editedInput);
        // Pin what the human actually approved (0112). Written BEFORE the
        // execution, because the artifacts on screen at the moment of the
        // click are what was authorised; a regeneration landing a second
        // later must not be able to rewrite the answer to "what did they
        // approve". Best-effort: a decision must never fail on its audit
        // trail, and a run with no artifacts simply pins nothing.
        await (await import('@/services/personalization/artifacts'))
          .pinLeadArtifactsForRun(orgId, item.id)
          .catch(() => []);
        // The approved copy, filed before the payload it describes is replaced.
        // Same window as `labelVerdicts` above and for the same reason: after
        // `updateActionInput` the input is the approved one and the question
        // "what did this run actually send" has no column that answers it.
        // A reviewer who walked every send finds their own approvals already
        // there; one who clicked straight through gets the record made for
        // them. Best effort — a decision never fails on its audit trail.
        await recordApprovedCopy(item.id, orgId, opts?.editedInput, reviewedBy);
        // Edit-then-approve: if the operator edited the draft in the queue,
        // persist the edited payload FIRST (re-validated in ActionService),
        // so executeAction — which re-reads the row — sends what they see.
        if (opts?.editedInput) {
          // Same "last moment both versions exist" window as labelVerdicts,
          // and the reason this has to live here: `updateActionInput` replaces
          // `input` wholesale, so after the next line the words the agent
          // wrote are gone. The words the reviewer DELETED are the only
          // first-hand evidence about voice this system ever gets; every
          // deletion becomes a proposed rule a person adopts, never an
          // automatic one. Never blocks the approve.
          await recordVoiceEditDiff(item.id, orgId, opts.editedInput, reviewedBy);
          await updateActionInput(item.id, orgId, opts.editedInput);
        }
        const outcome = await executeAction(item.id, orgId, { reviewedBy, externalRef: opts?.externalRef });
        // An approve whose execution failed is NOT a completed decision to the
        // person who clicked it — the outcome rides back so the surface says so.
        execution = { status: outcome.status, error: outcome.error ?? null };
      } else {
        await rejectAction(item.id, orgId, opts?.reason?.trim() || opts?.note, { reviewedBy });
      }
      // The reviewer's note rides every verb: assignment note (visible on the
      // item), triage signal hint, and the learning capture below.
      if (opts?.note) {
        await upsertAssignment(orgId, item, { note: opts.note }).catch(() => {});
      }
      // Typed signal: edit-then-approve is a distinct signal from a clean
      // approve (the operator changed the wording → weaker tone match). The
      // same signal names both the adoption event and the learning job below,
      // so one decision cannot queue itself twice under two polarities.
      const signal: ActionSignal = action === 'approve' ? (opts?.editedInput ? 'edit' : 'approve') : 'reject';
      // The decision is training signal, but only a PROPOSAL of one: it is
      // queued for the feedback classifier and becomes a learning candidate a
      // person adopts, never a rule written into the agent's step behind the
      // reviewer's back. Queued BEFORE the triage signal because both share
      // the (source, externalId) key and the first writer owns the payload,
      // this one carries the proposing agent's own learning step. Never blocks
      // the decision itself, but a failure here is silently lost learning
      // signal, so it is logged rather than swallowed.
      await recordActionDecisionLearning({
        runId: item.id,
        orgId,
        signal,
        // A blank reason must fall through to the note, or the decision path
        // skips and the note still queues via the signal path without a target.
        text: opts?.reason?.trim() || opts?.note,
        reviewedBy,
        learn: opts?.learn,
      }).catch((error) => {
        console.warn(`[ReviewService] could not queue the decision on action run ${item.id} for learning`, error);
      });
      // `learn` rides here too: the note the reviewer typed queues through
      // this path, so an opt-out that only covered the call above would still
      // train the agent whenever a caller sent a note.
      await recordActionSignal({
        orgId,
        runId: item.id,
        userId: reviewedBy,
        signal,
        hint: opts?.note,
        learn: opts?.learn,
        labels,
      }).catch(() => {});
      // The alignment ledger: this decision compared with what the agent
      // recommended, so deciding is also evidence — for the score beside the
      // confidence meter and for the autonomy ladder. A rejection of a run
      // that had already auto-executed demotes its kind from in here.
      await recordActionAlignment({ orgId, runId: item.id, signal, userId: reviewedBy, hasNote: !!(opts?.reason?.trim() || opts?.note?.trim()) }).catch(() => {});
      return { execution };
    }
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

/**
 * The stored `fields` object of an action input, whatever else it carries.
 * @param input - An action payload, stored or edited.
 */
function fieldsOf(input: unknown): Record<string, unknown> {
  const fields = (input as { fields?: unknown } | null | undefined)?.fields;
  return fields && typeof fields === 'object' ? fields as Record<string, unknown> : {};
}

/**
 * One field's value as the comparison sees it: a trimmed string, blank for absent.
 * @param value - The stored or edited field value.
 */
function labelText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/**
 * What a reviewer did to the labels a proposal declared, read at decide time.
 *
 * Called BEFORE `updateActionInput`, which replaces `input` wholesale, so the
 * proposed values are still there to compare against. A proposal that declared
 * nothing is measured not at all, which is what keeps this free for every
 * caller that has never heard of a label.
 * @param runId - The action run being decided.
 * @param orgId - Org that owns it.
 * @param editedInput - The payload the reviewer is approving, when they edited one.
 */
async function labelVerdicts(
  runId: number,
  orgId: string,
  editedInput: Record<string, unknown> | undefined,
): Promise<Record<string, LabelVerdict> | undefined> {
  const [run] = await db
    .select({ input: actionRunSchema.input, proposal: actionRunSchema.proposal })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
    .limit(1);
  const declared = run?.proposal?.labels;
  if (!Array.isArray(declared) || declared.length === 0) {
    return undefined;
  }

  const before = fieldsOf(run?.input);
  // A plain approve is a decision about the labels too: the reviewer looked at
  // them and left them alone, which is the strongest "kept" there is.
  const after = editedInput ? fieldsOf(editedInput) : before;

  const verdicts: Record<string, LabelVerdict> = {};
  for (const name of declared) {
    if (typeof name !== 'string' || name === '') {
      continue;
    }
    if (editedInput && !(name in after)) {
      // Omission is not a clear: a reviewer clearing a label sends it as '',
      // and a payload that never mentions the field was not edited on it.
      continue;
    }
    const was = labelText(before[name]);
    const now = labelText(after[name]);
    if (was === now) {
      verdicts[name] = 'kept';
    } else if (was === '') {
      verdicts[name] = 'added';
    } else if (now === '') {
      verdicts[name] = 'cleared';
    } else {
      verdicts[name] = 'changed';
    }
  }
  return Object.keys(verdicts).length > 0 ? verdicts : undefined;
}

/** Every distinct triage decision on an agent-suggested action. */
export type ActionSignal = 'approve' | 'edit' | 'reject' | 'skip' | 'save' | 'rewrite' | 'regenerate';

const SIGNAL_TO_DECISION = {
  approve: 'approved',
  edit: 'edited',
  reject: 'rejected',
  skip: 'skipped',
  save: 'saved',
  rewrite: 'rewritten',
  regenerate: 'regenerated',
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
 * @param opts.learn - `false` from an automated caller; measured as always, but trains nothing.
 * @param opts.labels - Per-field verdicts on the labels the proposal declared, read before the edit was written.
 */
export async function recordActionSignal(opts: { orgId: string; runId: number; signal: ActionSignal; userId?: string; hint?: string; learn?: boolean; labels?: Record<string, LabelVerdict> }): Promise<void> {
  try {
    const [run] = await db
      .select({
        invokedBy: actionRunSchema.invokedBy,
        actionId: actionRunSchema.actionId,
        proposal: actionRunSchema.proposal,
      })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1);
    // An in-process agent turn stamps `agent:<slug>` on invokedBy. A proposal
    // made over the API stamps the caller there instead and puts the agent in
    // the proposal envelope, so both have to be read.
    const agentSlug = run?.invokedBy?.startsWith('agent:')
      ? run.invokedBy.slice('agent:'.length)
      : run?.proposal?.agentSlug ?? undefined;
    const suggestedDecision = parseSuggestedDecision(run?.proposal?.suggestedDecision);
    const suggestedDecisionReason = parseSuggestedDecisionReason(run?.proposal?.suggestedDecisionReason);
    const { track } = await import('@/services/adoption/track');
    // Scope dimensions travel together: userId (individual) + orgId (workspace)
    // on the actor, actionId (action type) in meta.
    await track({ orgId: opts.orgId, userId: opts.userId ?? 'web' }, 'review.decided', {
      agentSlug,
      resource: ['action_run', opts.runId],
      meta: {
        kind: 'action',
        decision: SIGNAL_TO_DECISION[opts.signal],
        ...(run?.actionId ? { actionId: run.actionId } : {}),
        // The recommendation the reviewer was looking at, so agreement can be
        // read off the event stream without joining back to a run whose
        // envelope may since have been refreshed.
        //
        // The second of two places that write this onto `review.decided` —
        // `adoption/attribution.ts`'s `trackReviewDecision` is the other, and
        // it serves the workflow and mission planes. Actions come through here
        // instead because the typed triage signal (edit, rewrite, skip …) has
        // no home there. Keep the two in step.
        //
        // `labels` below is deliberately NOT mirrored over there, and that is
        // the one asymmetry between them: only an action carries a proposal
        // envelope to declare labels on, and only the action path re-reads the
        // row before the edit is written, which is what the verdicts are read
        // from. A workflow or mission that ever gains a labelled payload needs
        // that read first, not a copy of this key.
        ...(suggestedDecision ? { suggestedDecision } : {}),
        // Travels with the recommendation it explains, for the same reason:
        // read back later, a percentage says the agent disagreed with people
        // and this says what it was thinking when it did.
        ...(suggestedDecisionReason ? { suggestedDecisionReason } : {}),
        ...(opts.labels && Object.keys(opts.labels).length > 0 ? { labels: opts.labels } : {}),
        ...(opts.hint ? { hint: opts.hint } : {}),
      },
    });
    await queueSignalForLearning(opts, agentSlug);
  } catch {
    /* signal capture never blocks the decision */
  }
}

/** Which signals mean "the agent got this wrong" vs "the agent got this right". */
const SIGNAL_POLARITY = {
  approve: 'reinforce',
  save: 'reinforce',
  edit: 'correct',
  reject: 'correct',
  rewrite: 'correct',
  // Distinct from `rewrite` so the adoption metrics can tell a tone touch-up
  // from a full re-do; both mean "change this".
  regenerate: 'correct',
  skip: null,
} as const;

/**
 * Queue a triage signal for the feedback classifier, so a reaction to an
 * agent's proposal can become a learning candidate.
 *
 * Two rules decide whether anything is queued:
 *
 * - **There has to be text.** A bare click says the reviewer disagreed but not
 *   what the agent should do differently, and asking a model to invent the
 *   reason produces rules nobody stated. The signal is still counted in the
 *   adoption metrics either way — this only governs whether a rule can be
 *   proposed from it.
 * - **`skip` never queues.** Skipping leaves the item pending; the reviewer has
 *   not judged it yet.
 * - **`learn: false` never queues.** An automated caller deciding in bulk with
 *   one canned reason is not a reviewer teaching the agent anything. The signal
 *   is still measured, like the two rules above.
 *
 * Idempotent on (run, signal): re-deciding an item does not queue a second job.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.signal
 * @param opts.userId
 * @param opts.hint
 * @param opts.learn - `false` from an automated caller; trains nothing.
 * @param agentSlug - The agent that proposed the action, when known.
 */
async function queueSignalForLearning(
  opts: { orgId: string; runId: number; signal: ActionSignal; userId?: string; hint?: string; learn?: boolean },
  agentSlug: string | undefined,
): Promise<void> {
  const polarity = SIGNAL_POLARITY[opts.signal];
  const note = opts.hint?.trim();
  if (opts.learn === false || !polarity || !note) {
    return;
  }
  try {
    const { enqueue } = await import('@/services/FeedbackWorkerService');
    await enqueue({
      orgId: opts.orgId,
      source: 'review',
      externalId: `action_run:${opts.runId}:${opts.signal}`,
      payload: {
        text: note,
        agentSlug,
        sourceRunId: opts.runId,
        submittedBy: opts.userId,
        polarityHint: polarity,
      },
    });
  } catch (error) {
    console.error(`[ReviewService] could not queue the ${opts.signal} signal on action run ${opts.runId} for learning`, error);
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
 * @param opts.contentId
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
}): Promise<{ input: Record<string, unknown>; body: string; contentId?: string; prior: string; discardedEdit?: string; voiceError?: string }> {
  const [run] = await db
    .select({ input: actionRunSchema.input, actionId: actionRunSchema.actionId, revisions: actionRunSchema.revisions })
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
  const { buildVoicePrompt } = await import('@/libs/writing/voicePrompt');
  const { describeViolations, lintCopy } = await import('@/libs/writing/voiceRules');
  const model = await buildChatModelForOrg('main', opts.orgId, { temperature: 0.4, streaming: false, maxTokens: 1200 });
  // The workspace's voice, not a house style. This used to be one hardcoded
  // sentence of generic advice, which meant every "Add change" quietly threw
  // away the voice guide the rest of the pipeline follows — a rewrite could
  // reintroduce exactly the phrases the drafting pass was told to avoid.
  // Now the rules and the workspace's own voice playbook compose the prompt,
  // and the SAME rules check what comes back.
  const voice = await buildVoicePrompt(opts.orgId);
  const sys = voice.system;
  const user = `${opts.hint ? `Instruction: ${opts.hint}\n\n` : ''}Rewrite this:\n\n${original}`;

  const ask = async (messages: Array<InstanceType<typeof SystemMessage> | InstanceType<typeof HumanMessage>>): Promise<string | null> => {
    try {
      const res = await model.invoke(messages, { signal: AbortSignal.timeout(20_000) });
      // Charged, never refused. A person has already pressed "Add change" and
      // is watching the draft; refusing the rewrite over a cap would leave them
      // with a button that does nothing. Both attempts charge, because both
      // were paid for.
      await chargeModelCall({
        orgId: opts.orgId,
        feature: FEATURES.REVIEW_REWRITE,
        role: 'main',
        response: res,
      });
      const out = typeof res.content === 'string'
        ? res.content
        : (Array.isArray(res.content) ? res.content.map(c => (c as { text?: string }).text ?? '').join('') : '');
      return out.trim() || null;
    } catch (err) {
      logger.warn('rewriteDraft: model call failed', {
        orgId: opts.orgId,
        runId: opts.runId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  let rewritten = original;
  // A rewrite that violates the voice rules is worse than no rewrite: it is
  // the defect the reviewer pressed the button to fix, handed back with a
  // fresh coat of paint. One corrective retry naming the offending phrases,
  // then keep the original and SAY SO — never return tell-laden copy quietly.
  let voiceError: string | undefined;
  const first = await ask([new SystemMessage(sys), new HumanMessage(user)]);
  if (first !== null) {
    const firstLint = lintCopy(first, voice.rules);
    if (firstLint.ok) {
      rewritten = first;
    } else {
      const report = describeViolations(firstLint.violations);
      logger.warn('rewriteDraft: rewrite violated the workspace voice rules — one corrective retry', {
        orgId: opts.orgId,
        runId: opts.runId,
        violations: firstLint.violations.filter(v => v.blocking).map(v => v.span),
      });
      const second = await ask([
        new SystemMessage(sys),
        new HumanMessage(user),
        new HumanMessage(`Your rewrite is rejected. It contains constructions this sender will not have in a send:\n${report}\n\nWrite it again without them. Do not paraphrase a banned phrase back in, and do not replace it with another way of announcing the tone. Return ONLY the rewritten text.`),
      ]);
      const secondLint = second === null ? null : lintCopy(second, voice.rules);
      if (second !== null && secondLint!.ok) {
        rewritten = second;
      } else {
        const failing = secondLint ? describeViolations(secondLint.violations) : report;
        voiceError = `The rewrite kept breaking the workspace's voice rules, so the draft is unchanged:\n${failing}`;
        logger.error('rewriteDraft: rewrite failed the voice gate twice — draft left unchanged', {
          orgId: opts.orgId,
          runId: opts.runId,
          hasVoicePlaybook: voice.hasPlaybook,
        });
      }
    }
  }
  await recordActionSignal({ orgId: opts.orgId, runId: opts.runId, signal: 'rewrite', userId: opts.userId, hint: opts.hint });
  // The audit record of the rewrite. The DRAFT is still untouched (the
  // reviewer carries the copy and passes it back on approve); this records
  // what was asked and what came back so the recap's before/after is readable
  // after the fact. A rewrite that changed nothing records nothing — the
  // recap must never claim a change the reviewer never got. A rewrite always
  // regenerates from the stored draft, so a prior revision on the same
  // content is discarded by it: that body is kept as `discardedEdit` and the
  // caller is told, so the card can say so.
  let discardedEdit: string | undefined;
  if (rewritten.trim() !== original.trim()) {
    const existing = run.revisions ?? [];
    const priorForContent = revisionsFor(existing, opts.contentId);
    discardedEdit = priorForContent.length > 0 ? priorForContent[priorForContent.length - 1]!.body : undefined;
    await db
      .update(actionRunSchema)
      .set({
        revisions: [...existing, {
          ...(opts.contentId ? { contentId: opts.contentId } : {}),
          ...(targetStep !== null ? { step: targetStep } : {}),
          version: nextRevisionVersion(existing, opts.contentId, 'regenerated'),
          body: rewritten,
          ...(opts.hint ? { ask: opts.hint } : {}),
          ...(discardedEdit !== undefined ? { discardedEdit } : {}),
          at: new Date().toISOString(),
          ...(opts.userId ? { by: opts.userId } : {}),
          kind: 'regenerated' as const,
        }],
      })
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)));
  }
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
      prior: original,
      ...(discardedEdit !== undefined ? { discardedEdit } : {}),
      ...(voiceError !== undefined ? { voiceError } : {}),
    };
  }
  if (input.body === undefined && input.notes === undefined && props.notes !== undefined) {
    return { input: { ...input, properties: { ...props, notes: rewritten } }, body: rewritten, prior: original, ...(discardedEdit !== undefined ? { discardedEdit } : {}), ...(voiceError !== undefined ? { voiceError } : {}) };
  }
  const key = input.body !== undefined ? 'body' : 'notes';
  return { input: { ...input, [key]: rewritten }, body: rewritten, prior: original, ...(discardedEdit !== undefined ? { discardedEdit } : {}), ...(voiceError !== undefined ? { voiceError } : {}) };
}

/**
 * File the copy each content item carried at the moment it was approved.
 *
 * Split out of `decide` the same way `recordVoiceEditDiff` is, and for the
 * same reason: the window it depends on — before `updateActionInput` replaces
 * `input` wholesale — is stated once, and a failure here is swallowed without
 * swallowing anything else. A decision must never fail on its audit trail.
 * @param runId - The action run being approved.
 * @param orgId - The project id.
 * @param editedInput - What the reviewer approved, when they edited it.
 * @param reviewedBy - Who approved it.
 */
async function recordApprovedCopy(
  runId: number,
  orgId: string,
  editedInput: Record<string, unknown> | undefined,
  reviewedBy?: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({ actionId: actionRunSchema.actionId, input: actionRunSchema.input })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
      .limit(1);
    if (!row) {
      return;
    }
    const { recordApprovedRevisions } = await import('@/services/review/contentRecord');
    await recordApprovedRevisions({
      orgId,
      runId,
      actionId: row.actionId,
      approvedInput: editedInput ?? row.input,
      ...(reviewedBy ? { by: reviewedBy } : {}),
    });
  } catch (err) {
    logger.warn('could not record the approved revisions', { runId, orgId, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Read the pre-edit copy and file the reviewer's deletions as proposed voice
 * rules. Split out of `decide` so the window it depends on — before
 * `updateActionInput` — is stated once, in one place, and so a failure here
 * can be swallowed without swallowing anything else.
 * @param runId - The action run being approved.
 * @param orgId - The project id.
 * @param editedInput - What the reviewer approved.
 * @param reviewedBy - Who approved it.
 */
async function recordVoiceEditDiff(
  runId: number,
  orgId: string,
  editedInput: Record<string, unknown>,
  reviewedBy?: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({ input: actionRunSchema.input, proposal: actionRunSchema.proposal, invokedBy: actionRunSchema.invokedBy })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
      .limit(1);
    if (!row) {
      return;
    }
    const agentSlug = row.proposal?.agentSlug
      ?? (row.invokedBy?.startsWith('agent:') ? row.invokedBy.slice(6) : undefined);
    const { recordVoiceEdits } = await import('@/services/feedback/voiceLearning');
    await recordVoiceEdits({
      orgId,
      runId,
      before: (row.input ?? {}) as Record<string, unknown>,
      after: editedInput,
      userId: reviewedBy,
      agentSlug,
    });
  } catch (error) {
    logger.warn('could not read the edit diff for voice learning', {
      orgId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Learning step a proposal trains when its agent declares no `learningSteps` of its own. */
const FALLBACK_LEARNING_STEP = 'crm-updates';

/**
 * Which learning step a proposing agent's decision-training candidate gets
 * queued against. Reads the agent's own `learningSteps` (workspace-authored, see
 * `agentSchema.learningSteps` in models/Schema.ts) and takes the first one
 * declared, so an agent outside the CRM domain (an event-ingestion agent
 * proposing calendar candidates, say) trains its own bucket instead of one
 * a different domain's agents read. Falls back to {@link FALLBACK_LEARNING_STEP}
 * only when the agent declares no steps at all, and warns when it does —
 * a workspace missing that declaration is either mid-migration or an agent
 * that was never given one.
 * @param orgId
 * @param agentSlug
 */
async function resolveLearningStepForAgent(orgId: string, agentSlug: string): Promise<string> {
  const { getAgent } = await import('./AgentService');
  const agent = await getAgent(orgId, agentSlug);
  const declaredSteps = agent?.learningSteps ?? [];
  if (declaredSteps.length > 0) {
    return declaredSteps[0]!;
  }
  console.warn(`[ReviewService] agent "${agentSlug}" declares no learningSteps; queueing its decision-training candidate against the fallback step "${FALLBACK_LEARNING_STEP}"`);
  return FALLBACK_LEARNING_STEP;
}

/**
 * Approve/reject on a proposed action → a QUEUED learning candidate.
 *
 * This is still the capture side of the trust ladder, but what it captures is
 * what the REVIEWER wrote, not a sentence this file composes about the run.
 * It used to write a `learning` row per decision ("do not propose this class
 * again without stronger evidence"), straight into the step the proposing
 * agent reads back every run, so half of a busy step was machine commentary
 * on individual runs, phrased as standing policy. Now the reviewer's own words
 * go on the feedback queue, the classifier proposes rule text from them, and a
 * person adopts the candidate before any agent sees it.
 *
 * Two gates, both deliberate: there has to be human text (a bare click says
 * the reviewer disagreed but not what to do differently, and asking a model to
 * invent the reason produces rules nobody stated), and the proposal has to be
 * an agent's own, a human-proposed action trains nobody.
 * @param opts
 * @param opts.runId - The action run being decided.
 * @param opts.orgId - The workspace the run belongs to.
 * @param opts.signal - The triage signal this decision recorded; its polarity rides along.
 * @param opts.text - What the reviewer wrote: the decision reason, or their note for the agent.
 * @param opts.reviewedBy - Who decided, so the resulting rule can name its evidence.
 * @param opts.learn - `false` from an automated caller that must not train anything.
 */
async function recordActionDecisionLearning(opts: {
  runId: number;
  orgId: string;
  signal: ActionSignal;
  text?: string;
  reviewedBy: string;
  learn?: boolean;
}): Promise<void> {
  const note = opts.text?.trim();
  const polarity = SIGNAL_POLARITY[opts.signal];
  if (opts.learn === false) {
    return;
  }
  const [run] = await db
    .select({ invokedBy: actionRunSchema.invokedBy, actionId: actionRunSchema.actionId, proposal: actionRunSchema.proposal })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
    .limit(1);
  if (!run || !run.invokedBy?.startsWith('agent:')) {
    return; // only agent proposals train agents
  }
  const agentSlug = run.invokedBy.slice('agent:'.length);

  // Every judged decision leaves an EPISODE — raw, TTL'd material the
  // consolidation job mines (a confident-but-rejected proposal is exactly
  // where the next learning candidate hides). Unlike the feedback queue
  // below, episodes need no human text: the decision itself is the outcome.
  // Fire-and-forget; never read as instructions.
  void (async () => {
    const { recordEpisode } = await import('@/services/MemoryService');
    const confidence = (run.proposal as { confidence?: number } | null)?.confidence;
    await recordEpisode({
      orgId: opts.orgId,
      runKind: 'action_run',
      runId: opts.runId,
      agentSlug,
      text: [
        `${opts.signal.toUpperCase()}${typeof confidence === 'number' ? ` (confidence ${confidence})` : ''}: ${run.actionId} proposed by ${agentSlug}.`,
        note ? `Reviewer (${opts.reviewedBy}): ${note}` : `Decided by ${opts.reviewedBy} with no note.`,
      ].join(' '),
    });
  })().catch((error) => {
    console.error(`[ReviewService] could not record an episode for action run ${opts.runId}`, error);
  });

  if (!note || !polarity) {
    return;
  }
  // Resolved here rather than left to the worker: without a target the
  // recorder falls back to the org's FIRST learning step by id, which in a
  // workspace running more than one domain is somebody else's bucket.
  const targetSlug = await resolveLearningStepForAgent(opts.orgId, agentSlug);
  const { enqueue } = await import('@/services/FeedbackWorkerService');
  await enqueue({
    orgId: opts.orgId,
    source: 'review',
    // The same key {@link queueSignalForLearning} uses, so a decision carrying
    // both a reason and a note is ONE job instead of two near-identical
    // classifier calls the duplicate judge then has to reconcile.
    externalId: `action_run:${opts.runId}:${opts.signal}`,
    payload: {
      text: note,
      targetSlug,
      agentSlug,
      sourceRunId: opts.runId,
      submittedBy: opts.reviewedBy,
      polarityHint: polarity,
    },
  });
}
