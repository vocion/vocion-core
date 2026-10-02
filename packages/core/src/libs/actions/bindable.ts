import { getAction } from './registry';

/**
 * Why an action cannot ride on a choice option, or null when it can.
 *
 * A person taps an option by its label and never sees the bound input, so a
 * tap must only run what changes nothing outside Vocion. An action that
 * reaches out (an email send, a tracker transition) keeps its own approval of
 * the full input. Both `ask_choice` (when the card is built) and
 * `answerChoice` (when the card is answered) ask this one question.
 * @param actionId - The action an option binds.
 * @returns `unknown` or `external`, or null when it is safe to bind.
 */
export function bindingProblem(actionId: string): 'unknown' | 'external' | null {
  const action = getAction(actionId);
  if (!action) {
    return 'unknown';
  }
  return action.external ? 'external' : null;
}
