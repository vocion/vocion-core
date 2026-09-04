/**
 * ActionService — propose → (gate) → execute connector-write actions.
 *
 * The write counterpart to running a skill. An actor (usually an agent
 * teammate, sometimes a human/token) *proposes* an action; authz decides
 * whether it needs approval (external + low autonomy → yes). Gated actions
 * persist as `action_run` (status `pending`) and surface in the unified review
 * queue as the 4th kind; on approval `executeAction` resolves the source's
 * vault credentials and runs the action. Non-gated actions execute immediately
 * and still record their run for the audit trail.
 *
 * No import of ReviewService here — the queue reads `action_run` directly and
 * dispatches back into `executeAction`/`rejectAction`, keeping the dependency
 * one-directional.
 */

import type { Principal } from '@/services/authz';
import { and, eq } from 'drizzle-orm';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

export class ActionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

export type ProposeResult = {
  runId: number;
  status: 'pending' | 'done' | 'failed';
  result?: Record<string, unknown> | null;
};

/**
 * Propose an action. Enforces the actor's grant + autonomy gate. If the gate
 * requires approval, records a `pending` action_run and returns it (it now
 * lives in the review queue). Otherwise executes immediately.
 * @param input
 * @param input.orgId
 * @param input.actionId
 * @param input.input
 * @param input.principal
 * @param input.invokedBy
 * @param input.proposal
 * @param input.proposal.confidence
 * @param input.proposal.rationale
 * @param input.proposal.evidence
 * @param input.proposal.agentSlug
 * @param input.dedupKey
 * @param input.expiresAt
 */
