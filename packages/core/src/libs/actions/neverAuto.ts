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
 *   - `connection.connect_source` — its execute is deliberately inert, because
 *     the credential is supplied under Connectors and an action must never be
 *     the thing that holds one. Auto-approving it would therefore close the
 *     item with nothing connected, which is worse than the silence it replaced:
 *     the queue would show the gap as handled while every run kept answering
 *     short.
 *
 * Deliberately not configurable. Fails safe — it can only keep an item in the
 * review queue, never release it.
 */
export const NEVER_AUTO_ACTION_IDS: ReadonlySet<string> = new Set([
  'gmail.send',
  'discovery.review_proposal',
  'personalization.enroll',
  'objects.propose_candidate',
  'connection.connect_source',
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
