/**
 * Which thread a chat surface opens with (agent-chat-surface.md §9, added
 * 2026-09-15): a NEW conversation, unless the person is intentionally coming
 * back to one. "Intentionally" means one of three things and nothing else —
 *
 *   1. this browser session was already in the thread (the tab moved from the
 *      full page to a record and back; sessionStorage remembers), or
 *   2. the URL names it (`?conversation=<id>` — a link someone shared or a
 *      history row the person picked), or
 *   3. the person picks it from the history popover (handled at pick time).
 *
 * The last-viewed pointer (`chat_widget_state`, localStorage) is "recent", not
 * "current": it seeds the history list and the agent, never the transcript.
 * Landing on yesterday's thread was the reported bug; this is the fix.
 */

export type ResumeDecision
  = | { resume: true; conversationId: number; reason: 'session' | 'url' }
    | { resume: false; reason: 'fresh' };

/**
 * Decide whether to resume, and which thread.
 * @param input
 * @param input.explicitId - A conversation id named by the URL, if any.
 * @param input.sessionId - The thread this browser session was already in for the agent, if any.
 */
export function decideResume(input: { explicitId: number | null; sessionId: number | null }): ResumeDecision {
  if (input.explicitId !== null && Number.isInteger(input.explicitId) && input.explicitId > 0) {
    return { resume: true, conversationId: input.explicitId, reason: 'url' };
  }
  if (input.sessionId !== null && Number.isInteger(input.sessionId) && input.sessionId > 0) {
    return { resume: true, conversationId: input.sessionId, reason: 'session' };
  }
  return { resume: false, reason: 'fresh' };
}

const SESSION_KEY = 'vocion:chat:session:';

/**
 * The thread this browser SESSION is in for an agent — sessionStorage, so it
 * dies with the tab and never reaches across days.
 * @param agentSlug
 */
export function readSessionConversation(agentSlug: string): number | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY + agentSlug);
    const id = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Remember (or forget, with null) the thread this session is in for an agent.
 * @param agentSlug
 * @param id
 */
export function writeSessionConversation(agentSlug: string, id: number | null): void {
  try {
    if (id === null) {
      sessionStorage.removeItem(SESSION_KEY + agentSlug);
    } else {
      sessionStorage.setItem(SESSION_KEY + agentSlug, String(id));
    }
  } catch {
    /* storage unavailable — continuity within this tab is lost, nothing else */
  }
}

/**
 * The `?conversation=` deep link, parsed defensively.
 * @param value - The raw query value.
 */
export function parseConversationParam(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}
