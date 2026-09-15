/**
 * What a reviewer did to a label a proposal wrote about itself: the one place
 * that vocabulary lives.
 *
 * A proposer may judge its own payload: this field is part of a series, this
 * one is the group it belongs to. `proposal.labels` names the fields it
 * decided, and at decide time `ReviewService` compares each of them against
 * what the reviewer left behind. The answer is one of four words, and three
 * different layers need the same four: the service that writes them, the
 * adoption envelope that validates them on the way into `user_activity_event`,
 * and the query that reads them back out of jsonb.
 *
 * Modelled on `suggestedDecision.ts`, and here for the same reason: it imports
 * nothing, so every one of those layers can share it without a cycle, and a
 * fifth verdict is added once rather than in three places that are free to
 * disagree.
 */

/**
 * The four things a reviewer can do to a label.
 *
 * `added` is the odd one out and is deliberately in the list: the reviewer
 * filled in a label the proposer left empty, which is worth counting and is
 * NOT a judgement of anything the agent wrote, so the rate in
 * `AdoptionService.getAgentLabelAgreement` reports it and leaves it out of the
 * denominator.
 */
export const LABEL_VERDICTS = ['kept', 'changed', 'cleared', 'added'] as const;

export type LabelVerdict = typeof LABEL_VERDICTS[number];
