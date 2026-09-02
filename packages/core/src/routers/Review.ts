import { os } from '@orpc/server';
import { z } from 'zod';
import { trackReviewDecision } from '@/services/adoption/attribution';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  submitWorkflowRunFeedback,
} from '@/services/WorkflowService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Review Queue routes — list + act on pending action proposals and
 * paused workflow runs. Minimal surface: each route maps 1:1 to a
 * service function so the UI can poll freely without custom
 * aggregation here.
 */

const ListWorkflowRunsInput = z.object({
  status: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
  workflowSlug: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

const RunIdInput = z.object({ id: z.number().int().positive() });
const ResumeInput = z.object({
  id: z.number().int().positive(),
  /** Human-supplied text for a run paused on an `ask` step (`awaiting_input:<step>`). */
  input: z.string().optional(),
});
const CancelInput = z.object({ id: z.number().int().positive(), reason: z.string().optional() });
const FeedbackInput = z.object({
  id: z.number().int().positive(),
  rating: z.enum(['up', 'down']).nullable().optional(),
  note: z.string().optional(),
});

/** Pending action proposals (the sweep's CRM updates) with confidence envelopes. */
export const listPendingActionsRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, reviewAssignmentSchema } = await import('@/models/Schema');
  const { and, desc, eq, gt, isNull, lte, or } = await import('drizzle-orm');
  const { getAction } = await import('@/libs/actions/registry');
  const now = new Date();
  const rows = await db
    .select({ run: actionRunSchema })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, and(
      eq(reviewAssignmentSchema.orgId, orgId),
      eq(reviewAssignmentSchema.kind, 'action'),
      eq(reviewAssignmentSchema.runId, actionRunSchema.id),
    ))
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.status, 'pending'),
      // Drop stale suggestions — expired items fall out of the queue.
      or(isNull(actionRunSchema.expiresAt), gt(actionRunSchema.expiresAt, now)),
      // Snoozed items are hidden until their date, then resurface — the same
      // predicate ReviewService.routingFilters applies, on every surface that
      // consumes this feed.
      or(isNull(reviewAssignmentSchema.snoozedUntil), lte(reviewAssignmentSchema.snoozedUntil, now)),
    ))
    .orderBy(desc(actionRunSchema.createdAt))
    .limit(50);
  // Structured cards: an action that defines one presents itself consistently
  // everywhere the queue renders. Best-effort — a presenter error falls back
  // to the generic card, never blocks the queue.
  return Promise.all(rows.map(async ({ run: row }) => {
    const presenter = getAction(row.actionId)?.reviewCard;
    if (!presenter) {
      return row;
    }
    const card = await presenter({ orgId }, row.input).catch(() => undefined);
    return card ? { ...row, card } : row;
  }));
});

/** Recently auto-executed proposals (trust-ladder audit surface). */
export const listAutoExecutedRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const { and, desc, eq, sql } = await import('drizzle-orm');
  return db
    .select()
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      sql`${actionRunSchema.proposal} ->> 'autoApproved' = 'true'`,
    ))
    .orderBy(desc(actionRunSchema.createdAt))
    .limit(20);
});

/**
 * JIT-create a review item from an A2UI recommended-action card (user tapped
 * "prepare for review" on an agent recommendation). Reuses the AGENT's
 * authority — same principal shape as propose_action — so the write rides the
 * normal gate and lands `pending` for approval (never auto-fires; gmail.send is
 * guarded regardless). Returns the new run id so the UI can link to review.
 */
