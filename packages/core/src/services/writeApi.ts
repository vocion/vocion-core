/**
 * Write-API service layer — the **control plane** over HTTP.
 *
 * Every `/api/v1` endpoint accepts either a tenant API token
 * (`Authorization: Bearer vcn_live_…`) or a signed-in dashboard session. Both
 * arrive here as one {@link ApiCaller}, and every mutation runs the same path —
 * authz `enforce` → the owning service — so an API call is governed by the
 * exact permission model and review queue as a click in the dashboard.
 *
 * The rule this module exists to keep: **anything the review UI can do, an API
 * client can do.** Each function below is the HTTP twin of an operation the
 * dashboard reaches over its internal oRPC client.
 *
 * This module is intentionally framework-free (no `next/server`): the Next
 * route handlers are thin wrappers that map `WriteApiError` → an HTTP body.
 */

import type { Principal } from '@/services/authz';
import type { PendingPage, ReviewDetail, ReviewItem, ReviewKind } from '@/services/ReviewService';
import { authenticateBearer } from '@/services/ApiTokenService';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { emitEvent } from '@/services/EventService';
import * as ReviewService from '@/services/ReviewService';

/**
 * Who is making this call, however they authenticated.
 *
 * `actorId` is what gets stamped on the record — `token:<id>` for an API token,
 * the user id for a session — so an audit trail says which credential acted.
 */
export type ApiCaller = {
  orgId: string;
  actorId: string;
  principal: Principal;
  source: 'token' | 'session';
};

/** A write-API failure with the HTTP status + error code the route should emit. */
export class WriteApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'WriteApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Resolve an `Authorization: Bearer …` header to a caller, or throw
 * `WriteApiError(401)`.
 * @param authHeader
 */
export async function callerFromBearer(authHeader: string | null | undefined): Promise<ApiCaller> {
  const identity = await authenticateBearer(authHeader);
  if (!identity) {
    throw new WriteApiError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
  }
  return {
    orgId: identity.orgId,
    actorId: `token:${identity.tokenId}`,
    principal: identity.principal,
    source: 'token',
  };
}

const REVIEW_KINDS: ReviewKind[] = ['workflow', 'mission', 'action'];

function assertKind(kind: unknown): asserts kind is ReviewKind {
  if (!REVIEW_KINDS.includes(kind as ReviewKind)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'kind must be one of workflow|mission|action');
  }
}

function assertId(id: unknown): asserts id is number {
  if (!Number.isInteger(id)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'id must be an integer');
  }
}

/**
 * Deciding, routing, snoozing and triaging a review are all the same
 * capability: `approve`. Owners, PMs and client-reviewers hold it; specialists
 * don't.
 * @param caller
 * @param what - What the caller was trying to do, for the error message.
 */
function enforceQueueCapability(caller: ApiCaller, what: string): void {
  try {
    enforce(caller.principal, { kind: 'action', action: 'approve', scope: { orgId: caller.orgId } }, 'mutate');
  } catch (e) {
    if (e instanceof AuthzDeniedError) {
      throw new WriteApiError(403, 'FORBIDDEN', `Not allowed to ${what}: ${e.decision.reason}`);
    }
    throw e;
  }
}

