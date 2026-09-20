import type { WorkflowRunSummary } from '@/services/WorkflowService';
import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';
import { logger } from '@/libs/Logger';
import { trackReviewDecision } from '@/services/adoption/attribution';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  submitWorkflowRunFeedback,
  WorkflowRunNotResumableError,
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

/**
 * Pending action proposals (the sweep's CRM updates) with confidence
 * envelopes, optionally narrowed to one or more card types.
 *
 * `actionIds` is pushed into the WHERE clause, so a filtered feed draws its
 * whole window from the matching rows: production holds 557 pending items
 * against a window of 50, and the 46 `personalization.enroll` cards the
 * personalization lane exists to produce were reachable only by luck of
 * ordering. `total` is the count of matching rows regardless of the window, so
 * a filtered queue can say how much work it holds.
 */
export const listPendingActionsRoute = os
  .input(z.object({
    actionIds: z.array(z.string().min(1)).max(50).optional(),
    limit: z.number().int().positive().max(200).optional(),
    /** Rows to skip, so the Up-next rail can grow the loaded queue a page at a time. */
    offset: z.number().int().nonnegative().optional(),
  }).optional())
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { db } = await import('@/libs/DB');
    const { actionRunSchema, reviewAssignmentSchema } = await import('@/models/Schema');
    const { and, desc, eq, gt, inArray, isNull, lte, or, sql } = await import('drizzle-orm');
    const { getAction } = await import('@/libs/actions/registry');
    const now = new Date();
    const actionIds = input?.actionIds;
    const where = and(
      eq(actionRunSchema.orgId, orgId),
      // Failed runs stay in the queue: the approval stood, the execution
      // threw, and a card that silently vanishes on failure hides exactly the
      // work that needs a human (retry is just approve again — executeAction
      // accepts a failed run). A failed enrollment sat invisible for three
      // days before this.
      inArray(actionRunSchema.status, ['pending', 'failed']),
      // Drop stale suggestions — expired items fall out of the queue.
      or(isNull(actionRunSchema.expiresAt), gt(actionRunSchema.expiresAt, now)),
      // Snoozed items are hidden until their date, then resurface — the same
      // predicate ReviewService.routingFilters applies, on every surface that
      // consumes this feed.
      or(isNull(reviewAssignmentSchema.snoozedUntil), lte(reviewAssignmentSchema.snoozedUntil, now)),
      // An empty array is "nothing of that type", never "everything".
      ...(actionIds ? [inArray(actionRunSchema.actionId, actionIds.length > 0 ? actionIds : [''])] : []),
    );
    const assignment = and(
      eq(reviewAssignmentSchema.orgId, orgId),
      eq(reviewAssignmentSchema.kind, 'action'),
      eq(reviewAssignmentSchema.runId, actionRunSchema.id),
    );
    const [rows, [counted]] = await Promise.all([
      db
        .select({ run: actionRunSchema })
        .from(actionRunSchema)
        .leftJoin(reviewAssignmentSchema, assignment)
        .where(where)
        // id breaks ties, so two rows created in the same tick keep a stable
        // order across pages and never repeat or vanish between them.
        .orderBy(desc(actionRunSchema.createdAt), desc(actionRunSchema.id))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(actionRunSchema)
        .leftJoin(reviewAssignmentSchema, assignment)
        .where(where),
    ]);
    // The alignment score beside the confidence meter: how often this agent's
    // recommendations of this kind matched what the person did (30d). One
    // scan for the whole page; a run with no agent reads the kind's score.
    const { agentKeyOf, scoresByAgentAndKey } = await import('@/services/alignment/AlignmentService');
    const alignment = await scoresByAgentAndKey(orgId, '30d', now, 'action').catch(() => new Map());
    const alignmentFor = (row: { actionId: string; invokedBy: string | null; proposal: { agentSlug?: string } | null }) => {
      const agentSlug = row.invokedBy?.startsWith('agent:') ? row.invokedBy.slice('agent:'.length) : row.proposal?.agentSlug ?? null;
      return alignment.get(agentKeyOf(agentSlug, row.actionId)) ?? alignment.get(agentKeyOf(null, row.actionId)) ?? null;
    };
    // Structured cards: an action that defines one presents itself consistently
    // everywhere the queue renders. Best-effort — a presenter error falls back
    // to the generic card, never blocks the queue. `canRegenerate` is stamped
    // here from the action's declared capability, never by the presenter.
    const items = await Promise.all(rows.map(async ({ run: raw }) => {
      const row = { ...raw, alignment: alignmentFor(raw) };
      const action = getAction(row.actionId);
      const presenter = action?.reviewCard;
      if (!presenter) {
        return row;
      }
      const card = await presenter({ orgId }, row.input).catch(() => undefined);
      return card ? { ...row, card: { ...card, canRegenerate: action?.regenerate !== undefined } } : row;
    }));
    return { items, total: Number(counted?.n ?? 0) };
  });

