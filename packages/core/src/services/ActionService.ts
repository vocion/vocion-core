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
 */
export async function proposeAction(input: {
  orgId: string;
  actionId: string;
  input: Record<string, unknown>;
  principal: Principal;
  invokedBy?: string;
  /** Agent-proposal envelope — confidence (0–1), rationale, evidence uris. */
  proposal?: { confidence?: number; rationale?: string; evidence?: string[] };
}): Promise<ProposeResult> {
  const action = getAction(input.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${input.actionId}`);
  }
  const parsed = action.inputSchema.parse(input.input);

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
    })
    .returning({ id: actionRunSchema.id });

  if (gated) {
    return { runId: run!.id, status: 'pending' };
  }
  return executeAction(run!.id, input.orgId);
}

/**
 * Execute a proposed action (called on approval, or directly for non-gated).
 * Resolves the source's vault credentials, runs the action, records the result.
 * @param runId
 * @param orgId
 */
export async function executeAction(runId: number, orgId: string): Promise<ProposeResult> {
  const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId)).limit(1);
  if (!run || run.orgId !== orgId) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  const action = getAction(run.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${run.actionId}`);
  }

  await db.update(actionRunSchema).set({ status: 'executing' }).where(eq(actionRunSchema.id, runId));
  const credentials = action.sourceSlug ? await getCredentialsForSource(orgId, action.sourceSlug) : undefined;

  try {
    const result = await action.execute({ orgId, credentials, invokedBy: run.invokedBy ?? undefined }, run.input);
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
 * Reject a pending action (from the review queue) — never executes.
 * @param runId
 * @param orgId
 * @param reason
 */
export async function rejectAction(runId: number, orgId: string, reason?: string): Promise<void> {
  await db
    .update(actionRunSchema)
    .set({ status: 'rejected', error: reason ?? null, executedAt: new Date() })
    .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)));
}
