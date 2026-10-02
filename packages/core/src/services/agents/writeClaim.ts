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
/**
 * A write tool's answer that says it did not write. Conversation 382
 * (2026-09-29): "Proposal #5232 is not yours to withdraw.", a card "not put
 * up: … declares no field "scope"", and "Received tool input did not match
 * expected schema" all counted as writes, so the claim check stayed quiet
 * over "Expanded #201" when nothing had been written. An empty answer is not
 * a receipt either.
 */
const DID_NOT_WRITE = /^(?:error|failed|refused|not (?:put up|proposed|recorded|written|filed|saved)|update (?:refused|failed)|proposal (?:failed|refused)|received tool input did not match|could not|couldn'?t|cannot|can'?t)\b|\bis not yours to\b|\bdid not land\b/i;

function failed(output: string | undefined): boolean {
  const head = (output ?? '').trimStart().slice(0, 200);
  if (!head) {
    return true;
  }
  return /"ok"\s*:\s*false/.test(head) || DID_NOT_WRITE.test(head);
}

/**
 * Did this one call write something — a write tool, not refused or failed?
 * @param call - One tool call.
 */
export function writeLanded(call: WriteClaimToolCall): boolean {
  return isWriteTool(call.tool) && !failed(call.output);
}