/**
 * The card types pending for this org, each with its real count and its
 * registered display name.
 *
 * Driven by what is present, so a newly registered action type appears as a
 * chip with no UI change.
 */
export const listPendingActionTypesRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { pendingActionTypes } = await import('@/services/ReviewService');
  return pendingActionTypes(orgId);
});

/** Recently auto-executed proposals (trust-ladder audit surface). */
export const listAutoExecutedRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  // Delegates rather than repeating the query. This used to filter on
  // `proposal ->> 'autoApproved'` itself, which stopped being the whole answer
  // once `approved_by_agent` became the system of record: two copies of the
  // rule meant this dashboard feed would quietly empty out the day the jsonb
  // key stopped being written, while the REST endpoint kept working.
  const { listAutoExecuted } = await import('@/services/ReviewService');
  const { items } = await listAutoExecuted(orgId, { limit: 20 });
  return items;
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
    /**
     * What the agent thinks the reviewer should do. The question must be
     * answered, like everywhere else a proposal is made, and `null` answers
     * it: nothing judged this card. A caller that recommends nothing must say
     * so rather than omit the key, because a card carrying a recommendation
     * and a card carrying none are measured differently and the difference
     * should be deliberate. Advisory in the other direction — it never
     * releases the action.
     */
    suggestedDecision: z.enum(SUGGESTED_DECISIONS).nullable(),
    /**
     * One short sentence for why that recommendation, required alongside it
     * and null when there is none. Not `rationale` above: that argues the
     * payload is right, this argues what should happen to the card, which is
     * the whole content of a `reject`.
     */
    suggestedDecisionReason: z.string().trim().min(1).nullable(),
    /** Only with `suggestedDecision: 'snooze'` — an ISO timestamp for the revisit. */
    suggestedSnoozeUntil: z.string().optional(),
    /** Upsert key (object type + id + action) — re-surfacing updates in place. */
    dedupKey: z.string().optional(),
    /** Days until this suggestion goes stale (drops from the queue). */
    expiresInDays: z.number().positive().max(90).optional(),
  }).refine(
    value => (value.suggestedDecision === null) === (value.suggestedDecisionReason === null),
    {
      // Half a recommendation is worse than none: a verdict with no sentence
      // is scored against the reviewer's decision with nothing they could
      // check, and a sentence with no verdict argues for an outcome the card
      // never names. The two travel together or neither does.
      error: 'suggestedDecision and suggestedDecisionReason must both be given or both be null',
      path: ['suggestedDecisionReason'],
    },
  ))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { proposeAction } = await import('@/services/ActionService');
    const agentId = input.agentSlug ? `agent:${input.agentSlug}` : 'agent:unknown';
    let res: Awaited<ReturnType<typeof proposeAction>>;
    try {
      res = await proposeAction({
        orgId,
        actionId: input.actionId,
        input: input.input,
        principal: { kind: 'agent', id: agentId, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: userId ?? agentId,
        proposal: {
          confidence: input.confidence,
          rationale: input.rationale,
          suggestedDecision: input.suggestedDecision,
          suggestedDecisionReason: input.suggestedDecisionReason?.trim() ?? null,
          suggestedSnoozeUntil: input.suggestedSnoozeUntil,
        },
        // Explicit key wins; otherwise derive a stable one from the action + its
        // primary target so the same owed action doesn't duplicate in the queue.
        dedupKey: input.dedupKey ?? deriveDedupKey(input.actionId, input.input),
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : undefined,
      });
    } catch (err) {
      // A payload the action refuses is the caller's problem to read, not a 500:
      // the card shows this sentence under its buttons.
      const code = (err as { code?: unknown }).code;
      if (code === 'VALIDATION_FAILED' || code === 'UNKNOWN_ACTION') {
        throw new ORPCError('BAD_REQUEST', { message: (err as Error).message });
      }
      throw err;
    }
    return res;
  });

