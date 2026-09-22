/**
 * What a review decision TAUGHT, in words.
 *
 * Every decision is training data (design value 4), and until now the product
 * only ever said what the decision DID — "Approved · Revise wiki page" — so
 * the half a person gives their time for was invisible. Chris, 2026-09-18:
 * "as toast in the review queue after action?"*
 *
 * Pure, and in its own file, so the wording is a unit test rather than a
 * screenshot and so a node test never has to pull a toast component in. The
 * one line a decision surface mounts is `showLearnedToast.ts` beside it.
 *
 * Every sentence here is true of what actually happens. A decision with a
 * note becomes a proposed rule through the feedback worker; a decision
 * without one is still counted as agreement or disagreement on the autonomy
 * ladder. Neither is described as more than it is.
 */

import { selfUpdateKind } from '@/libs/actions/selfUpdate';

export type DecisionLearning = {
  title: string;
  description: string;
  /** The run Undo puts back, when the decision executed something reversible. */
  undoRunId?: number;
};

export type DecisionLearningInput = {
  decision: 'approve' | 'reject';
  /** Registered action id, for naming a self-update by its noun. */
  actionId: string;
  /** The `action_run`. */
  runId: number;
  /** Whether the reviewer wrote a reason — a note is what can become a rule. */
  hasNote: boolean;
  /** Whether the run can be put back (only ever meaningful after an approve). */
  undoable: boolean;
};

/**
 * The line a decision surface says once the decision has landed.
 * @param input - What was decided.
 */
export function learnedFromDecision(input: DecisionLearningInput): DecisionLearning {
  const agreed = input.decision === 'approve';
  const ladder = agreed
    ? 'Agreement recorded — evidence this kind climbs the ladder on.'
    : 'Disagreement recorded — this kind keeps asking.';
  const note = input.hasNote
    ? ' Your reason is queued to become a rule if nobody has said it before.'
    : '';
  // A self-update names itself, because "the agent rewrote its own
  // instructions" is the one decision a person will want to recognise later.
  const kind = selfUpdateKind(input.actionId);
  const self = kind ? `A self-update to the ${kind.noun}. ` : '';
  return {
    title: 'Learned from this',
    description: `${self}${ladder}${note}`,
    ...(agreed && input.undoable ? { undoRunId: input.runId } : {}),
  };
}
