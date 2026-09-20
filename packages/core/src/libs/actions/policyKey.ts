/**
 * The id the autonomy ladder keys on for one run.
 *
 * Almost always the action id. An action that serves several ledgers — one
 * `git.merge` carrying a `riskClass` — declares `policyKeyFor`, and then the
 * trust rule, the risk tier and the alignment evidence all live under the
 * derived id (`git.merge.docs`) while the run still names the action it is.
 * Every reader of "what kind is this run, to the ladder" goes through here
 * so the gate that releases work and the ledger that earns it agree.
 */

import type { Action } from './types';
import { getAction, listActions } from './registry';

/**
 * The registered action behind a ladder key — the key itself when it is an
 * action id, else the action whose id is the longest prefix of it
 * (`git.merge.docs` → `git.merge`, `objects.update_meta.request` →
 * `objects.update_meta`). Every reader that turns a key back into "what
 * kind of action is this" — the risk tier default, the never-auto hold —
 * goes through here, so a derived key with no rule of its own is judged as
 * its action rather than as an unknown, high-risk kind.
 * @param policyKey - An action id or a key `policyKeyForRun` derived from one.
 */
export function actionForPolicyKey(policyKey: string): Action | undefined {
  const exact = getAction(policyKey);
  if (exact) {
    return exact;
  }
  let best: Action | undefined;
  for (const action of listActions()) {
    if (policyKey.startsWith(`${action.id}.`) && (!best || action.id.length > best.id.length)) {
      best = action;
    }
  }
  return best;
}

/**
 * @param actionId - The registered action id on the run.
 * @param input - The run's input, as stored.
 * @returns The derived key, or the action id when the action derives none.
 */
export function policyKeyForRun(actionId: string, input: Record<string, unknown> | null | undefined): string {
  const derive = getAction(actionId)?.policyKeyFor;
  if (!derive) {
    return actionId;
  }
  try {
    const key = derive(input ?? {});
    return typeof key === 'string' && key.trim() ? key : actionId;
  } catch {
    return actionId;
  }
}
