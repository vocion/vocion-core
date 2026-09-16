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
import type { PendingPage, ReviewDetail, ReviewInclude, ReviewItem, ReviewKind } from '@/services/ReviewService';
import type { SourceSyncState } from '@/services/SourceSyncService';
import { parseSuggestedDecision, SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';
import { authenticateBearer } from '@/services/ApiTokenService';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { emitEvent } from '@/services/EventService';
import * as ReviewService from '@/services/ReviewService';
import { REVIEW_INCLUDES } from '@/services/ReviewService';

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
 * Read the `approvedByAgent` query parameter — `true`, `false` or `null` — as
 * the three-state value the queue filters on.
 *
 * Undefined in, undefined out: the caller asked for no filter. `null` in means
 * the caller is asking for the undecided rows, which is a filter, and is why
 * this cannot be a plain `Boolean()` coercion.
 *
 * Anything else is a 400 rather than a shrug. A misread value that fell
 * through as "no filter" would hand back the whole queue while the client
 * believed every row in it was agent-approved — the same failure the
 * `suggestedDecision` check above exists to prevent.
 * @param raw - The query parameter as sent, or undefined when absent.
 */
function parseApprovedByAgent(raw: string | undefined): boolean | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw === 'null') {
    return null;
  }
  throw new WriteApiError(400, 'VALIDATION_FAILED', 'approvedByAgent must be one of true, false, null');
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
  /**
   * Registered action ids to narrow the ACTION plane to
   * (`personalization.enroll`, `hubspot.update`, …). `kind` is the plane; this
   * is the card type inside it, and a queue of 557 pending items can be 557
   * rows of one plane.
   */
  actionIds?: string[];
  /**
   * Payloads to inline on each item instead of leaving each one to its own
   * detail fetch: `input`, `proposal`, or both. Omit for the thin rows every
   * caller gets today; an unrecognised value is a 400, never silence.
   */
  include?: string[];
  /**
   * Narrow to what the AGENT recommended — `approve`, `reject` or `snooze`.
   * This is a queue of "everything my screener wants turned down", which is a
   * different question from the card type or the plane, so it composes with
   * both rather than replacing either.
   */
  suggestedDecision?: string;
  /**
   * Narrow to WHO approved — `true` the trust ladder, `false` a person,
   * `null` nobody yet — as the raw query string, parsed here.
   *
   * Sent as the text `true`, `false` or `null`. Anything else is a 400: a
   * filter that silently does nothing would hand back the whole queue looking
   * like every row in it matched.
   */
  approvedByAgent?: string;
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
  // A misspelled filter must not read as "no filter" — that would hand back
  // the whole queue and look like every item carried the recommendation the
  // caller asked for.
  if (opts.suggestedDecision !== undefined && parseSuggestedDecision(opts.suggestedDecision) === undefined) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', `suggestedDecision must be one of ${SUGGESTED_DECISIONS.join(', ')}`);
  }
  // Same rule as the filters above: a misspelled `include` must not read as
  // "include nothing". A caller asking for a payload and silently getting thin
  // rows would fall back to a detail fetch per item, which is exactly the cost
  // this option exists to remove, and it would look like the option did not
  // work rather than like the request was wrong.
  const include = opts.include?.filter(Boolean);
  const unknown = include?.filter(v => !REVIEW_INCLUDES.includes(v as ReviewInclude)) ?? [];
  if (unknown.length > 0) {
    throw new WriteApiError(
      400,
      'VALIDATION_FAILED',
      `include must be one of ${REVIEW_INCLUDES.join(', ')}`,
    );
  }
  return ReviewService.listPendingPage(caller.orgId, {
    include: include as ReviewInclude[] | undefined,
    suggestedDecision: parseSuggestedDecision(opts.suggestedDecision),
    approvedByAgent: parseApprovedByAgent(opts.approvedByAgent),
    assignedTo: opts.assignedTo === undefined
      ? undefined
      : (opts.assignedTo === 'unassigned' ? null : opts.assignedTo),
    kind: opts.kind as ReviewKind | undefined,
    actionIds: opts.actionIds,
    includeSnoozed: opts.includeSnoozed,
    limit: opts.limit,
    offset: opts.offset,
  });
}