export async function proposeAction(input: {
  orgId: string;
  actionId: string;
  input: Record<string, unknown>;
  principal: Principal;
  invokedBy?: string;
  /** Agent-proposal envelope — confidence (0–1), rationale, evidence uris. */
  proposal?: { confidence?: number; rationale?: string; evidence?: string[]; agentSlug?: string };
  /**
   * Upsert key for agent-suggested actions — (object type + id + action slug).
   * If a PENDING action_run already exists for (orgId, dedupKey), it is
   * UPDATED in place (input/proposal/expiry refreshed) instead of duplicated.
   */
  dedupKey?: string;
  /** When this suggestion goes stale (drops from the queue/brief). */
  expiresAt?: Date;
}): Promise<ProposeResult> {
  const action = getAction(input.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${input.actionId}`);
  }
  const parsed = action.inputSchema.parse(input.input);
  // Canonical dedup: when the proposer passes no key, the action derives one
  // from the parsed input — so an agent proposing the same call twice collapses
  // into the deterministic job's old behaviour instead of stacking queue items.
  const dedupKey = input.dedupKey ?? action.dedupKeyFor?.(parsed);

  // Authorised BEFORE anything is written. The refresh path below updates a
  // pending row and calls the action's `onProposed`, which can touch a domain
  // record — deciding permission after that would let an ungranted caller
  // rewrite what a reviewer is about to decide on.
  let decision;
  try {
    decision = enforce(
      input.principal,
      { kind: 'action', action: action.grant, external: action.external, scope: { orgId: input.orgId } },
      'mutate',
    );
  } catch (e) {
    if (e instanceof AuthzDeniedError) {
      throw new ActionError('FORBIDDEN', `Not allowed to run ${action.id}: ${e.decision.reason}`);
    }
    throw e;
  }

  // The action's own last word, before any row exists. Tenant state the input
  // schema cannot check lives here, and refusing costs the caller nothing but
  // a message it can act on.
  const refusal = await action.precheck?.(
    { orgId: input.orgId, invokedBy: input.invokedBy ?? input.principal.id },
    parsed,
  );
  if (refusal) {
    throw new ActionError('VALIDATION_FAILED', refusal);
  }

  // Upsert-by-key: a re-surfaced owed action updates its existing PENDING row
  // rather than stacking duplicates in the queue. Only PENDING rows dedupe —
  // a decided (done/rejected) action can be proposed fresh later.
  if (dedupKey) {
    const [existing] = await db
      .select({ id: actionRunSchema.id })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, input.orgId),
        eq(actionRunSchema.dedupKey, dedupKey),
        eq(actionRunSchema.status, 'pending'),
      ))
      .limit(1);
    if (existing) {
      await db
        .update(actionRunSchema)
        .set({
          input: parsed as Record<string, unknown>,
          proposal: input.proposal ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .where(eq(actionRunSchema.id, existing.id));
      // Keep the action's own domain row in step with the refreshed payload.
      // `onProposed` is documented idempotent precisely so it can run here as
      // well as on first creation; without this a re-proposed candidate would
      // show the reviewer a stale record.
      await action.onProposed?.(
        { orgId: input.orgId, invokedBy: input.invokedBy ?? input.principal.id },
        parsed,
        existing.id,
      );
      return { runId: existing.id, status: 'pending' };
    }
  }

  const gated = decision.gate === 'approve';
  const [run] = await db
    .insert(actionRunSchema)
    .values({
      orgId: input.orgId,
      actionId: action.id,
      input: parsed as Record<string, unknown>,
      status: gated ? 'pending' : 'approved',
      invokedBy: input.invokedBy ?? input.principal.id,
      sourceSlug: action.sourceSlug ?? null,
      proposal: input.proposal ?? null,
      dedupKey: dedupKey ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: actionRunSchema.id });

  // Back-link the fresh run onto the domain record it reviews. Runs before the
  // gate resolves so the link exists whether the run stays pending or executes.
  await action.onProposed?.(
    { orgId: input.orgId, invokedBy: input.invokedBy ?? input.principal.id },
    parsed,
    run!.id,
  );

  if (gated) {
    // Never-auto guard (safety invariant): these ALWAYS require an explicit
    // human approve, no matter what trust rules exist.
    //   - an outbound send to a real person (gmail.send, or any external action
    //     carrying the send_email grant) — a misconfigured or over-eager
    //     threshold must never be able to fire an email on its own;
    //   - discovery.review_proposal — approving it starts the follow-up
    //     workflow, which drafts an email in the seller's voice. Supervised v1
    //     means a human confirms every detected discovery call, and that is the
    //     calibration data 020 is built on; auto-approving would both skip the
    //     human and poison the feedback signal.
    //   - personalization.enroll — approving it enrolls a real lead into a
    //     HubSpot sequence that sends real email. No trust rule can release
    //     an enrollment without a human.
    //   - objects.propose_candidate — approving an extracted record is what
    //     lets it be published outside. The whole moderation loop exists so a
    //     human sees every candidate; a confidence threshold that cleared them
    //     automatically would empty the queue without anyone reading it.
    // Deliberately not configurable; revisit only once UC5 trust reporting
    // exists and a human opts in explicitly. Fails safe — it can only keep the
    // item in the review queue, never release it.
    if (action.id === 'gmail.send' || action.grant === 'send_email' || action.id === 'discovery.review_proposal' || action.id === 'personalization.enroll' || action.id === 'objects.propose_candidate') {
      return { runId: run!.id, status: 'pending' };
    }
    // Trust ladder: an ENABLED rule whose threshold this proposal's
    // confidence clears executes it now — audited, never silent. The
    // default (no rule) keeps every external action in the review queue.
    const { trustDecision } = await import('@/services/TrustService');
    const trust = await trustDecision(input.orgId, action.id, input.proposal?.confidence);
    if (trust.auto) {
      await db
        .update(actionRunSchema)
        .set({
          proposal: {
            ...(input.proposal ?? {}),
            autoApproved: true,
            autoApprovedThreshold: trust.threshold,
          } as never,
        })
        .where(eq(actionRunSchema.id, run!.id));
      return executeAction(run!.id, input.orgId);
    }
    return { runId: run!.id, status: 'pending' };
  }
  return executeAction(run!.id, input.orgId);
}

/**
 * Execute a proposed action (called on approval, or directly for non-gated).
 * Resolves the source's vault credentials, runs the action, records the result.
 * @param runId
 * @param orgId
 * @param opts
 * @param opts.reviewedBy - The human who approved, when it came through review.
 * @param opts.externalRef
 * @param opts.externalRef.system
 * @param opts.externalRef.id
 */
export async function executeAction(
  runId: number,
  orgId: string,
  opts?: {
    reviewedBy?: string;
    /** The downstream record the approver created, to link to the domain row. */
    externalRef?: { system: string; id: string };
  },
): Promise<ProposeResult> {
  const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId)).limit(1);
  if (!run || run.orgId !== orgId) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  const action = getAction(run.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${run.actionId}`);
  }
  // Only a run still awaiting its outcome may execute. `pending` is the review
  // queue's approve, `approved` is a run the gate let straight through. A run
  // that is done, failed or rejected has an outcome already, and re-running it
  // would undo a decision — for an action that keeps a domain record, that
  // means flipping a rejected record to approved.
  if (run.status !== 'pending' && run.status !== 'approved') {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is ${run.status} — already decided, cannot execute`);
  }

  await db.update(actionRunSchema).set({ status: 'executing' }).where(eq(actionRunSchema.id, runId));
  const credentials = action.sourceSlug ? await getCredentialsForSource(orgId, action.sourceSlug) : undefined;

  try {
    const result = await action.execute({
      orgId,
      credentials,
      invokedBy: run.invokedBy ?? undefined,
      reviewedBy: opts?.reviewedBy,
      runId,
      externalRef: opts?.externalRef,
    }, run.input);
    await db
      .update(actionRunSchema)
      .set({ status: 'done', result, executedAt: new Date() })
      .where(eq(actionRunSchema.id, runId));
    return { runId, status: 'done', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(actionRunSchema)
      .set({ status: 'failed', error: message, executedAt: new Date() })
      .where(eq(actionRunSchema.id, runId));
    return { runId, status: 'failed', result: null };
  }
}

/**
 * Overwrite a PENDING action's input — the operator edited the draft in the
 * review queue before approving (edit-then-approve). Re-validates against the
 * action's own input schema so an edit can never smuggle a malformed payload
 * into execution. No-op-safe: only touches rows still `pending` for this org.
 * @param runId
 * @param orgId
 * @param input - The edited payload (same shape the action expects).
 */
export async function updateActionInput(runId: number, orgId: string, input: Record<string, unknown>): Promise<void> {
  const [run] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId))).limit(1);
  if (!run) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  if (run.status !== 'pending') {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is ${run.status}, not pending — cannot edit`);
  }
  const action = getAction(run.actionId);
  const parsed = action ? action.inputSchema.parse(input) : input;
  await db
    .update(actionRunSchema)
    .set({ input: parsed as Record<string, unknown> })
    .where(eq(actionRunSchema.id, runId));

  // The edit has to reach the action's own domain row too. Without this an
  // edit-then-approve executes on the corrected payload while the record the
  // reviewer's decision is kept as still holds the original — the same drift
  // the dedup-refresh path guards against, and `onProposed` is documented
  // idempotent so it is safe to run again here.
  await action?.onProposed?.(
    { orgId, invokedBy: run.invokedBy ?? undefined },
    parsed,
    runId,
  );
}

/**
 * Reject a pending action (from the review queue) — never executes. The
 * action's `onRejected` hook runs after the flip so the domain record it
 * back-links can move lanes with the decision (fail-soft: the rejection
 * stands even if the hook fails).
 * @param runId
 * @param orgId
 * @param reason
 * @param opts
 * @param opts.reviewedBy - The human who declined, when it came through review.
 */
export async function rejectAction(runId: number, orgId: string, reason?: string, opts?: { reviewedBy?: string }): Promise<void> {
  const [run] = await db
    .update(actionRunSchema)
    .set({ status: 'rejected', error: reason ?? null, executedAt: new Date() })
    .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
    .returning({ actionId: actionRunSchema.actionId, input: actionRunSchema.input, invokedBy: actionRunSchema.invokedBy });
  if (!run) {
    return;
  }
  const action = getAction(run.actionId);
  await action?.onRejected?.(
    { orgId, invokedBy: run.invokedBy ?? undefined, reviewedBy: opts?.reviewedBy },
    run.input,
    runId,
    reason,
  ).catch((err) => {
    console.error(`[ActionService] onRejected hook for "${run.actionId}" failed`, err);
  });
}
