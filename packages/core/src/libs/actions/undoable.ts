/**
 * CAN THIS BE UNDONE — answered by the action's own definition, never promised.
 *
 * "A person can undo it from the Review queue's Decided tab" was said after
 * every done run, and roughly thirty kinds have an `undo`: an email sent
 * (`gmail.send`), a REST call, a filed candidate, an enrollment, a QC step and
 * the factory's steps do not. `ActionService.undoAction` refuses those with
 * NOT_REVERSIBLE, so the promise was false exactly where it mattered most.
 * Every receipt that offers Undo asks here first.
 */

import { getAction } from './registry';

/**
 * Whether a done run of this kind can be put back: its action defines `undo`.
 * @param actionId - A registered action id (current or former).
 */
export function actionIsUndoable(actionId: string): boolean {
  return typeof getAction(actionId)?.undo === 'function';
}

/**
 * The action as a person reads it: its registered name, else its id as words.
 * @param actionId - A registered action id.
 */
export function actionLabel(actionId: string): string {
  const named = getAction(actionId)?.name;
  if (named) {
    return named;
  }
  const last = actionId.split('.').pop() ?? actionId;
  return last.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
