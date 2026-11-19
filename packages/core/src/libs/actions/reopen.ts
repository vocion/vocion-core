/**
 * Whether a rejected action run can go back to the review queue — the rule
 * behind `POST /api/v1/reviews/reopen`, kept as plain functions so it is
 * tested on its own.
 *
 * A reject is reversible when everything it changed can be put back:
 *
 * - the run row (status, error, decidedBy/decidedAt, approvedByAgent), which
 *   the reopen writes back to the pending shape `proposeAction` gives a run;
 * - the action's own `onRejected` effect, which only the action can undo, so
 *   an action with that hook needs `onReopened` beside it.
 *
 * What a reject leaves elsewhere is evidence, not state, and is deliberately
 * not rewritten: the `decision_alignment` row (append-only), the
 * `review.decided` adoption event, the learning episode, and any feedback job
 * the reviewer's reason queued (a candidate a person still adopts or rejects).
 */

import { decidedByMachine } from './decider';

/** `libs/needsYou/deadlines.ts` `DEFAULT_DECIDER`, repeated so this module imports no service. */
const DECLINED_BY_DEFAULT = 'by-default';

/** The run as the reopen reads it. */
export type ReopenSubject = {
  status: string;
  decidedBy: string | null;
  result: Record<string, unknown> | null;
  expiresAt: Date | null;
};

/** Why a run cannot be reopened, as the route reports it. */
export type ReopenRefusal = {
  /** `INVALID_STATE`: not rejected now. `NOT_REOPENABLE`: rejected, but this reject cannot be taken back. */
  code: 'INVALID_STATE' | 'NOT_REOPENABLE';
  message: string;
};

/** What the action declares about undoing its own reject. */
export type ReopenHooks = { onRejected?: unknown; onReopened?: unknown };

/**
 * The refusal for reopening this run, or null when it can be reopened.
 * @param runId - For the message.
 * @param run - The stored run.
 * @param action - The registered action, or undefined when it is no longer registered.
 * @param now - The current time.
 */
export function reopenRefusal(runId: number, run: ReopenSubject, action: ReopenHooks | undefined, now: Date): ReopenRefusal | null {
  if (run.status !== 'rejected') {
    return { code: 'INVALID_STATE', message: `action_run ${runId} is ${run.status} — only a rejected run can be reopened` };
  }
  // A machine's rejection (a budget retiring a card, a gate returning it, a
  // sweep, a deadline default) is not a person's decision to take back, and
  // reopening it would walk past the rule that made it.
  if (decidedByMachine(run.decidedBy) || run.decidedBy === DECLINED_BY_DEFAULT) {
    return { code: 'NOT_REOPENABLE', message: `action_run ${runId} was rejected by ${run.decidedBy}, not a person — it cannot be reopened` };
  }
  // A result means the run executed before it was rejected; going back to
  // pending would offer to run it again.
  if (run.result !== null) {
    return { code: 'NOT_REOPENABLE', message: `action_run ${runId} executed before it was rejected — it cannot be reopened` };
  }
  if (!action) {
    return { code: 'NOT_REOPENABLE', message: `action_run ${runId}'s action is no longer registered — it cannot be reopened` };
  }
  if (action.onRejected && !action.onReopened) {
    return { code: 'NOT_REOPENABLE', message: `action_run ${runId}'s rejection changed a record its action cannot put back — it cannot be reopened` };
  }
  // An expired run would be pending and still never reach the queue.
  if (run.expiresAt !== null && run.expiresAt.getTime() <= now.getTime()) {
    return { code: 'NOT_REOPENABLE', message: `action_run ${runId} expired on ${run.expiresAt.toISOString()} — it cannot be reopened` };
  }
  return null;
}

/** The record of one reopen, kept on the run's proposal envelope. */
export type ReopenRecord = {
  by: string;
  at: string;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
};

/**
 * The proposal envelope with this reopen recorded on it. Earlier reopens of
 * the same run are kept, oldest first.
 * @param proposal - The stored envelope.
 * @param record - This reopen.
 */
export function withReopenRecord(proposal: Record<string, unknown> | null, record: ReopenRecord): Record<string, unknown> {
  const earlier = Array.isArray(proposal?.reopened) ? proposal.reopened as ReopenRecord[] : [];
  return { ...(proposal ?? {}), reopened: [...earlier, record] };
}

/**
 * The envelope a refresh stores, with the reopen record of the run it
 * replaces carried over. A re-proposal replaces the envelope wholesale, and
 * without this the record of who reopened the run would go with it.
 * @param previous - The envelope stored on the open run.
 * @param next - The envelope the refresh would store.
 */
export function carryReopenRecord(previous: Record<string, unknown> | null, next: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!Array.isArray(previous?.reopened) || next?.reopened !== undefined) {
    return next;
  }
  return { ...(next ?? {}), reopened: previous.reopened };
}
