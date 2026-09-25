/**
 * DEFER — the third answer on every decision card.
 *
 * A gate that offers only Approve and Reject turns "not now" into "no": the
 * person rejects to clear the card, and the agent reads a rejection. Chris's
 * design review of the factory loop (2026-09-24): *a decision card's minimum
 * is Approve, Reject, Defer.* Defer parks the proposal in review with a date
 * it resurfaces on — the same snooze the review queue already has, so the
 * card and the queue agree, and nothing new is invented (principle 7).
 *
 * The date is one path, not a picker: a week out, at nine in the morning
 * where the person is. A picker on a phone is a second decision.
 */

export const DEFER_DAYS = 7;

/**
 * When a deferred card comes back: a week from now at 09:00 local time.
 * @param now - The moment of the decision (injected in tests).
 */
export function deferUntil(now: Date = new Date()): Date {
  const until = new Date(now);
  until.setDate(until.getDate() + DEFER_DAYS);
  until.setHours(9, 0, 0, 0);
  return until;
}

/**
 * The sentence the card shows once deferred — a date a person can hold, not an ISO stamp.
 * @param until - When it resurfaces.
 */
export function deferredLine(until: Date): string {
  const day = until.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `Deferred — back in review ${day}.`;
}
