/**
 * How an assistant turn ended (#114).
 *
 * `conversation_message.status` used to hold one value, `incomplete`, and NULL
 * for everything else — which meant NULL was standing in for *finished*, *the
 * person pressed Stop*, *a surface cut it off at a time limit*, *the budget
 * was spent* and *this row is the back half of a split answer*, all rendered
 * the same way and all replayed to the model the same way. This is the
 * vocabulary that replaced it.
 *
 * Three things read a status, and they want different answers, so each value
 * below is defined by what it changes:
 *   - what the person reads under the turn (`AgentMessage`),
 *   - whether the text is replayed to the model next turn (`toHistoryTurns`),
 *   - what a count of failed turns means.
 *
 * Every agent turn written from here on carries one of these — `appendMessage`
 * fills in `complete` when a caller names nothing. NULL means one of the two
 * rows that never had an ending to record: a message a person typed, or an
 * agent turn written before this vocabulary existed. Both read as `complete`,
 * which is what the old ones were.
 */

/**
 * Every way an assistant turn can end.
 *
 * A list rather than a bare union so the same set can be checked at runtime:
 * `appendMessage` takes a status from callers TypeScript cannot always see,
 * and a word no reader knows would be treated as an ordinary finished turn —
 * no notice, replayed as history, counted as healthy. Silence is the worst
 * failure this column can have.
 *
 *   - `complete`: the turn ran to the end and the answer is whole.
 *   - `incomplete`: the run threw with text already streamed, so what is
 *     stored stops mid-thought.
 *   - `failed`: the run threw before it said anything. The row exists so the
 *     turn does not vanish, but it holds nothing.
 *   - `refused`: never attempted — budget spent, policy said no. Not a fault,
 *     and not something asking again will fix.
 *   - `stopped`: the person pressed Stop. The text is short because they chose
 *     that, not because anything broke.
 *   - `truncated`: a surface cut the turn off at its own time limit (the MCP
 *     `ask_workspace` tool). The rest arrives as a `continued` row.
 *   - `continued`: the rest of an answer whose first half was `truncated` —
 *     one turn, two rows.
 *   - `stalled`: the model did work and then ended the turn without answering
 *     — "I'll check what that page is.", "Reading", and nothing after it. The
 *     run did not throw and nothing was cut off, so every other value here
 *     would call it finished; what the person gets is an empty answer under a
 *     spinner that stopped, and their only move is to ask again. Chris hit it
 *     twice in a row on a phone and it happened four times running to a
 *     reviewer that had already read the record it was asked to grade.
 */
export const TURN_STATUSES = [
  'complete',
  'incomplete',
  'failed',
  'refused',
  'stopped',
  'truncated',
  'continued',
  'stalled',
] as const;

/** How an assistant turn ended. */
export type TurnStatus = typeof TURN_STATUSES[number];

/**
 * Statuses whose text is NOT handed back to the model as history.
 *
 * The test is not "did something go wrong" but "would replaying this teach the
 * model something false". A sentence that stops mid-word reads as a finished
 * thought once it is in the history; a turn that never ran has no text worth
 * replaying; a refusal is about the workspace, not the conversation. A turn
 * the person stopped on purpose is NOT here: they read it and decided that was
 * enough, which makes it part of the conversation.
 */
const DROPPED_FROM_HISTORY = new Set<TurnStatus>(['incomplete', 'failed', 'refused', 'stalled']);

/**
 * Should this row's text be left out of the history the next turn replays?
 * @param status - The row's stored status; NULL/unknown means a legacy row, which is treated as complete.
 * @returns True when the text must not be replayed to the model.
 */
export function isDroppedFromHistory(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && DROPPED_FROM_HISTORY.has(status as TurnStatus);
}

/**
 * Did this turn end in a way the person should be told about?
 *
 * `stopped`, `truncated` and `continued` are ordinary endings with their own
 * quiet markers; `complete` and a legacy NULL say nothing at all.
 * @param status - The row's stored status.
 * @returns True for the endings that need an explanation, not just a marker.
 */
export function isFailure(status: string | null | undefined): boolean {
  return status === 'incomplete' || status === 'failed' || status === 'refused' || status === 'stalled';
}

/**
 * HOW MANY CHARACTERS COUNT AS AN ANSWER.
 *
 * Deliberately a length and not a shape. A turn that stopped short says "I'll
 * check what that page is." or "Reading"; a turn that answered says more than
 * that even when the answer is short. Reading the WORDS for an intention —
 * matching "let me", "I'll check", "looking at" — is the prompt-shaped
 * version of this check and would be wrong on "Yes, it merged." every time it
 * is wrong at all.
 */
const ANSWER_FLOOR = 120;

/**
 * Did the model do work and then end the turn without answering?
 *
 * Both halves are needed. Tool calls with no answer is the failure; a short
 * answer to a short question is not (`"Yes — PR #16 merged on Sunday."`), and
 * neither is a turn that called nothing and replied briefly.
 * @param turn - What the turn produced.
 * @param turn.text - The assistant's prose, as stored.
 * @param turn.toolCalls - How many tool steps the turn ran.
 * @returns True when the turn worked and never said what it found.
 */
export function stoppedShort(turn: { text: string; toolCalls: number }): boolean {
  const text = turn.text.trim();
  // Nothing at all — no words, whatever ran — is the emptiest answer there is
  // (MCP turns 667/675, 2026-09-25: two reasoning nodes, zero characters).
  if (text.length === 0) {
    return true;
  }
  // "Let me look" with NO tool call behind it is the emptiest stall of all
  // (production turn 577, 2026-09-24): a promise, then silence.
  if (text.length > 0 && preambleOnly(text)) {
    return true;
  }
  return turn.toolCalls > 0 && text.length < ANSWER_FLOOR;
}

/**
 * The openers of a sentence that PROMISES an answer instead of giving one:
 * "I'll pull what's on record…", "Let me check…", "Pulling the records…".
 *
 * The length rule above is the right first half, and it was defeated on
 * 2026-09-24: production turn 563 was two such sentences, 154 characters, and
 * counted as complete, so the answer pass never fired and a bug report was
 * never triaged. This is the narrow second half — it fires only when EVERY
 * sentence is a promise, so "Yes, it merged." and "Let me check. No, Send
 * has no SSO." are both still answers.
 */
const PREAMBLE_OPENERS = /^(?:i(?:['’]ll| will| am going to| need to| want to)\s|let me\s|(?:first|now|next),?\s+(?:i(?:['’]ll| will)\s|let me\s)|(?:pulling|checking|reading|looking|fetching|gathering|querying|searching|retrieving|loading|opening)\b)/i;

/**
 * True when every sentence of the text is a preamble — a promise to look,
 * with nothing found yet.
 * @param text - The turn's finished text.
 */
export function preambleOnly(text: string): boolean {
  const sentences = text
    .replace(/<[^>]*>/g, ' ')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences.length > 0 && sentences.every(s => PREAMBLE_OPENERS.test(s));
}

/**
 * Is this one of the endings this product knows about?
 * @param status - A candidate value, from anywhere.
 * @returns True when it is a status every reader here understands.
 */
export function isTurnStatus(status: unknown): status is TurnStatus {
  return typeof status === 'string' && (TURN_STATUSES as readonly string[]).includes(status);
}
