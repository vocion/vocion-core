'use client';

import { useCallback, useRef } from 'react';

/**
 * ONE PRESS, ONE DECISION.
 *
 * Chris, 2026-09-29: "I clicked approve. then didn't get an updated ux fast
 * enough. clicked approve again and got this bug. then it turned green, but
 * the error still showed" — the card read "Approved by Chris Fitkin — started
 * the build" AND "Couldn't decide it: action_run 5201 is done — already
 * decided, cannot execute". Two causes, one per helper here:
 *
 * - The busy flag was React state, so the button re-enabled the moment the
 *   request returned, while the card's status still said pending — a second
 *   press sent a second decision. {@link useSingleFlight} holds a ref, set
 *   synchronously on the first press, so a second request cannot start
 *   while the first is in flight, whatever has or has not re-rendered.
 * - The second decision's refusal is not a failure when the run already is
 *   what the person asked for. {@link alreadySettled} reads the server's
 *   refusal (`ActionService`: "action_run N is done — already decided,
 *   cannot execute") and says whether the ask is already met.
 *
 * Shared by the chat card and the review page's decide paths (principle 6).
 */

/** Statuses that mean an approve already landed. */
const APPROVED_STATES: ReadonlySet<string> = new Set(['approved', 'executing', 'done', 'awaiting_execution']);

/**
 * The status an "already decided" refusal names, or null when the message is
 * some other error.
 * @param message - The error's message.
 */
export function alreadyDecidedStatus(message: string | null | undefined): string | null {
  return /\bis ([a-z_]+)\b[^—-]*[—-]\s*already decided/i.exec(message ?? '')?.[1]?.toLowerCase() ?? null;
}

/**
 * Whether a refused decision is already what the person asked for — an
 * approve on a run that is approved, running or done; a reject on a rejected
 * one. Such a refusal is the settled state arriving by another road, not an
 * error to show.
 * @param message - The refusal's message.
 * @param decision - What the person pressed.
 */
export function alreadySettled(message: string | null | undefined, decision: 'approve' | 'reject'): boolean {
  const status = alreadyDecidedStatus(message);
  if (!status) {
    return false;
  }
  return decision === 'approve' ? APPROVED_STATES.has(status) : status === 'rejected';
}

/**
 * Run one async gesture at a time: a call while one is in flight returns
 * undefined without starting anything. The guard is a ref, so it closes
 * before the next render — a double click cannot slip between them.
 */
export function useSingleFlight(): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
  const inFlight = useRef(false);
  return useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) {
      return undefined;
    }
    inFlight.current = true;
    try {
      return await fn();
    } finally {
      inFlight.current = false;
    }
  }, []);
}
