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

/** "I filed", "I've filed", "I have created", "I just logged". */
const FIRST_PERSON = new RegExp(`\\bI(?:'ve|\\s+have)?(?:\\s+(?:just|now|already))?\\s+(?:${DONE_WORDS})\\b`, 'i');

/**
 * The sentence in the answer that claims a write, or null.
 * @param text - The answer as it stands.
 */
export function writeClaim(text: string): string | null {
  for (const pattern of [STATUS_LABEL, FIRST_PERSON]) {
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
 * The correction to append, or null when the answer claims no write or a
 * write ran.
 * @param text - The answer as it stands.
 * @param toolCalls - The turn's tool calls.
 */
export function unbackedWriteNotice(text: string, toolCalls: ReadonlyArray<WriteClaimToolCall>): string | null {
  if (!writeClaim(text) || wroteInTurn(toolCalls)) {
    return null;
  }
  return UNBACKED_WRITE_NOTICE;
}
