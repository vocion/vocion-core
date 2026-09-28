/**
 * A CLAIM OF A WRITE WITH NO WRITE BEHIND IT — said, in code.
 *
 * Finding 23 (2026-09-25, conversation 225, the MCP door on d82c353e): the
 * product manager ended a turn "**Filed:** Request recorded for Send…
 * Architecture plan queued". Nothing had run: no card, no action_run, no
 * record in the window. The skill already says "never say filed before the
 * call returns"; a prompt line is the weakest lever there is (CLAUDE.md,
 * "structural over prompting"), so this is the structure.
 *
 * Deterministic and strict on purpose. It fires only when BOTH hold:
 *
 *   1. the answer states a write as done, in the shapes real turns use — a
 *      status label (a bold "Filed:", "Recorded." at the start of a line) or a
 *      first-person past tense ("I filed", "I've created"); and
 *   2. no write tool SUCCEEDED in the turn. A refused card (`ok: false`) or a
 *      failed call is not a write.
 *
 * When it fires, one sentence is appended saying nothing was saved in this
 * turn. It never rewrites the model's words: the transcript keeps what was
 * said, and the correction under it is what is true. The sentence is about
 * THIS turn only, so it stays true when the claim meant an earlier one.
 */

export type WriteClaimToolCall = { tool: string; output?: string };

/**
 * Tool-name verbs that change state. A closed list read from the registry;
 * a read tool never starts with one of these.
 */
const WRITE_VERB = /^(?:add|apollo_add|apollo_remove|create|decide|edit|export|file|publish|queue|recommend|propose|record|red_team|remember|remove|render_document|request|save|unfile|update|withdraw|write)(?:_|$)/;

/**
 * Is this tool one that changes state?
 * @param tool - The tool name.
 */
export function isWriteTool(tool: string): boolean {
  return WRITE_VERB.test(tool);
}

/**
 * Did the call fail or get refused, by the shapes tools return?
 * @param output - The tool output.
 */
function failed(output: string | undefined): boolean {
  if (!output) {
    return false;
  }
  const head = output.trimStart().slice(0, 200);
  return /"ok"\s*:\s*false/.test(head) || /^(?:error|failed|refused)\b/i.test(head);
}

/**
 * Did any write succeed in this turn?
 * @param toolCalls - The turn's tool calls.
 */
export function wroteInTurn(toolCalls: ReadonlyArray<WriteClaimToolCall>): boolean {
  return toolCalls.some(c => isWriteTool(c.tool) && !failed(c.output));
}

const DONE_WORDS = 'filed|recorded|created|logged|submitted|saved|queued|opened';

/** A bold "Filed:" or "Filed", or "Filed:" / "Recorded." at the start of a line. */
const STATUS_LABEL = new RegExp(`(?:\\*\\*|^\\s*(?:[-*]\\s+)?)(?:${DONE_WORDS})(?:\\*\\*\\s*[:.—-]|\\s*[:.—-]\\s*\\*\\*|\\s*:)`, 'im');

/**
 * A bare "Filed." or "Filed —" opening a line: conversation 349's second
 * turn (2026-09-28) began "Filed. The request card is on your screen" with no
 * write and no card, and the bold-only label above let it through.
 */
const BARE_LABEL = new RegExp(`^\\s*(?:[-*]\\s+)?(?:${DONE_WORDS})(?:\\.|\\s+[—–-])(?:\\s|$)`, 'im');

/**
 * A card said to be in front of the person: "the request card is on your
 * screen", "the card is below". True only when a card was put up.
 */
const CARD_CLAIM = /\b(?:the|your|a)\s+(?:[\w-]+\s+){0,2}card\s+(?:is|was)\s+(?:now\s+)?(?:on your screen|on screen|below|above|up|ready)\b/i;

/** "I filed", "I've filed", "I have created", "I just logged". */
const FIRST_PERSON = new RegExp(`\\bI(?:'ve|\\s+have)?(?:\\s+(?:just|now|already))?\\s+(?:${DONE_WORDS})\\b`, 'i');

/** "The call returned", "Fields written on request #30" — mission run 5074 (2026-09-25). */
const REPORTED_WRITE = /\b(?:the (?:call|update|write) (?:returned|succeeded|went through)|fields? (?:written|updated|saved))\b/i;

/**
 * The sentence in the answer that claims a write, or null.
 * @param text - The answer as it stands.
 */
export function writeClaim(text: string): string | null {
  for (const pattern of [STATUS_LABEL, BARE_LABEL, FIRST_PERSON, REPORTED_WRITE]) {
    const match = pattern.exec(text ?? '');
    if (match) {
      return match[0].trim();
    }
  }
  return null;
}

/** What the person reads under an unbacked claim. */
export const UNBACKED_WRITE_NOTICE = 'Nothing was saved in this turn, so what is described above as filed has not happened yet.';

/**
 * The sentence that says a card is on screen, or null.
 * @param text - The answer as it stands.
 */
export function cardClaim(text: string): string | null {
  return CARD_CLAIM.exec(text ?? '')?.[0].trim() ?? null;
}

/**
 * The correction to append, or null when the answer claims no write or a
 * write ran. A claim that a card is on screen counts too, when no card was
 * put up and nothing was written.
 * @param text - The answer as it stands.
 * @param toolCalls - The turn's tool calls.
 * @param cardsShown - Cards the turn put in front of the person; undefined when the caller cannot say.
 */
export function unbackedWriteNotice(text: string, toolCalls: ReadonlyArray<WriteClaimToolCall>, cardsShown?: number): string | null {
  if (wroteInTurn(toolCalls)) {
    return null;
  }
  const claimed = writeClaim(text) !== null || (cardsShown === 0 && cardClaim(text) !== null);
  return claimed ? UNBACKED_WRITE_NOTICE : null;
}
