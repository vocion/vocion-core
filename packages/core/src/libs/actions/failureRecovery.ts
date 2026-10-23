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