/** Record a typed triage signal (skip/save/rewrite/edit) from the UI. */
export const recordSignalRoute = os
  .input(z.object({
    runId: z.number().int().positive(),
    signal: z.enum(['approve', 'edit', 'reject', 'skip', 'save', 'rewrite', 'regenerate']),
    hint: z.string().max(300).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { recordActionSignal } = await import('@/services/ReviewService');
    await recordActionSignal({ orgId, runId: input.runId, signal: input.signal, userId: userId ?? undefined, hint: input.hint });
    return { ok: true };
  });

/**
 * Where a run stands, for a surface that must not go stale: still pending, or
 * decided — and if decided, by whom (resolved to a name) and when. A guided
 * review open in one window polls this on focus so a lead decided in another
 * resolves to the outcome instead of offering a decision that no longer exists.
 */
export const actionStatusRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { db } = await import('@/libs/DB');
    const { actionRunSchema, userSchema } = await import('@/models/Schema');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await db
      .select({
        status: actionRunSchema.status,
        decidedBy: actionRunSchema.decidedBy,
        decidedAt: actionRunSchema.decidedAt,
        regeneratingSince: actionRunSchema.regeneratingSince,
        regenerateNote: actionRunSchema.regenerateNote,
        approvedByAgent: actionRunSchema.approvedByAgent,
        actionId: actionRunSchema.actionId,
        proposal: actionRunSchema.proposal,
        name: userSchema.name,
        email: userSchema.email,
      })
      .from(actionRunSchema)
      .leftJoin(userSchema, eq(userSchema.id, actionRunSchema.decidedBy))
      .where(and(eq(actionRunSchema.id, input.id), eq(actionRunSchema.orgId, orgId)))
      .limit(1);
    if (!row) {
      throw ApiError.notFound(`no action ${input.id}`);
    }
    const { getAction } = await import('@/libs/actions/registry');
    return {
      status: row.status,
      decidedBy: row.name ?? row.email ?? row.decidedBy,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      // Done for you: the ladder released it, and the kind can be put back.
      approvedByAgent: row.approvedByAgent === true,
      undoable: row.status === 'done' && getAction(row.actionId)?.undo !== undefined,
      reason: (row.proposal as { autoApprovedReason?: string } | null)?.autoApprovedReason ?? null,
      // The in-flight regeneration stamp, so the card can hold itself
      // disabled on server truth rather than on the click that started it.
      regeneratingSince: row.regeneratingSince?.toISOString() ?? null,
      regenerateNote: row.regenerateNote,
    };
  });

/**
 * The context beside one proposal — the contact, the exchange so far, the
 * sequence — for a surface that decides a run outside the record sheet (the
 * dock's card, a domain console). The record sheet reads the same service
 * server-side.
 */
export const contextRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { reviewRowById } = await import('@/services/inbox/reviewRows');
    const { loadReviewContext } = await import('@/services/inbox/reviewContext');
    const row = await reviewRowById(orgId, input.id);
    if (!row) {
      throw ApiError.notFound(`no action ${input.id}`);
    }
    return loadReviewContext(orgId, row);
  });