export type ListReviewsInput = {
  /** A user id for a per-person queue, or the literal `"unassigned"` for the triage queue. */
  assignedTo?: string;
  kind?: string;
  includeSnoozed?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * The unified pending-review queue for the caller's org, as one page.
 * @param caller
 * @param opts
 */
export async function apiListReviews(caller: ApiCaller, opts: ListReviewsInput = {}): Promise<PendingPage> {
  if (opts.kind !== undefined) {
    assertKind(opts.kind);
  }
  return ReviewService.listPendingPage(caller.orgId, {
    assignedTo: opts.assignedTo === undefined
      ? undefined
      : (opts.assignedTo === 'unassigned' ? null : opts.assignedTo),
    kind: opts.kind as ReviewKind | undefined,
    includeSnoozed: opts.includeSnoozed,
    limit: opts.limit,
    offset: opts.offset,
  });
}

/**
 * One queue item in full — proposed input, confidence envelope, and the
 * action's own review card. Throws 404 when the org does not own the item.
 * @param caller
 * @param kind
 * @param id
 */
export async function apiGetReview(caller: ApiCaller, kind: unknown, id: unknown): Promise<ReviewDetail> {
  assertKind(kind);
  assertId(id);
  const detail = await ReviewService.getReviewDetail(caller.orgId, kind, id);
  if (!detail) {
    throw new WriteApiError(404, 'NOT_FOUND', `No ${kind} review found with id ${id}`);
  }
  return detail;
}

/**
 * Proposals the confidence gate executed without a human — the trust-ladder
 * audit list. A read, so any valid credential for the org may see it.
 * @param caller
 * @param opts
 * @param opts.limit
 * @param opts.offset
 */
export async function apiListAutoExecuted(caller: ApiCaller, opts: { limit?: number; offset?: number } = {}) {
  return ReviewService.listAutoExecuted(caller.orgId, opts);
}

export type DecideInput = {
  kind: ReviewKind;
  id: number;
  action: 'approve' | 'reject';
  reason?: string;
  /**
   * Corrected payload for edit-then-approve. Only applied on `approve`. On a
   * workflow this is the input the run resumes with.
   */
  editedInput?: Record<string, unknown>;
};

/**
 * Approve or reject a queued item. Returns the refreshed queue so a caller's
 * inbox stays in sync without a second request.
 * @param caller
 * @param input
 */
export async function apiDecideReview(
  caller: ApiCaller,
  input: DecideInput,
): Promise<{ ok: true; reviews: ReviewItem[] }> {
  assertKind(input.kind);
  assertId(input.id);
  if (input.action !== 'approve' && input.action !== 'reject') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'action must be "approve" or "reject"');
  }
  enforceQueueCapability(caller, 'decide reviews');

  await ReviewService.decide(
    { kind: input.kind, id: input.id },
    input.action,
    caller.orgId,
    {
      reason: input.reason,
      reviewedBy: caller.actorId,
      editedInput: input.action === 'approve' ? input.editedInput : undefined,
    },
  );

  const reviews = await ReviewService.listPending(caller.orgId);
  return { ok: true, reviews };
}

export type AssignInput = { kind: ReviewKind; id: number; assignedTo: string | null; note?: string };

/**
 * Route a queue item to a user (or `null` to unassign). Returns the refreshed
 * queue.
 * @param caller
 * @param input
 */
export async function apiAssignReview(
  caller: ApiCaller,
  input: AssignInput,
): Promise<{ ok: true; reviews: ReviewItem[] }> {
  assertKind(input.kind);
  assertId(input.id);
  enforceQueueCapability(caller, 'manage the queue');

  try {
    await ReviewService.assign(caller.orgId, { kind: input.kind, id: input.id }, {
      assignedTo: input.assignedTo,
      assignedBy: caller.actorId,
      note: input.note,
    });
  } catch (error) {
    if (error instanceof ReviewService.UnknownAssigneeError) {
      throw new WriteApiError(400, 'VALIDATION_FAILED', error.message);
    }
    throw error;
  }

  const reviews = await ReviewService.listPending(caller.orgId);
  return { ok: true, reviews };
}

export type SnoozeInput = { kind: ReviewKind; id: number; until: string };

/**
 * Snooze ("delay") a queue item until an ISO timestamp — hidden from the active
 * queue meanwhile. Returns the refreshed queue.
 * @param caller
 * @param input
 */
export async function apiSnoozeReview(
  caller: ApiCaller,
  input: SnoozeInput,
): Promise<{ ok: true; reviews: ReviewItem[] }> {
  assertKind(input.kind);
  assertId(input.id);
  const until = new Date(input.until);
  if (Number.isNaN(until.getTime())) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'until must be an ISO timestamp');
  }
  enforceQueueCapability(caller, 'manage the queue');

  await ReviewService.snooze(caller.orgId, { kind: input.kind, id: input.id }, until, caller.actorId);

  const reviews = await ReviewService.listPending(caller.orgId);
  return { ok: true, reviews };
}

const ACTION_SIGNALS: ReviewService.ActionSignal[] = ['approve', 'edit', 'reject', 'skip', 'save', 'rewrite'];

export type SignalInput = { id: number; signal: string; hint?: string };

/**
 * Record a triage signal on a pending action — the API twin of the dashboard's
 * Skip and Save-for-later buttons. Queue state is untouched; only the adoption
 * signal is written, which is what the trust ladder learns from.
 * @param caller
 * @param input
 */
