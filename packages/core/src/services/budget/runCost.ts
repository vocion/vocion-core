/**
 * WHAT AN AGENT RUN COST, recorded where it is charged (Chris, 2026-10-02:
 * "Can we get costs for the agent run steps in the activity feed and counted
 * toward the total feature cost?").
 *
 * Every paid model call already goes through `chargeUsage`, which prices it
 * and adds it to the per-period budget rows. Those rows know the agent and the
 * day, never the run, so a QA review, a plan or a live check cost nothing on
 * any page that showed it. The run a call belongs to is not something each
 * call site should have to pass down — a delegated specialist, a recording
 * pass and a reranker inside a search tool are all several frames away from
 * whoever started the run, and every one that forgot would be spend the run
 * never saw (the budget's own #279 history).
 *
 * So the run is a SCOPE: whoever starts a run opens one with `withRunCost`,
 * and `chargeUsage` adds every call made inside it to that scope, wherever in
 * the call tree it happens. The innermost scope wins, so a mission run a chat
 * turn starts carries its own cost and the chat turn does not count it twice.
 *
 * - A mission run's figure is written to its row as each call is charged, so a
 *   run that dies half way keeps what it spent.
 * - A chat turn's figure is held in memory and written with the assistant
 *   message that ends the turn (`appendMessage`), and added to the
 *   conversation's sum in the same write.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** What a scope is counting for. */
export type RunCostTarget = { missionRunId: number } | { conversationId: number };

/** One open scope and what has been charged inside it so far. */
export type RunCostScope = {
  target: RunCostTarget;
  tokens: number;
  microCents: number;
};

const storage = new AsyncLocalStorage<RunCostScope>();

/**
 * The scope the current call is running in, if any.
 */
export function currentRunCost(): RunCostScope | undefined {
  return storage.getStore();
}

/**
 * Are two targets the same run?
 * @param a - One target.
 * @param b - The other.
 */
function sameTarget(a: RunCostTarget, b: RunCostTarget): boolean {
  if ('missionRunId' in a && 'missionRunId' in b) {
    return a.missionRunId === b.missionRunId;
  }
  if ('conversationId' in a && 'conversationId' in b) {
    return a.conversationId === b.conversationId;
  }
  return false;
}

/**
 * Run `fn` with every model call it makes counted toward `target`. Opening a
 * scope for the run that is already open reuses it, so a mission run's
 * runtime and the agent turn inside it can both declare the run without
 * counting anything twice.
 * @param target - The run.
 * @param fn - The work.
 * @returns What `fn` returned, and the scope that counted it.
 */
export async function withRunCost<T>(target: RunCostTarget, fn: (scope: RunCostScope) => Promise<T>): Promise<T> {
  const open = storage.getStore();
  if (open && sameTarget(open.target, target)) {
    return fn(open);
  }
  const scope: RunCostScope = { target, tokens: 0, microCents: 0 };
  return storage.run(scope, () => fn(scope));
}

/**
 * Add one charged call to the open scope, and to the mission run's row when
 * the scope is one. Called by `chargeUsage` for every call it prices; nothing
 * happens outside a scope. Never throws: the call already happened and was
 * paid for, and failing the run over its accounting would be the worse
 * mistake. A lost write is logged.
 * @param tokens - Tokens the call used.
 * @param microCents - What it cost, in millionths of a cent.
 */
export async function noteRunCost(tokens: number, microCents: number): Promise<void> {
  const scope = storage.getStore();
  if (!scope || (tokens === 0 && microCents === 0)) {
    return;
  }
  scope.tokens += tokens;
  scope.microCents += microCents;
  if (!('missionRunId' in scope.target)) {
    return;
  }
  const missionRunId = scope.target.missionRunId;
  try {
    const [{ db }, { missionRunSchema }, { eq, sql }] = await Promise.all([
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('drizzle-orm'),
    ]);
    // An increment in the statement, never a read-modify-write: two calls
    // charged at once (a turn and its specialist) both land.
    await db.update(missionRunSchema).set({
      tokens: sql`coalesce(${missionRunSchema.tokens}, 0) + ${tokens}`,
      microCents: sql`coalesce(${missionRunSchema.microCents}, 0) + ${microCents}`,
    }).where(eq(missionRunSchema.id, missionRunId));
  } catch (error) {
    import('@/libs/Logger')
      .then(({ logger }) => logger.warn('mission run cost was not recorded', { missionRunId, tokens, microCents, error: error instanceof Error ? error.message : String(error) }))
      .catch(() => {});
  }
}

/** Micro-cents in a cent. */
const MICRO_PER_CENT = 1_000_000;

/**
 * Micro-cents as whole cents, for a page. Null stays null: not recorded is not zero.
 * @param microCents - The recorded figure.
 */
export function centsOf(microCents: number | null | undefined): number | null {
  return microCents === null || microCents === undefined ? null : Math.round(microCents / MICRO_PER_CENT);
}