/** Rewrite-with-AI on a pending draft — returns the rewrite (unsaved) + records a `rewrite` signal. */
export const rewriteDraftRoute = os
  .input(z.object({
    runId: z.number().int().positive(),
    hint: z.string().max(300).optional(),
    /** Card content id (e.g. `send-2`) when the run holds several pieces. */
    contentId: z.string().max(64).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { rewriteDraft } = await import('@/services/ReviewService');
    return rewriteDraft({ orgId, runId: input.runId, hint: input.hint, contentId: input.contentId, userId: userId ?? undefined });
  });

/**
 * Stable upsert key from an action + its input, so re-proposing the same owed
 * action updates the pending item instead of stacking a duplicate. Keyed on
 * the action's primary target (recipient for a send, object id for a CRM write).
 * @param actionId - The action being proposed.
 * @param input - That action's input payload.
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

/**
 * Put a done run back — the other half of "done for you" (Chris, 2026-09-18).
 * Only a kind that declares `undo` gets here; the button is drawn from the
 * same fact (`actionStatus.undoable`), so the screen never offers what the
 * service would refuse.
 */
export const undoActionRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { undoAction, ActionError } = await import('@/services/ActionService');
    const { recordActionSignal } = await import('@/services/ReviewService');
    try {
      const res = await undoAction(input.id, orgId, { by: userId ?? 'unknown' });
      await recordActionSignal({ orgId, runId: input.id, signal: 'reject', userId: userId ?? undefined, hint: 'undone' });
      return { ok: true, status: res.status };
    } catch (err) {
      if (err instanceof ActionError) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }
  });

/** Approve or reject a pending action proposal; mark a released hand-off done. */
export const decideActionRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    decision: z.enum(['approve', 'reject', 'done']),
    reason: z.string().optional(),
    /** Where the outcome lives, with `done` — the merged PR, the deployment, the post. */
    resultUrl: z.string().url().optional(),
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

    // A run mid-regeneration cannot be decided: an approve would execute the
    // stale copy, and the re-propose landing moments later would duplicate
    // the card. The guard expires with the stamp's staleness window, so a
    // wedged regeneration never locks the run for good.
    {
      const { db } = await import('@/libs/DB');
      const { actionRunSchema } = await import('@/models/Schema');
      const { and, eq } = await import('drizzle-orm');
      const { isRegeneratingFresh } = await import('@/libs/actions/regenerating');
      const [run] = await db
        .select({ regeneratingSince: actionRunSchema.regeneratingSince })
        .from(actionRunSchema)
        .where(and(eq(actionRunSchema.id, input.id), eq(actionRunSchema.orgId, orgId)))
        .limit(1);
      if (run && isRegeneratingFresh(run.regeneratingSince)) {
        throw ApiError.badRequest('This card is being regenerated — it re-enables when the new version lands.');
      }
    }

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

    const { ActionError } = await import('@/services/ActionService');
    let outcome;
    try {
      outcome = await decide({ kind: 'action', id: input.id }, input.decision, orgId, {
        reason: input.reason,
        note: input.note,
        reviewedBy: userId,
        editedInput: input.decision === 'approve' ? editedInput : undefined,
        resultUrl: input.decision === 'done' ? input.resultUrl : undefined,
      });
    } catch (err) {
      // Marking done what was never released, or approving twice, is a state
      // the screen can explain; a stack trace is not.
      if (err instanceof ActionError && err.code === 'INVALID_STATE') {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }
    // The execution outcome rides back so the card can SAY a failed execution
    // failed — approve used to return bare `ok` and a HubSpot 400 was silent.
    return { ok: true, execution: outcome?.execution ?? null };
  });

