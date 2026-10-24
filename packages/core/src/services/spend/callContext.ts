/**
 * THE CALL CONTEXT — who and what a model call was for, carried down the call
 * tree so the spend ledger (`services/spend/ledger.ts`) can file it.
 *
 * A charge already knows its workspace, agent and feature, because the call
 * site passes them. It never knew the person, the conversation, the run or the
 * effort level: those belong to whoever started the work, often several frames
 * up (a reranker inside a search tool inside a delegated specialist). Passing
 * them down by hand is the shape that left a dozen calls uncharged before, so
 * they ride an AsyncLocalStorage scope instead, the same way the run's cost
 * does (`services/budget/runCost.ts`).
 *
 * Whoever starts work opens a scope with `withCallContext`; an inner scope adds
 * to the outer one and wins where both say something. `chargeUsage` reads it
 * once per call.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** The runs a call can belong to, as the ledger names them. */
export const RUN_KINDS = ['mission_run', 'browser_run', 'routine_run', 'workflow_run', 'eval_run', 'worker_run'] as const;
export type RunKind = typeof RUN_KINDS[number];

export type CallContext = {
  userId?: string | null;
  conversationId?: number | null;
  messageId?: number | null;
  runKind?: RunKind | null;
  runId?: string | number | null;
  effortLevel?: string | null;
  /** How the turn's model was chosen (ADR 0006): `jev` | `configured`. Unset when no Jev key is configured. */
  routeSelector?: string | null;
  /** The routing decision, filed on every call the turn makes. */
  routeDetail?: Record<string, unknown> | null;
  /** The agent whose work this is, when a call site does not name it. */
  agentSlug?: string | null;
  traceId?: string | null;
};

const storage = new AsyncLocalStorage<CallContext>();

/** The context the current call runs in (empty outside any). */
export function currentCallContext(): CallContext {
  return storage.getStore() ?? {};
}

/**
 * The outer context with the inner one laid over it: a field the inner one
 * leaves undefined keeps the outer value; one it sets (null included) wins.
 * @param outer - What was open.
 * @param inner - What the new scope says.
 */
export function mergeCallContext(outer: CallContext, inner: CallContext): CallContext {
  const out: CallContext = { ...outer };
  for (const [k, v] of Object.entries(inner) as Array<[keyof CallContext, CallContext[keyof CallContext]]>) {
    if (v !== undefined) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Run `fn` with `context` added to the call context.
 * @param context - What this work is for.
 * @param fn - The work.
 */
export function withCallContext<T>(context: CallContext, fn: () => T): T {
  return storage.run(mergeCallContext(currentCallContext(), context), fn);
}

/**
 * Fill in a field of the open context after it opened (a turn learns its trace
 * id once the trace starts). Does nothing outside a scope.
 * @param patch - The fields to set.
 */
export function noteCallContext(patch: CallContext): void {
  const open = storage.getStore();
  if (open) {
    Object.assign(open, mergeCallContext(open, patch));
  }
}
