/**
 * Write-API service layer — the **control plane** over HTTP.
 *
 * Read endpoints (`/api/v1/*` GET) authenticate a logged-in browser session.
 * The *write* surface is different: an app or a client integration drives
 * Vocion with a tenant **API token** (`vcn_live_…`). Every write here runs the
 * same path — `authenticateBearer` → authz `enforce` → the owning service — so
 * a token mutation is governed by the exact permission model and review queue
 * as everything else. Authentication and authorization are one path, not two.
 *
 * This module is intentionally framework-free (no `next/server`): the Next
 * route handlers are thin wrappers that map `WriteApiError` → an HTTP body.
 */

import type { TokenIdentity } from '@/services/ApiTokenService';
import type { ReviewItem, ReviewKind } from '@/services/ReviewService';
import { authenticateBearer } from '@/services/ApiTokenService';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { emitEvent } from '@/services/EventService';
import * as ReviewService from '@/services/ReviewService';

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
 * Resolve an `Authorization: Bearer …` header to a token identity, or throw
 * `WriteApiError(401)`. The returned principal carries role + grants + org
 * scope for the authz check.
 * @param authHeader
 */
export async function apiContext(authHeader: string | null | undefined): Promise<TokenIdentity> {
  const identity = await authenticateBearer(authHeader);
  if (!identity) {
    throw new WriteApiError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
  }
  return identity;
}

/**
 * GET the unified pending-review queue for the token's org. Pass `assignedTo`
 * for a per-person queue (a user id, or the literal `"unassigned"`).
 * @param authHeader
 * @param opts
 * @param opts.assignedTo
 */
export async function apiListReviews(
  authHeader: string | null | undefined,
  opts: { assignedTo?: string } = {},
): Promise<{ reviews: ReviewItem[] }> {
  const { orgId } = await apiContext(authHeader);
  const listOpts = opts.assignedTo === undefined
    ? {}
    : { assignedTo: opts.assignedTo === 'unassigned' ? null : opts.assignedTo };
  const reviews = await ReviewService.listPending(orgId, listOpts);
  return { reviews };
}

export type DecideInput = {
  kind: ReviewKind;
  id: number;
  action: 'approve' | 'reject';
  reason?: string;
};

const REVIEW_KINDS: ReviewKind[] = ['skill', 'workflow', 'mission'];

/**
 * Approve or reject a queued item over the API. Deciding a review is the
 * `approve` capability — owners/PMs and client-reviewers hold it; specialists
 * don't. The token's principal is enforced before the dispatch, and the
 * refreshed queue is returned so a caller's inbox stays in sync.
 * @param authHeader
 * @param input
 */
export async function apiDecideReview(
  authHeader: string | null | undefined,
  input: DecideInput,
): Promise<{ ok: true; reviews: ReviewItem[] }> {
  const { orgId, principal, tokenId } = await apiContext(authHeader);

  if (!REVIEW_KINDS.includes(input.kind)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'kind must be one of skill|workflow|mission');
  }
  if (input.action !== 'approve' && input.action !== 'reject') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'action must be "approve" or "reject"');
  }
  if (!Number.isInteger(input.id)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'id must be an integer');
  }

  try {
    enforce(principal, { kind: 'action', action: 'approve', scope: { orgId } }, 'mutate');
  } catch (e) {
    if (e instanceof AuthzDeniedError) {
      throw new WriteApiError(403, 'FORBIDDEN', `Not allowed to decide reviews: ${e.decision.reason}`);
    }
    throw e;
  }

  await ReviewService.decide(
    { kind: input.kind, id: input.id },
    input.action,
    orgId,
    { reason: input.reason, reviewedBy: `token:${tokenId}` },
  );

  const reviews = await ReviewService.listPending(orgId);
  return { ok: true, reviews };
}

function assertItem(kind: unknown, id: unknown): asserts kind is ReviewKind {
  if (!REVIEW_KINDS.includes(kind as ReviewKind)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'kind must be one of skill|workflow|mission');
  }
  if (!Number.isInteger(id)) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'id must be an integer');
  }
}

function enforceQueueManage(principal: Parameters<typeof enforce>[0], orgId: string): void {
  try {
    // Routing/snoozing is queue management — same capability as deciding.
    enforce(principal, { kind: 'action', action: 'approve', scope: { orgId } }, 'mutate');
  } catch (e) {
    if (e instanceof AuthzDeniedError) {
      throw new WriteApiError(403, 'FORBIDDEN', `Not allowed to manage the queue: ${e.decision.reason}`);
    }
    throw e;
  }
}

export type AssignInput = { kind: ReviewKind; id: number; assignedTo: string | null; note?: string };

/**
 * Route a queue item to a user (or `null` to unassign). Returns the refreshed
 * queue. Queue management is the `approve` capability.
 * @param authHeader
 * @param input
 */
export async function apiAssignReview(
  authHeader: string | null | undefined,
  input: AssignInput,
): Promise<{ ok: true; reviews: ReviewItem[] }> {
  const { orgId, principal, tokenId } = await apiContext(authHeader);
  assertItem(input.kind, input.id);
  enforceQueueManage(principal, orgId);

  await ReviewService.assign(orgId, { kind: input.kind, id: input.id }, {
    assignedTo: input.assignedTo,
    assignedBy: `token:${tokenId}`,
    note: input.note,
  });

  const reviews = await ReviewService.listPending(orgId);
  return { ok: true, reviews };
}

export type SnoozeInput = { kind: ReviewKind; id: number; until: string };

/**
 * Snooze a queue item until an ISO timestamp. Returns the refreshed queue.
 * @param authHeader
 * @param input
 */
export async function apiSnoozeReview(
  authHeader: string | null | undefined,
  input: SnoozeInput,
): Promise<{ ok: true; reviews: ReviewItem[] }> {
  const { orgId, principal, tokenId } = await apiContext(authHeader);
  assertItem(input.kind, input.id);
  const until = new Date(input.until);
  if (Number.isNaN(until.getTime())) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'until must be an ISO timestamp');
  }
  enforceQueueManage(principal, orgId);

  await ReviewService.snooze(orgId, { kind: input.kind, id: input.id }, until, `token:${tokenId}`);

  const reviews = await ReviewService.listPending(orgId);
  return { ok: true, reviews };
}

export type EmitEventApiInput = { type: string; payload?: Record<string, unknown>; dedupeKey?: string };

/**
 * Emit an inbound event over the API — the trigger runner fans it out to the
 * workflows subscribed to that type. Any valid tenant token may emit (the
 * workflows it starts gate their own actions). Returns what was triggered.
 * @param authHeader
 * @param input
 */
export async function apiEmitEvent(
  authHeader: string | null | undefined,
  input: EmitEventApiInput,
): Promise<{ ok: true; eventId: number | null; deduped: boolean; triggered: Array<{ slug: string; runId: number }> }> {
  const { orgId, tokenId } = await apiContext(authHeader);
  if (!input.type || typeof input.type !== 'string') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'type is required');
  }
  const result = await emitEvent({
    orgId,
    type: input.type,
    payload: input.payload ?? {},
    dedupeKey: input.dedupeKey,
    invokedBy: `token:${tokenId}`,
  });
  return { ok: true, ...result };
}