/**
 * Regenerate a pending action's work, guided by the reviewer's feedback. Only
 * actions that declare the `regenerate` capability accept it; the action owns
 * what regenerating means for its domain (personalization.enroll sends the
 * brief back to be researched and drafted again). The run stays pending — the
 * next pass updates the same queue item through the dedup key — and the
 * feedback is recorded as a `regenerate` learning signal, so the same text
 * improves the very next pass immediately while the learning loop distills
 * the durable rule.
 */
export const regenerateActionRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    /** What should change. Required: a regeneration without instructions is a coin flip. */
    feedback: z.string().trim().min(1).max(2000),
    /**
     * Which content item the instruction is about (`send-3`), so the record
     * lands on the send a reviewer was reading. Absent on a run with a single
     * body, which is every non-sequence action.
     */
    contentId: z.string().min(1).max(200).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { db } = await import('@/libs/DB');
    const { actionRunSchema } = await import('@/models/Schema');
    const { and, eq } = await import('drizzle-orm');
    const { getAction } = await import('@/libs/actions/registry');
    const { isRegeneratingFresh } = await import('@/libs/actions/regenerating');
    const [run] = await db
      .select({
        actionId: actionRunSchema.actionId,
        input: actionRunSchema.input,
        status: actionRunSchema.status,
        regeneratingSince: actionRunSchema.regeneratingSince,
      })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, input.id), eq(actionRunSchema.orgId, orgId)))
      .limit(1);
    // Failed runs regenerate too — the redraft's dedup refresh reclaims them to pending.
    if (!run || (run.status !== 'pending' && run.status !== 'failed')) {
      throw ApiError.notFound(`no regenerable action ${input.id}`);
    }
    const action = getAction(run.actionId);
    if (!action?.regenerate) {
      throw ApiError.badRequest(`${run.actionId} does not support regeneration`);
    }
    // One regeneration at a time: a second click while the stamp is fresh is
    // a double-fire, refused. The stamp expiring on its own means a wedged
    // run costs one staleness window, never the card.
    if (isRegeneratingFresh(run.regeneratingSince)) {
      throw ApiError.badRequest('This card is already regenerating — it re-enables when the new version lands.');
    }

    // The record, BEFORE anything replaces the copy it is about. This is the
    // last moment `input` still holds what the reviewer is looking at: the
    // redraft's dedup refresh replaces `input` wholesale and clears the stamp
    // and the note with it, so a body not filed here is gone for good. Filed
    // with the ask it is about to answer, which is what makes the history
    // read as a conversation rather than as a list of bodies. Best effort: a
    // regeneration must never fail on its audit trail.
    const { recordPreRegenerationCopy } = await import('@/services/review/contentRecord');
    await recordPreRegenerationCopy({
      orgId,
      runId: input.id,
      actionId: run.actionId,
      runInput: run.input,
      ...(input.contentId ? { contentId: input.contentId } : {}),
      ask: input.feedback,
      ...(userId ? { by: userId } : {}),
    }).catch(err => logger.warn('could not record the pre-regeneration copy', { runId: input.id, orgId, error: err instanceof Error ? err.message : String(err) }));

    // Server truth first: every surface reads the stamp, so the card is
    // disabled everywhere before any work runs.
    await db
      .update(actionRunSchema)
      .set({ regeneratingSince: new Date(), regenerateNote: input.feedback })
      .where(eq(actionRunSchema.id, input.id));

    // The work dispatches in the background — the fast path is a model turn
    // and the fallback a whole agent pass; the reviewer's click must not hold
    // the request open for either. A dispatch failure unstamps, so the card
    // re-enables instead of waiting out the staleness window.
    // Scoped to the item the instruction was typed beside, so the action can
    // rewrite THAT send and leave the reviewer's other approvals standing.
    // This argument was missing until 2026-09-20: the record knew which send
    // the ask was about and the work did not, so a note about send 4 redrafted
    // all four and cleared three checks a reviewer had earned.
    const dispatch = action.regenerate(
      { orgId, reviewedBy: userId ?? undefined },
      run.input as never,
      input.id,
      input.feedback,
      input.contentId ? { contentId: input.contentId } : {},
    ).catch(async (err) => {
      logger.warn('regenerate dispatch failed — clearing the stamp', { runId: input.id, orgId, error: err instanceof Error ? err.message : String(err) });
      await db
        .update(actionRunSchema)
        .set({ regeneratingSince: null })
        .where(eq(actionRunSchema.id, input.id))
        .catch(() => {});
    });
    // Next's request context must survive the work: `after` keeps the promise
    // alive past the response without holding the response for it.
    const { after } = await import('next/server');
    after(dispatch);

    // The feedback is a learning signal with the full existing pipeline behind
    // it: feedback job, classifier, duplicate detection, learning candidate.
    const { recordActionSignal } = await import('@/services/ReviewService');
    await recordActionSignal({ orgId, runId: input.id, signal: 'regenerate', userId: userId ?? undefined, hint: input.feedback });
    return { ok: true };
  });

