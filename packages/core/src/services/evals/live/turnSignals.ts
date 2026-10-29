/**
 * WHAT A TURN DID WRONG THAT CAN BE READ OFF THE TURN ITSELF (ADR 0010).
 *
 * Pure, no model call: the same detectors grade the `agent-behaviour` eval
 * against made-up data and flag live turns as they finish, so a number on
 * the scoreboard and a number in the eval mean the same thing.
 *
 * Three signals, each a failure a person has hit:
 *   - `toolFailures`: three or more tool calls failed in one turn. One bad
 *     argument that is corrected is normal; three is an agent flailing.
 *   - `refusedWithAction`: the answer says it cannot do something while a
 *     path to act (an action or proposal tool) was there to take, and none
 *     was taken. The 2026-10-28 shape: "I don't have a tool to update
 *     HubSpot" from an agent that had one, deferred.
 *   - `claimedSave`: "noted", "I'll remember" with no call that saves. The
 *     person believes something was kept that was not.
 *
 * They are heuristics over text. A flag is a turn worth reading, not a
 * verdict; the eval's cases are what pin the patterns down.
 */

/**
 * "I can't", "I don't have a tool", "you'll need to do it yourself": an
 * answer that declines for want of the ability. A question back or a
 * confirmation request is not a refusal.
 */
const REFUSAL = /\b(?:I\s+(?:(?:can(?:'|’)?t|cannot|am\s+(?:not\s+able|unable)\s+to)\s+(?:directly\s+|actually\s+)?(?:update|change|edit|write|make|create|save|remember|store|keep|carry|persist|execute|perform|run|apply|push|submit|file|modify|set|add|move|delete|send|schedule|track|post|log|record|do\s+(?:that|this|it))\b|(?:do\s+not|don(?:'|’)t)\s+have\s+(?:a\s+|the\s+|any\s+)?(?:tool|ability|access|way|capabilit))|(?:not|isn(?:'|’)t)\s+(?:something|an\s+action)\s+I\s+(?:can|take)|you(?:'|’)ll\s+(?:need|have)\s+to\s+(?:do|make|update|change)\s+(?:it|that|this|the)|outside\s+(?:of\s+)?(?:my|what\s+I)|no\s+(?:tool|way)\s+(?:to|for))/i;

/**
 * Whether an answer declines for want of the ability.
 * @param answer - The turn's final text.
 */
export function isRefusal(answer: string): boolean {
  return REFUSAL.test(answer);
}

/**
 * "Noted.", "I've saved that", "I'll remember", "I'll keep that in mind",
 * "I'll use that going forward": the answer says something was kept.
 */
const SAVE_CLAIM = /(?:^|[\s"'(])noted\b|\bI(?:'|’)ve\s+(?:noted|saved|stored|recorded|remembered|made\s+a\s+note|added\s+(?:that|this|it)\s+to\s+(?:my\s+)?memory)\b|\bI(?:'|’)ll\s+(?:remember|keep\s+(?:that|this|it)\s+in\s+mind|use\s+(?:that|this)\s+going\s+forward)\b|\bI\s+will\s+(?:remember|keep\s+(?:that|this|it)\s+in\s+mind)\b|\bgot\s+it\b[^.!\n]{1,40}\bremember\b|\bI(?:'|’)ll\b[^.!?\n]{1,80}\b(?:from\s+(?:here|now)\s+on|going\s+forward)\b|\b(?:from\s+(?:here|now)\s+on|going\s+forward),?\s+I(?:'|’)ll\b/i;

/** "I can't save that": an honest refusal, which the refusal check counts instead. */
const SAVE_DISCLAIMED = /\bI\s+(?:can(?:'|’)?t|cannot|am\s+unable\s+to)\s+(?:save|store|remember|keep)\b/i;

/**
 * Whether an answer says something was kept for later.
 * @param answer - The turn's final text.
 */
export function claimsSave(answer: string): boolean {
  return SAVE_CLAIM.test(answer) && !SAVE_DISCLAIMED.test(answer);
}

/** Tools that keep something for later turns: a preference, a rule, a page. */
export const SAVE_TOOLS: ReadonlySet<string> = new Set(['remember_preference', 'add_learning', 'update_learning', 'write_wiki_page', 'write_playbook', 'update_mission_notes']);

/** Tools that act on the person's request: the action and proposal path. */
export const ACTION_TOOLS: ReadonlySet<string> = new Set(['recommend_action', 'propose_action', 'file_ask']);

/** How many failed calls in one turn make it a `toolFailures` turn. */
export const FAILED_TOOLS_THRESHOLD = 3;

export type TurnSignalName = 'toolFailures' | 'refusedWithAction' | 'claimedSave';

/** What a turn did, as the detectors read it. */
export type TurnForSignals = {
  answer: string;
  calls: ReadonlyArray<{ tool: string; error: boolean }>;
  /** Every tool the turn could reach, loaded or deferred behind search. */
  available: Iterable<string>;
};

export type TurnSignals = {
  toolCalls: number;
  toolErrors: number;
  flags: TurnSignalName[];
};

/**
 * The turn's signals.
 * @param turn - Its answer, its calls, and the tools it could reach.
 */
export function turnSignals(turn: TurnForSignals): TurnSignals {
  const ok = new Set(turn.calls.filter(c => !c.error).map(c => c.tool));
  const toolErrors = turn.calls.filter(c => c.error).length;
  const available = new Set(turn.available);
  const flags: TurnSignalName[] = [];
  if (toolErrors >= FAILED_TOOLS_THRESHOLD) {
    flags.push('toolFailures');
  }
  const couldAct = [...ACTION_TOOLS].some(t => available.has(t));
  const acted = [...ACTION_TOOLS].some(t => ok.has(t));
  if (couldAct && !acted && isRefusal(turn.answer)) {
    flags.push('refusedWithAction');
  }
  if (claimsSave(turn.answer) && ![...SAVE_TOOLS].some(t => ok.has(t))) {
    flags.push('claimedSave');
  }
  return { toolCalls: turn.calls.length, toolErrors, flags };
}
