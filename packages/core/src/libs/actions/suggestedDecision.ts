/**
 * The agent's recommended decision — the one place its vocabulary lives.
 *
 * An agent has always been able to say how sure it is (`proposal.confidence`),
 * but not what it thinks a person should do. That made agreement impossible to
 * measure honestly: every pending item meant "approve", because an agent only
 * proposes work it wants run, so a reviewer rejecting something the agent also
 * wanted rejected was recorded as a disagreement.
 *
 * This module holds the three values, the parsers every boundary uses — for the
 * recommendation itself and for the short reason an agent gives for it — and
 * the rule for when a recommendation and a human decision count as agreeing. It
 * imports nothing, so the schema, the services, the routers, the adoption
 * queries and the agent tool can all share it without a cycle.
 *
 * What it feeds: the agreement metric, which compares it against the decision
 * a person took, and one fail-safe guard in `ActionService.proposeAction` that
 * keeps a `reject` or `snooze` recommendation out of the trust ladder's reach.
 *
 * The values match the verbs `POST /api/v1/reviews/decide` takes (`approve`,
 * `reject`) plus `snooze`, which is its own endpoint. Matching them on purpose:
 * the whole point is to compare a recommendation against what the person did,
 * and a comparison across two spellings of the same idea invites drift.
 */

/**
 * What an agent can recommend.
 *
 * Advisory in the direction that matters: a recommendation can never release
 * work, and no trust rule reads it to decide that something may run without a
 * person. It can hold work back — `reject` and `snooze` keep an item in the
 * queue however confident the agent was — because the alternative is a rule
 * keyed on confidence running the very thing the agent asked us not to.
 */
export const SUGGESTED_DECISIONS = ['approve', 'reject', 'snooze'] as const;

export type SuggestedDecision = typeof SUGGESTED_DECISIONS[number];

/**
 * How much of a recommendation's reason we keep.
 *
 * Long enough for the sentence a reviewer actually needs — "third listing of
 * this show this week, duplicate of run #412" — and short enough to sit beside
 * the badge on a review card without pushing the payload off the screen. Text
 * past it is trimmed rather than refused: a reason one character over must
 * never cost the card it belongs to.
 */
export const SUGGESTED_DECISION_REASON_MAX = 240;

/**
 * Read the reason a recommendation came with, off untrusted input.
 *
 * Returns undefined for anything that is not usable text, which callers should
 * read as "no reason given" — the same way an absent `suggestedDecision` means
 * no recommendation rather than approval. Whitespace-only text is nothing, and
 * storing it would put an empty quote under a badge on the review card.
 * @param value - Anything; only non-empty text survives.
 */
export function parseSuggestedDecisionReason(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, SUGGESTED_DECISION_REASON_MAX) : undefined;
}

/**
 * Read a suggested decision off untrusted input — a query string, a JSON body,
 * a jsonb blob written by an older release.
 *
 * Returns undefined for anything that is not one of the three values, which
 * callers should read as "no recommendation" rather than as a default. An
 * agent that gave no opinion and an agent that recommended approval are
 * different things, and collapsing them would silently credit every run
 * proposed before this shipped with recommending whatever the reviewer did.
 * @param value - Anything; only the three exact strings are accepted.
 */
export function parseSuggestedDecision(value: unknown): SuggestedDecision | undefined {
  return SUGGESTED_DECISIONS.includes(value as SuggestedDecision)
    ? value as SuggestedDecision
    : undefined;
}

/**
 * The terminal decision a recorded triage signal amounts to, or null when the
 * signal decided nothing.
 *
 * `edited` and `rewritten` map to `approve`: the reviewer reached the same
 * decision the agent recommended and changed the wording on the way. Whether
 * they took the payload as-is is a separate question, and `approvalRate`
 * already answers it — counting a reworded approval as a disagreement here
 * would make the two metrics say the same thing twice.
 *
 * `skipped`, `saved` and `regenerated` leave the item pending, so they decide
 * nothing and stay out of the comparison entirely. Judging an agent on work
 * nobody has finished judging is the same mistake as folding snoozes into the
 * approval rate.
 * @param decision - A `review.decided` decision value.
 */
export function decisionOutcome(decision: string): SuggestedDecision | null {
  switch (decision) {
    case 'approved':
    case 'edited':
    case 'rewritten':
      return 'approve';
    case 'rejected':
      return 'reject';
    default:
      return null;
  }
}
