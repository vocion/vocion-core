/**
 * The discovery content gate's release rule, pure and in a leaf, so every
 * reader of it (the transcript tool, the meeting follow-up's reader) shares
 * one rule without loading the discovery tools.
 */

/** Review statuses that mean a person approved the item: approved, running its approval, or done. */
const APPROVED_REVIEW = new Set(['approved', 'executing', 'done']);

/**
 * Whether a candidate's transcript is released — the content gate's rule, pure.
 *
 * A PERSON'S WORD RUNS (2026-10-23, a client's proposal review: the classifier said
 * `drop`, a person approved the review item with route `generate`, and the
 * gate kept refusing because it read the classifier's route off the ledger).
 * The route a person approved is on the review item's own input — edits
 * included — and that is the route that counts; the ledger's route is the
 * classifier's and only stands when no review carries one. And the approval
 * releases while it is still running: the follow-up it starts runs inside the
 * approval, so the item reads `executing` while the writer asks for the
 * transcript.
 * @param c - The candidate.
 * @param c.route - The ledger's route (the classifier's, or the last approval's).
 * @param c.reviewStatus - The review item's status.
 * @param c.reviewRoute - The route on the review item's input.
 */
export function transcriptReleased(c: { route: string | null; reviewStatus: string | null; reviewRoute: string | null }): boolean {
  if (!c.reviewStatus || !APPROVED_REVIEW.has(c.reviewStatus)) {
    return false;
  }
  const route = c.reviewRoute ?? c.route;
  return route === 'generate' || route === 'confirm';
}