export const proposeFromRecommendationRoute = os
  .input(z.object({
    actionId: z.string(),
    input: z.record(z.string(), z.unknown()),
    agentSlug: z.string().optional(),
    rationale: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    /** Upsert key (object type + id + action) — re-surfacing updates in place. */
    dedupKey: z.string().optional(),
    /** Days until this suggestion goes stale (drops from the queue). */
    expiresInDays: z.number().positive().max(90).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { proposeAction } = await import('@/services/ActionService');
    const agentId = input.agentSlug ? `agent:${input.agentSlug}` : 'agent:unknown';
    const res = await proposeAction({
      orgId,
      actionId: input.actionId,
      input: input.input,
      principal: { kind: 'agent', id: agentId, scope: { orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: userId ?? agentId,
      proposal: { confidence: input.confidence, rationale: input.rationale },
      // Explicit key wins; otherwise derive a stable one from the action + its
      // primary target so the same owed action doesn't duplicate in the queue.
      dedupKey: input.dedupKey ?? deriveDedupKey(input.actionId, input.input),
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : undefined,
    });
    return res;
  });

/** Record a typed triage signal (skip/save/rewrite/edit) from the UI. */
export const recordSignalRoute = os
  .input(z.object({
    runId: z.number().int().positive(),
    signal: z.enum(['approve', 'edit', 'reject', 'skip', 'save', 'rewrite']),
    hint: z.string().max(300).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { recordActionSignal } = await import('@/services/ReviewService');
    await recordActionSignal({ orgId, runId: input.runId, signal: input.signal, userId: userId ?? undefined, hint: input.hint });
    return { ok: true };
  });

/** Rewrite-with-AI on a pending draft — returns the rewrite (unsaved) + records a `rewrite` signal. */
export const rewriteDraftRoute = os
  .input(z.object({ runId: z.number().int().positive(), hint: z.string().max(300).optional() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { rewriteDraft } = await import('@/services/ReviewService');
    return rewriteDraft({ orgId, runId: input.runId, hint: input.hint, userId: userId ?? undefined });
  });

/**
 * Stable upsert key from an action + its input, so re-proposing the same owed
 * action updates the pending item instead of stacking a duplicate. Keyed on
 * the action's primary target (recipient for a send, object id for a CRM write).
 * @param actionId
 * @param input
 */
function deriveDedupKey(actionId: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined);
  if (actionId === 'gmail.send') {
    const to = s(input.to);
    return to ? `gmail.send:${to}` : undefined;
  }
  const objId = s(input.objectId) ?? s(input.object_id) ?? s(input.recordId) ?? s(input.id);
  return objId ? `${actionId}:${objId}` : undefined;
}

/** Approve or reject a pending action proposal. */
export const decideActionRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    decision: z.enum(['approve', 'reject']),
    reason: z.string().optional(),
    /** Reviewer's note for the agent — stored with the decision on every verb. */
    note: z.string().max(2000).optional(),
    /** Operator-edited payload (edit-then-approve) — only applied on approve. */
    editedInput: z.record(z.string(), z.unknown()).optional(),
    /** Edits to the card's typed content items — mapped back onto the input by the action's own `applyContentEdits`. */
    contentEdits: z.array(z.object({
      id: z.string().min(1),
      subject: z.string().optional(),
      body: z.string().optional(),
    })).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { decide } = await import('@/services/ReviewService');

    // Typed-content edit-then-approve: the ACTION owns the mapping from card
    // content back to its input, so the client never reverse-engineers input
    // shapes. The mapped input is re-validated in ActionService like any edit.
    let editedInput = input.editedInput;
    if (input.decision === 'approve' && input.contentEdits?.length) {
      const { db } = await import('@/libs/DB');
      const { actionRunSchema } = await import('@/models/Schema');
      const { and, eq } = await import('drizzle-orm');
      const { getAction } = await import('@/libs/actions/registry');
      const [run] = await db
        .select({ actionId: actionRunSchema.actionId, input: actionRunSchema.input })
        .from(actionRunSchema)
        .where(and(eq(actionRunSchema.id, input.id), eq(actionRunSchema.orgId, orgId)))
        .limit(1);
      const apply = run ? getAction(run.actionId)?.applyContentEdits : undefined;
      if (run && apply) {
        editedInput = apply({ ...run.input, ...(editedInput ?? {}) }, input.contentEdits) as Record<string, unknown>;
      }
    }

    await decide({ kind: 'action', id: input.id }, input.decision, orgId, {
      reason: input.reason,
      note: input.note,
      reviewedBy: userId,
      editedInput: input.decision === 'approve' ? editedInput : undefined,
    });
    return { ok: true };
  });

/** Snooze a pending action — hidden from every review surface until the date, then it resurfaces. */
export const snoozeActionRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    /** ISO datetime the item resurfaces at. */
    until: z.string().datetime(),
    note: z.string().max(2000).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { snooze } = await import('@/services/ReviewService');
    const until = new Date(input.until);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      throw ApiError.badRequest('`until` must be a future datetime');
    }
    await snooze(orgId, { kind: 'action', id: input.id }, until, userId ?? undefined, { note: input.note });
    return { ok: true, until: until.toISOString() };
  });

export const submitFeedback = os
  .input(FeedbackInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const run = await submitWorkflowRunFeedback({
      orgId,
      runId: input.id,
      submittedBy: userId,
      rating: input.rating,
      note: input.note,
    });
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const listWorkflowRunsRoute = os
  .input(ListWorkflowRunsInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listWorkflowRuns(orgId, {
      status: input.status,
      workflowSlug: input.workflowSlug,
      limit: input.limit,
    });
  });

export const getWorkflowRunRoute = os
  .input(RunIdInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const run = await getWorkflowRun(input.id, orgId);
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const resume = os
  .input(ResumeInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const run = await resumeWorkflow(input.id, orgId, input.input !== undefined ? { input: input.input } : undefined);
    void trackReviewDecision({ orgId, userId }, { kind: 'workflow', id: input.id }, 'approved');
    return run;
  });

export const cancel = os
  .input(CancelInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const run = await cancelWorkflow(input.id, orgId, input.reason);
    void trackReviewDecision({ orgId, userId }, { kind: 'workflow', id: input.id }, 'rejected');
    return run;
  });