/**
 * The card types pending for the caller's org, each with its real count and
 * registered display name — what a client builds a type filter from without
 * hardcoding the list.
 * @param caller
 */
export async function apiListReviewTypes(caller: ApiCaller) {
  return ReviewService.pendingActionTypes(caller.orgId);
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
   * Whether this decision may train the proposing agent (default true). An
   * automated caller, a cron rejecting every past-dated proposal with one
   * canned reason, passes `false` so its machine text never queues as a
   * learning candidate.
   */
  learn?: boolean;
  /**
   * Corrected payload for edit-then-approve. Only applied on `approve`. On a
   * workflow this is the input the run resumes with.
   */
  editedInput?: Record<string, unknown>;
  /**
   * The record the approving caller created in its own system, e.g. the
   * Strapi entry an admin panel just published. Only applied on `approve`;
   * the action links its own row to it. Core never calls that system.
   */
  externalRef?: { system: string; id: string };
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
      learn: input.learn,
      reviewedBy: caller.actorId,
      editedInput: input.action === 'approve' ? input.editedInput : undefined,
      externalRef: input.action === 'approve' ? input.externalRef : undefined,
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

const ACTION_SIGNALS: ReviewService.ActionSignal[] = ['approve', 'edit', 'reject', 'skip', 'save', 'rewrite', 'regenerate'];

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
  /**
   * What the agent thinks the reviewer should do. Advisory; never auto-runs
   * anything. Typed loosely because it arrives off an HTTP body — validated
   * below, so a bad value is a 400 rather than a dropped field.
   */
  suggestedDecision?: string;
  /** Only with `suggestedDecision: 'snooze'` — an ISO timestamp for the revisit. */
  suggestedSnoozeUntil?: string;
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
  // Refuse an unrecognised recommendation rather than dropping it. Storing a
  // typo'd value would leave the run looking like it carried no opinion, and
  // the agreement metric would quietly count nothing for that agent.
  if (input.suggestedDecision !== undefined && parseSuggestedDecision(input.suggestedDecision) === undefined) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', `suggestedDecision must be one of ${SUGGESTED_DECISIONS.join(', ')}`);
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
      // `invokedBy` below is the API caller, so the agent it acted for has to
      // travel in the envelope or the action ends up attributed to nobody.
      proposal: {
        confidence: input.confidence,
        rationale: input.rationale,
        agentSlug: input.agentSlug,
        suggestedDecision: parseSuggestedDecision(input.suggestedDecision),
        suggestedSnoozeUntil: input.suggestedSnoozeUntil,
      },
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

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * What one source's last (or current) sync run did.
 *
 * Dates are ISO strings, not `Date`s: this crosses HTTP, and a caller reading
 * `startedAt` out of JSON should get the same thing whether it read the body or
 * this type.
 */
export type ApiSourceRun = {
  status: SourceSyncState['status'];
  startedAt: string;
  completedAt: string | null;
  /** The stored incremental watermark the next run will fetch from; null when there is none. */
  since: string | null;
  counts: Record<string, number>;
  /** The non-fatal failures the run carried on past, including processor-scope ones. */
  failures: Array<{ scope: string; message: string; uri?: string }>;
};

export type ApiSourceListItem = {
  slug: string;
  name: string;
  /** Connector slug (`web`, `local-files`, …), read from the config's `_connector` stamp. */
  connector: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  documentCount?: number;
  run: ApiSourceRun | null;
};

/**
 * Every source this org has, with its latest checkpoint, the reporting surface
 * a tenant's own scheduler reads to find out what its sources actually did.
 *
 * Composed exactly as the dashboard's `/rpc/sources` composes it (list +
 * document counts + checkpoints), so the two can never disagree about what a
 * run did. `failures` is what makes a processor error visible without a
 * database: the counts say how many, this says which and why.
 * @param caller
 */
export async function apiListSources(caller: ApiCaller): Promise<{ sources: ApiSourceListItem[] }> {
  const { documentCountsForOrg, latestSyncStateForOrg, listSources } = await import('@/services/SourceSyncService');
  const { sourceNameOf } = await import('@/libs/sources/upsert');
  const [sources, documentCounts, syncState] = await Promise.all([
    listSources(caller.orgId),
    documentCountsForOrg(caller.orgId),
    latestSyncStateForOrg(caller.orgId),
  ]);
  return {
    sources: sources.map((s) => {
      const run = syncState[s.id];
      return {
        slug: s.slug,
        name: sourceNameOf(s.config, s.slug),
        connector: (s.config?._connector as string | undefined) ?? s.kind ?? s.slug,
        // `knowledge_source.enabled` is a TEXT column holding 'true' / 'false'.
        // A JSON client should never have to know that.
        enabled: s.enabled === 'true',
        lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
        documentCount: documentCounts[s.id] ?? 0,
        run: run ? apiRunOf(run) : null,
      };
    }),
  };
}

export type UpsertSourceInput = {
  slug: string;
  name?: string;
  /** Connector kind, must name a registered connector. */
  kind: string;
  config: Record<string, unknown>;
  schedule?: string;
  reconcileSchedule?: string | false;
  enabled?: boolean;
  processor?: { slug: string; config?: Record<string, unknown> };
};

/**
 * Create or replace one source, by slug.
 *
 * **Authoritative**: the stored config blob is REPLACED, reserved stamps and
 * all. That is the contract with a tenant whose own system of record owns the
 * source list, a mirrored change has to land, and the dashboard's edit path
 * (`updateSourceConfig`, which preserves unknown and `_`-prefixed keys) is the
 * one that must not clobber what it did not author. It is emphatically not
 * `addSource`, whose find-or-create would answer 200 and store nothing.
 *
 * Both Temporal schedules are made to match in the same call, so a source
 * arrives syncing rather than waiting for somebody to notice.
 * @param caller
 * @param input
 */
export async function apiUpsertSource(
  caller: ApiCaller,
  input: UpsertSourceInput,
): Promise<{ source: { slug: string; created: boolean } }> {
  if (!input.slug || typeof input.slug !== 'string') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'slug is required');
  }
  if (!input.kind || typeof input.kind !== 'string') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'kind is required');
  }
  if (input.config !== undefined && (typeof input.config !== 'object' || input.config === null || Array.isArray(input.config))) {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'config must be an object');
  }

  const { reconcileSourceSchedules, storedProcessorNames, upsertSourceRow } = await import('@/libs/sources/upsert');
  const spec = {
    slug: input.slug,
    name: input.name,
    kind: input.kind,
    config: input.config ?? {},
    enabled: input.enabled ?? true,
    schedule: input.schedule,
    reconcileSchedule: input.reconcileSchedule,
    processor: input.processor ? { slug: input.processor.slug, config: input.processor.config ?? {} } : undefined,
  };

  let written: { outcome: 'created' | 'updated' | 'unchanged'; id: number | null };
  try {
    written = await upsertSourceRow(caller.orgId, spec, { known: await storedProcessorNames(caller.orgId) });
  } catch (error) {
    // An unknown connector, a config the connector's schema rejects, an
    // unregistered processor or a processor naming a step this org does not
    // have are all the caller's mistake, not a server fault.
    console.error(`[writeApi] upsertSource("${input.slug}") failed`, error);
    throw new WriteApiError(400, 'VALIDATION_FAILED', error instanceof Error ? error.message : 'Could not save that source');
  }

  // The row is written; the schedules may not be. Say so rather than answering
  // 200 over a source that will never sync, the upsert is idempotent, so the
  // caller's retry (or its reconcile pass) heals it.
  try {
    await reconcileSourceSchedules(caller.orgId, spec, written.id);
  } catch (error) {
    console.error(`[writeApi] source "${input.slug}" was saved but its schedule could not be set`, error);
    throw new WriteApiError(
      503,
      'SCHEDULE_UNAVAILABLE',
      `Source "${input.slug}" was saved, but its sync schedule could not be set. Retry this upsert once the scheduler is reachable.`,
    );
  }

  return { source: { slug: input.slug, created: written.outcome === 'created' } };
}

