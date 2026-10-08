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
 *   - `personalization.enroll` — approving it enrolls a real lead into a
 *     HubSpot sequence that sends real email.
 *   - `objects.propose_candidate` — approving an extracted record is what lets
 *     it be published outside; the moderation loop exists so a human sees
 *     every candidate.
 *   - `source.connect` — approving it saves a source and starts reading the
 *     vendor's data into the workspace at once, then every hour. Undo removes
 *     the source, but not the reads and embeddings already paid for, so a
 *     person confirms which repositories or projects it reads (#1080).
 *   - `phone.place_call` — approving it rings a real person's phone at once,
 *     and a placed call cannot be taken back.
 *
 * Deliberately not configurable. Fails safe — it can only keep an item in the
 * review queue, never release it.
 */
export const NEVER_AUTO_ACTION_IDS: ReadonlySet<string> = new Set([
  'gmail.send',
  'discovery.review_proposal',
  'personalization.enroll',
  'objects.propose_candidate',
  'source.connect',
  'phone.place_call',
]);

/** Grants that put an action on the never-auto list whatever its id. */
export const NEVER_AUTO_GRANTS: ReadonlySet<string> = new Set(['send_email']);

/**
 * Whether the platform holds this action at Execute with approval regardless
 * of any trust rule or promotion.
 * @param action - The registered action's id and grant.
 * @param action.id
 * @param action.grant
 */
export function isNeverAuto(action: { id: string; grant?: string }): boolean {
  return NEVER_AUTO_ACTION_IDS.has(action.id) || (action.grant !== undefined && NEVER_AUTO_GRANTS.has(action.grant));
}