/**
 * A run a per-send approval may be recorded against: still open, and not
 * mid-regeneration. Shared by both checkpoint routes so "which runs take a
 * check" is answered once.
 * @param id - The action run.
 * @param orgId - The project that owns it.
 */
async function guardCheckpointable(id: number, orgId: string): Promise<void> {
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const { and, eq } = await import('drizzle-orm');
  const { isRegeneratingFresh } = await import('@/libs/actions/regenerating');
  const [run] = await db
    .select({ status: actionRunSchema.status, regeneratingSince: actionRunSchema.regeneratingSince })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.id, id), eq(actionRunSchema.orgId, orgId)))
    .limit(1);
  // A decided run is history. Checking a send on it would put a reviewer's
  // name against copy that already ran, or against a card nobody can change.
  if (!run || (run.status !== 'pending' && run.status !== 'failed')) {
    throw ApiError.notFound(`no open action ${id}`);
  }
  if (isRegeneratingFresh(run.regeneratingSince)) {
    throw ApiError.badRequest('This card is being regenerated — it re-enables when the new version lands.');
  }
}

/**
 * Approve ONE content item — a checkpoint, not an execution.
 *
 * Nothing leaves the building here: the run stays pending, `input` is
 * untouched, and Enroll remains the single act that reaches the outside
 * world, so the autonomy gate keeps one door. What this records is that a
 * person read this send and vouched for exactly this copy — a hash of it, so
 * the check clears itself the moment the copy changes underneath.
 */
export const approveContentRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    contentId: z.string().min(1).max(200),
    subject: z.string().max(10_000).optional(),
    body: z.string().max(100_000),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    await guardCheckpointable(input.id, orgId);
    const { recordApprovedContent } = await import('@/services/review/contentRecord');
    const hash = await recordApprovedContent({
      orgId,
      runId: input.id,
      contentId: input.contentId,
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      body: input.body,
      ...(userId ? { by: userId } : {}),
    });
    return { ok: true, hash };
  });

/** Take one content item's check back off. The history it wrote stands. */
export const unapproveContentRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    contentId: z.string().min(1).max(200),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await guardCheckpointable(input.id, orgId);
    const { clearApprovedContent } = await import('@/services/review/contentRecord');
    await clearApprovedContent({ orgId, runId: input.id, contentId: input.contentId });
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
    let run: WorkflowRunSummary;
    try {
      run = await resumeWorkflow(input.id, orgId, input.input !== undefined ? { input: input.input } : undefined);
    } catch (err) {
      if (err instanceof WorkflowRunNotResumableError) {
        // Someone else's click, or a stale page, got there first. The
        // reply deliberately omits the run id and the raw status, so this
        // log line is the only place that detail survives.
        logger.warn('workflow resume lost the claim race or the run moved on', { runId: input.id, orgId, reason: err.message });
        throw new ORPCError('CONFLICT', { message: 'This run is no longer resumable — someone may have already approved it, or it has moved on.' });
      }
      throw err;
    }
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