/**
 * Start a full sync of one source, off the request path.
 *
 * Asynchronous on purpose: a crawl runs for minutes, so this hands the work to
 * Temporal and answers 202 with the checkpoint as it stands. The caller polls
 * `GET /api/v1/sources` for the outcome. A run already holding the source is a
 * 409, `latestSyncStateForOrg` already reports a dead run as `abandoned`, so
 * a stuck source is never permanently unsyncable and this does no window
 * arithmetic of its own.
 * @param caller
 * @param slug - The source to sync.
 */
export async function apiSyncSource(caller: ApiCaller, slug: string): Promise<{ run: ApiSourceRun | null }> {
  if (!slug || typeof slug !== 'string') {
    throw new WriteApiError(400, 'VALIDATION_FAILED', 'slug is required');
  }
  const { latestSyncStateForOrg, listSources } = await import('@/services/SourceSyncService');
  const source = (await listSources(caller.orgId)).find(s => s.slug === slug);
  if (!source) {
    throw new WriteApiError(404, 'NOT_FOUND', `No source "${slug}" in this workspace`);
  }

  const state = (await latestSyncStateForOrg(caller.orgId))[source.id] ?? null;
  if (state?.status === 'running') {
    throw new WriteApiError(409, 'CONFLICT', `Source "${slug}" is already syncing. Wait for that run to finish, then try again.`);
  }

  const { startSourceFullSync } = await import('@/services/SourceScheduleService');
  await startSourceFullSync({ orgId: caller.orgId, sourceId: source.id, sourceSlug: slug });
  return { run: state ? apiRunOf(state) : null };
}

