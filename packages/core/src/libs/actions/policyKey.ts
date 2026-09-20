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

import { getAction } from './registry';

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
