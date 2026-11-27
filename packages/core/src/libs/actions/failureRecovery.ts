/**
 * WHETHER A FAILED RUN CAN BE EDITED AND RUN AGAIN.
 *
 * An approved run that failed sits in the queue as `failed`, and its page
 * tells the person what to do: "Reconnect Gmail to allow drafts, then press
 * Create draft in Gmail again". Pressing it again approves with the card's
 * choices (draft or send, an edited body), which is an edit, and an edit used
 * to be refused on anything but `pending`. So the page's own instructions led
 * to "action_run … is failed, not pending — cannot edit".
 *
 * A failure is recoverable when nothing was written and the cause is fixed
 * outside the run: the connection was granted too little or stopped working
 * (`explainPermissionError`), no connection was there at all
 * (`saysConnectionMissing`), or the vendor was briefly unavailable (a 429 or
 * 502–504 in the `<System> … failed: <status>` form the actions' own
 * wrappers write). Anything else may have left a change behind, so it keeps
 * the refusal, with the reason in words.
 *
 * Pure, so the service that enforces it and the tests read the same answer.
 */

import { saysConnectionMissing } from '@/libs/connect/connectionNeeded';
import { explainPermissionError } from '@/libs/connect/permissionError';

export type FailureRecovery
  = | { retryable: true; reason: 'permission' | 'connection' | 'transient' }
    | { retryable: false; why: string };

/** The status the actions' own wrappers put after "failed:" when the vendor was briefly unavailable. */
const TRANSIENT_STATUS = /\bfailed: (?:429|502|503|504)\b/;

/**
 * How a failed run's error reads for a retry.
 * @param actionId - The action that failed, for its connector family.
 * @param error - What the run recorded (`action_run.error`).
 */
export function failureRecovery(actionId: string, error: string | null | undefined): FailureRecovery {
  const text = error ?? '';
  if (explainPermissionError(text, actionId)) {
    return { retryable: true, reason: 'permission' };
  }
  if (saysConnectionMissing(text)) {
    return { retryable: true, reason: 'connection' };
  }
  if (TRANSIENT_STATUS.test(text)) {
    return { retryable: true, reason: 'transient' };
  }
  return {
    retryable: false,
    why: 'it failed in a way Vocion cannot tell is safe to repeat, so it may have changed something already. Decline it and ask for a fresh one',
  };
}

/**
 * How many times one run may be tried without a person, counting the first
 * try. Try again on a card re-runs a run whose failure the action calls safe
 * to repeat; past this many failures the next tap goes to a person in Review
 * instead, so a service that stays down is not hit on every tap.
 */
export const MAX_AUTOMATIC_ATTEMPTS = 3;

/**
 * Whether proposing a failed run again may run it again under the ladder
 * (TRY AGAIN), rather than always putting it in front of a person.
 *
 * Not the same question as {@link failureRecovery}: that one asks whether a
 * person may edit and approve a failed run again. This one asks whether the
 * run may repeat with nobody looking, so only the action itself can say yes
 * (`Action.retryableFailure`), and only a few times.
 * @param action - The run's action.
 * @param action.retryableFailure - Its own word on which failures are safe to repeat.
 * @param error - What the run recorded (`action_run.error`).
 * @param failuresSoFar - Every failed attempt on the run, this one included.
 */
export function mayTryAgainAutomatically(action: { retryableFailure?: (error: string) => boolean }, error: string | null | undefined, failuresSoFar: number): boolean {
  return Boolean(error) && action.retryableFailure?.(error ?? '') === true && failuresSoFar < MAX_AUTOMATIC_ATTEMPTS;
}

/** One earlier attempt at a run that failed, kept when the run is tried again. */
export type FailedAttempt = { at: string; error: string };

/**
 * The run's `result` with its current failure added to `failedAttempts`, so
 * a retry keeps what happened before it. Unchanged when the run has no error.
 * @param result - The run's `result` as stored.
 * @param error - The failure being set aside.
 * @param at - When it failed (the run's `executedAt`), else now.
 */
export function withFailedAttempt(result: Record<string, unknown> | null | undefined, error: string | null | undefined, at: Date | null | undefined): Record<string, unknown> | null {
  if (!error) {
    return result ?? null;
  }
  const earlier = failedAttemptsOf(result);
  return { ...(result ?? {}), failedAttempts: [...earlier, { at: (at ?? new Date()).toISOString(), error }] };
}

/**
 * The earlier failed attempts a run's `result` carries, oldest first.
 * @param result - The run's `result` as stored.
 */
export function failedAttemptsOf(result: Record<string, unknown> | null | undefined): FailedAttempt[] {
  const raw = result?.failedAttempts;
  return Array.isArray(raw)
    ? raw.filter((a): a is FailedAttempt => Boolean(a) && typeof (a as FailedAttempt).at === 'string' && typeof (a as FailedAttempt).error === 'string')
    : [];
}
