'use client';

import type { ConnectOutcome, ConnectPlanInput } from '@/libs/connect/systemsPlan';

/**
 * WHERE A WALK WAS — "Connect your systems" survives a reload and a trip
 * through the drawer.
 *
 * Founder flow, 2026-10-09, on a phone: at "Connect Gmail? · 3 of 5" a reload
 * (or Review in the drawer and back) dropped the walk; the dock showed the
 * Decision that starts it, "1 of 4 · Start", and Start began again at GitHub
 * with the Later and the Skips forgotten. The walk's place is kept here per
 * conversation, for this browser tab (session storage), and the dock resumes
 * it while the Decision it answers is still open. What each system came to is
 * all a walk needs to pick up where it was (`flow.ts`, `resume`).
 */

export type WalkMemory = {
  input: ConnectPlanInput;
  /** The Decision the walk answers when it finishes. */
  decisionId?: number;
  /** The systems the walk is over, in order (after the question, when there was one). */
  picked?: string[];
  /** What each system came to so far. */
  outcomes: Record<string, ConnectOutcome>;
};

const KEY = 'vocion:connect-walk:';

/**
 * Keep where the walk is.
 * @param conversationId - The conversation it is docked in.
 * @param memory - Where it is.
 */
export function rememberWalk(conversationId: number | null, memory: WalkMemory): void {
  if (conversationId === null) {
    return;
  }
  try {
    globalThis.sessionStorage?.setItem(`${KEY}${conversationId}`, JSON.stringify(memory));
  } catch {
    // Blocked storage: a reload starts the walk from its Decision, as before.
  }
}

/**
 * Where the walk was, or null.
 * @param conversationId - The conversation.
 */
export function recallWalk(conversationId: number | null): WalkMemory | null {
  if (conversationId === null) {
    return null;
  }
  try {
    const raw = globalThis.sessionStorage?.getItem(`${KEY}${conversationId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<WalkMemory>;
    return parsed && typeof parsed === 'object' && parsed.input && typeof parsed.outcomes === 'object' ? (parsed as WalkMemory) : null;
  } catch {
    return null;
  }
}

/**
 * The walk is over (Done, or closed): forget it.
 * @param conversationId - The conversation.
 */
export function forgetWalk(conversationId: number | null): void {
  if (conversationId === null) {
    return;
  }
  try {
    globalThis.sessionStorage?.removeItem(`${KEY}${conversationId}`);
  } catch {
    // Nothing to forget.
  }
}
