/**
 * OUTWARD OR IRREVERSIBLE — the actions a person approves every time.
 *
 * A kind is held at a person's approval on every run, and is never offered
 * "Always allow", when it:
 *   - is on the platform's never-auto list (`neverAuto.ts`: a send to a real
 *     person, a publish outside, a run that must be decided on its own card);
 *   - says every run waits for a person (`approvalRequired`); or
 *   - reaches outside the workspace (`external`) and cannot be put back (no
 *     `undo`, or none for this input).
 *
 * Read by a workflow's `action` step, which holds such a run for a person
 * whatever the trust ladder says, and by "Always allow", which never offers
 * to stop asking for one. `site.publish_live` is the example: once a post is
 * live it is the site's.
 */
import type { Action } from './types';
import { isNeverAuto } from './neverAuto';

/**
 * Whether this action — with this input, when known — goes out or cannot be undone.
 * @param action - The registered action.
 * @param input - The run's input, for a kind whose undo covers some inputs only.
 */
export function isOutwardOrIrreversible(action: Pick<Action, 'id' | 'grant' | 'external' | 'approvalRequired' | 'requiresReviewDecision' | 'undo' | 'undoableFor'>, input?: Record<string, unknown> | null): boolean {
  if (isNeverAuto(action) || action.approvalRequired === true) {
    return true;
  }
  if (!action.external) {
    return false;
  }
  if (typeof action.undo !== 'function') {
    return true;
  }
  return Boolean(action.undoableFor && input && !action.undoableFor(input as never));
}

/** What the card says when a run is held because of it. */
export const OUTWARD_HOLD_REASON = 'it reaches outside the workspace or cannot be undone, so a person approves every run';
