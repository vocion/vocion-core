/**
 * Review is how the workforce earns autonomy.
 *
 * Chris, 2026-09-21: if a person approves three low-risk requester
 * notifications unchanged, do not report three successful approvals. Report
 * that the same judgment has now been made three times the same way, and
 * offer to stop asking.
 *
 *     You approved this kind of action unchanged 3 times.
 *     Recommend allowing requester notifications automatically.
 *     [Allow automatically]  [Keep asking]
 *
 * So after every decision the system asks itself one internal question: was
 * that judgment REUSABLE? A judgment is reusable when the same class of thing
 * was decided the same way, repeatedly, with nothing edited, and the
 * consequence of getting it wrong is low and reversible. Any one of those
 * failing means it is not a rule yet, and the honest answer is to keep asking.
 *
 * The rule is deliberately unforgiving about edits and reversals. An edited
 * approval is a person disagreeing in detail, and a rejection anywhere in the
 * run is a person disagreeing outright; either one resets the count, because
 * the whole point is that the system only stops asking where it has been
 * demonstrably right.
 *
 * Pure: no database, no clock.
 */

import type { Consequence } from '@/services/inbox/decisionBrief';

/** How many identical judgments in a row earn a proposal to stop asking. */
export const AUTONOMY_THRESHOLD = 3;

/** One decision already made, as the ledger remembers it. */
export type SettledJudgment = {
  /**
   * What KIND of thing this was: an action id (`notify.requester`), or an ask
   * kind plus its topic. Two judgments are comparable only inside one class.
   */
  class: string;
  /** How the class reads to a person: "requester notifications". */
  label: string;
  /** What was chosen. `approved` and `rejected` are the two that count. */
  outcome: string;
  /** True when the person altered what was proposed, or attached a note that changed it. */
  edited: boolean;
  /** How much was at stake. Only a low, reversible consequence can become a rule. */
  consequence: Pick<Consequence, 'level' | 'reversible'>;
  at: Date;
};

/** An offer to stop asking, with everything a person needs to say yes or no. */
export type AutonomyProposal = {
  class: string;
  label: string;
  /** How many consecutive identical, unedited judgments back it. */
  count: number;
  outcome: string;
  /** The sentence at the top: what you did. */
  observation: string;
  /** The sentence under it: what the system proposes. */
  proposal: string;
  /** Exactly two, and the first is the one being recommended. */
  choices: { id: string; label: string }[];
  /** When the run of identical judgments started and ended. */
  since: Date;
  until: Date;
};

/** Why a class did NOT earn autonomy, so the reasoning is inspectable. */
export type AutonomyHold = { class: string; reason: string };

/**
 * Read the settled decisions and propose, per class, that the system stop
 * asking.
 *
 * Only the most recent unbroken run counts. Reaching the threshold once and
 * then being overruled does not leave a standing proposal: the run is broken
 * and the count starts again, which is what makes the offer trustworthy.
 * @param history - Decisions already made, in any order.
 */
export function autonomyProposals(history: SettledJudgment[]): { proposals: AutonomyProposal[]; holds: AutonomyHold[] } {
  const byClass = new Map<string, SettledJudgment[]>();
  for (const j of history) {
    byClass.set(j.class, [...(byClass.get(j.class) ?? []), j]);
  }

  const proposals: AutonomyProposal[] = [];
  const holds: AutonomyHold[] = [];

  for (const [cls, all] of [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...all].sort((a, b) => a.at.getTime() - b.at.getTime());
    const newest = ordered[ordered.length - 1]!;

    // Walk backwards while the judgment is the same one, made the same way.
    const run: SettledJudgment[] = [];
    for (let i = ordered.length - 1; i >= 0; i--) {
      const j = ordered[i]!;
      if (j.outcome !== newest.outcome || j.edited) {
        break;
      }
      run.unshift(j);
    }

    const blocker = holdReason(run, newest);
    if (blocker) {
      holds.push({ class: cls, reason: blocker });
      continue;
    }

    const verb = newest.outcome === 'approved' ? 'approved' : 'rejected';
    const doing = newest.outcome === 'approved' ? `allowing ${newest.label} automatically` : `declining ${newest.label} automatically`;
    proposals.push({
      class: cls,
      label: newest.label,
      count: run.length,
      outcome: newest.outcome,
      observation: `You ${verb} this kind of action unchanged ${run.length} times.`,
      proposal: `Recommend ${doing}.`,
      choices: [
        { id: 'allow-automatically', label: newest.outcome === 'approved' ? 'Allow automatically' : 'Decline automatically' },
        { id: 'keep-asking', label: 'Keep asking' },
      ],
      since: run[0]!.at,
      until: newest.at,
    });
  }
  return { proposals, holds };
}

/**
 * Why this class stays in Review, or null when it has earned its way out.
 * @param run - The unbroken run of identical, unedited judgments.
 * @param newest - The most recent judgment in the class.
 */
function holdReason(run: SettledJudgment[], newest: SettledJudgment): string | null {
  if (newest.edited) {
    return 'The last one was changed before it was approved, so the judgment is not yet the system’s to make.';
  }
  if (run.length < AUTONOMY_THRESHOLD) {
    return `${run.length} of ${AUTONOMY_THRESHOLD} identical decisions so far.`;
  }
  if (run.some(j => j.consequence.level !== 'low')) {
    return 'Not every one of these was low consequence, and a rule is only as safe as its worst case.';
  }
  if (run.some(j => !j.consequence.reversible)) {
    return 'At least one of these could not have been undone, so it stays a decision.';
  }
  return null;
}