export async function apiRecordSignal(caller: ApiCaller, input: SignalInput): Promise<{ ok: true }> {
  assertId(input.id);
  if (!ACTION_SIGNALS.includes(input.signal as ReviewService.ActionSignal)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', `signal must be one of ${ACTION_SIGNALS.join('|')}`);
  }
  enforceQueueCapability(caller, 'triage the queue');

  await ReviewService.recordActionSignal({
    orgId: caller.orgId,
    runId: input.id,
    signal: input.signal as ReviewService.ActionSignal,
    userId: caller.actorId,
    hint: input.hint,
  });
  return { ok: true };
}

export type RewriteInput = { id: number; hint?: string };

/**
 * Ask the model to rewrite a pending draft. The rewrite is **not** saved — the
 * caller decides whether to send it back through `apiDecideReview` as
 * `editedInput`. Mirrors the dashboard's Rewrite button.
 * @param caller
 * @param input
 */
export async function apiRewriteDraft(
  caller: ApiCaller,
  input: RewriteInput,
): Promise<{ input: Record<string, unknown>; body: string }> {
  assertId(input.id);
  enforceQueueCapability(caller, 'rewrite a draft');

  return ReviewService.rewriteDraft({
    orgId: caller.orgId,
    runId: input.id,
    hint: input.hint,
    userId: caller.actorId,
  });
}

export type ProposeInput = {
  actionId: string;
  input: Record<string, unknown>;
  agentSlug?: string;
  rationale?: string;
  confidence?: number;
  dedupKey?: string;
  expiresInDays?: number;
};

const MAX_PROPOSAL_LIFETIME_DAYS = 90;
const DAY_IN_MS = 86_400_000;

/**
 * Put a proposed action into the review queue.
 *
 * The proposal carries an **agent** principal, not the caller's own, exactly as
 * the dashboard's "prepare for review" button does. That is deliberate: the
 * write then rides the normal autonomy gate and lands `pending`, so proposing
 * through the API can never fire an action outright.
 * @param caller
 * @param input
 */
export async function apiProposeReview(caller: ApiCaller, input: ProposeInput) {
  if (!input.actionId || typeof input.actionId !== 'string') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'actionId is required');
  }
  if (!input.input || typeof input.input !== 'object') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'input must be an object');
  }
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'confidence must be between 0 and 1');
  }
  if (input.expiresInDays !== undefined && (input.expiresInDays <= 0 || input.expiresInDays > MAX_PROPOSAL_LIFETIME_DAYS)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', `expiresInDays must be between 1 and ${MAX_PROPOSAL_LIFETIME_DAYS}`);
  }
  enforceQueueCapability(caller, 'propose a review item');

  const { proposeAction } = await import('@/services/ActionService');
  const agentId = input.agentSlug ? `agent:${input.agentSlug}` : 'agent:unknown';
  try {
    return await proposeAction({
      orgId: caller.orgId,
      actionId: input.actionId,
      input: input.input,
      principal: { kind: 'agent', id: agentId, scope: { orgId: caller.orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: caller.actorId,
      proposal: { confidence: input.confidence, rationale: input.rationale },
      dedupKey: input.dedupKey,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_IN_MS) : undefined,
    });
  } catch (error) {
    // An unknown action or a payload the action's schema rejects is the
    // caller's mistake, not a server fault — say so with a 400.
    console.error(`[writeApi] proposeAction("${input.actionId}") failed`, error);
    throw new WriteApiError(400, 'VALIDATION_FAILED', error instanceof Error ? error.message : 'Could not propose that action');
  }
}

export type EmitEventApiInput = { type: string; payload?: Record<string, unknown>; dedupeKey?: string };

/**
 * Emit an inbound event — the trigger runner fans it out to the workflows
 * subscribed to that type. Any valid credential for the org may emit (the
 * workflows it starts gate their own actions). Returns what was triggered.
 * @param caller
 * @param input
 */
export async function apiEmitEvent(
  caller: ApiCaller,
  input: EmitEventApiInput,
): Promise<{ ok: true; eventId: number | null; deduped: boolean; triggered: Array<{ slug: string; runId: number }> }> {
  if (!input.type || typeof input.type !== 'string') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'type is required');
  }
  const result = await emitEvent({
    orgId: caller.orgId,
    type: input.type,
    payload: input.payload ?? {},
    dedupeKey: input.dedupeKey,
    invokedBy: caller.actorId,
  });
  return { ok: true, ...result };
}