/**
 * A checkpoint as the API reports it.
 * @param state - The stored checkpoint.
 */
function apiRunOf(state: SourceSyncState): ApiSourceRun {
  return {
    status: state.status,
    startedAt: state.startedAt.toISOString(),
    completedAt: state.completedAt?.toISOString() ?? null,
    since: state.since?.toISOString() ?? null,
    counts: state.counts,
    failures: state.failures.map(f => ({ scope: f.scope, message: f.message, ...(f.uri ? { uri: f.uri } : {}) })),
  };
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export type ApiAgentBudget = {
  agentSlug: string;
  period: string;
  currentTokens: number;
  currentCents: number;
  softTokenLimit: number | null;
  softCentsLimit: number | null;
  hardTokenLimit: number | null;
  hardCentsLimit: number | null;
  periodStartedAt: string;
};

/**
 * Every agent budget row for the caller's org, limits included.
 *
 * Read-only to the caller, but not a pure read: `listAgentBudgets` rolls the
 * period boundary as it goes (idempotently), so the counters returned are the
 * ACTIVE period's rather than a stale one's. The dashboard's observability page
 * renders cents totals only; the limit columns are the half an operator needs
 * to answer "would this run be refused?", and there was no API surface at all.
 * @param caller
 */
export async function apiListAgentBudgets(caller: ApiCaller): Promise<{ budgets: ApiAgentBudget[] }> {
  const { listAgentBudgets } = await import('@/services/BudgetService');
  const rows = await listAgentBudgets(caller.orgId);
  return {
    budgets: rows.map(r => ({
      agentSlug: r.agentSlug,
      period: r.period,
      currentTokens: r.currentTokens,
      currentCents: r.currentCents,
      softTokenLimit: r.softTokenLimit,
      softCentsLimit: r.softCentsLimit,
      hardTokenLimit: r.hardTokenLimit,
      hardCentsLimit: r.hardCentsLimit,
      periodStartedAt: r.periodStartedAt.toISOString(),
    })),
  };
}
