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
 * Whether a done run of this kind can be put back: its action defines `undo`,
 * and — for a kind that says only some inputs can be — this one can.
 * @param actionId - A registered action id (current or former).
 * @param input - The run's input, for a kind that answers per input.
 */
export function actionIsUndoable(actionId: string, input?: Record<string, unknown> | null): boolean {
  const action = getAction(actionId);
  if (typeof action?.undo !== 'function') {
    return false;
  }
  // A kind whose undo covers some inputs only (a Gmail draft, not a send)
  // promises it only for an input it can see.
  return action.undoableFor ? Boolean(input) && action.undoableFor(input as never) : true;
}

/**
 * Whether THIS done run can be put back: its kind defines `undo`, and the
 * kind does not say this particular result is beyond it (a Gmail draft can be
 * deleted; a sent email cannot be unsent).
 * @param actionId - A registered action id (current or former).
 * @param result - What the run's execution returned.
 */
export function runIsUndoable(actionId: string, result: Record<string, unknown> | null | undefined): boolean {
  const action = getAction(actionId);
  if (typeof action?.undo !== 'function') {
    return false;
  }
  return action.canUndo ? action.canUndo(result ?? {}) : true;
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
