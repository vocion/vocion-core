/**
 * Actions no trust rule may ever release without a person.
 *
 * The one list, read by `ActionService.proposeAction` (the gate) and by the
 * autonomy ladder (which caps these at Execute with approval and says why on
 * `/dashboard/autonomy`), so the page can never promise an automation the
 * gate would refuse.
 *
 * Why each is here:
 *   - `gmail.send`, and any action carrying the `send_email` grant — an
 *     outbound send to a real person; a misconfigured or over-eager threshold
 *     must never be able to fire an email on its own.
 *   - `discovery.review_proposal` — approving it starts the follow-up
 *     workflow, which drafts an email in the seller's voice. Supervised v1
 *     means a human confirms every detected discovery call, and that is the
 *     calibration data the loop is built on.
 *   - `meeting.draft_followup` — approving it releases a call's record to an
 *     agent and starts a draft in the seller's voice. The release is the
 *     person's, the same privacy rule the discovery lane keeps.
 *   - `personalization.enroll` — approving it enrolls a real lead into a
 *     HubSpot sequence that sends real email.
 *   - `objects.propose_candidate` — approving an extracted record is what lets
 *     it be published outside; the moderation loop exists so a human sees
 *     every candidate.
 *   - `source.connect` — approving it saves a source and starts reading the
 *     vendor's data into the workspace at once, then every hour. Undo removes
 *     the source, but not the reads and embeddings already paid for, so a
 *     person confirms which repositories or projects it reads (#1080).
 *
 * Deliberately not configurable. Fails safe — it can only keep an item in the
 * review queue, never release it.
 *
 * AN ACTION THAT SAYS A PERSON DECIDES IS HELD THE SAME WAY (2026-10-30). An
 * action declaring `approvalRequired` or `requiresReviewDecision` is never run
 * by the ladder, at any rung, confidence or trust rule: the flag on the action
 * is the one source of truth (`personDecidesEveryRun`), and this list is for
 * the platform's own categories on top of it. Before this, `approvalRequired`
 * only made a run wait for a decision, and a trust rule or a promoted rung
 * could then make that decision itself — on a Google Ads budget, a journal
 * entry or a batch of declines.
 */
export const NEVER_AUTO_ACTION_IDS: ReadonlySet<string> = new Set([
  'gmail.send',
  'discovery.review_proposal',
  'meeting.draft_followup',
  'personalization.enroll',
  'objects.propose_candidate',
  'source.connect',
]);

/** Grants that put an action on the never-auto list whatever its id. */
export const NEVER_AUTO_GRANTS: ReadonlySet<string> = new Set(['send_email']);

/** What the guard reads off an action: its id, grant and the two flags that say a person decides. */
type NeverAutoFacts = { id: string; grant?: string; approvalRequired?: boolean; requiresReviewDecision?: boolean };

/**
 * Whether the action itself says a person decides every run an agent
 * proposes: `approvalRequired`, or `requiresReviewDecision` (which also keeps
 * chat intent from standing in for the card). No exception reaches these.
 * @param action - The registered action.
 */
export function personDecidesEveryRun(action: Pick<NeverAutoFacts, 'approvalRequired' | 'requiresReviewDecision'>): boolean {
  return action.approvalRequired === true || action.requiresReviewDecision === true;
}

/**
 * Whether the platform holds this action at Execute with approval regardless
 * of any trust rule or promotion: the action says a person decides, or it is
 * on the platform's list.
 * @param action - The registered action's id, grant and flags.
 */
export function isNeverAuto(action: NeverAutoFacts): boolean {
  return personDecidesEveryRun(action) || NEVER_AUTO_ACTION_IDS.has(action.id) || (action.grant !== undefined && NEVER_AUTO_GRANTS.has(action.grant));
}
