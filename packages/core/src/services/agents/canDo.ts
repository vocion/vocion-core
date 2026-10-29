/**
 * CAN BEFORE CAN'T — an agent never tells a person it cannot do what it can.
 *
 * A teammate's walk (2026-10-28): asked to update a HubSpot deal, the agent
 * ran six steps that failed and answered "I can't execute the CRM update
 * directly in this session…"; told "yes you can, I've done it before", it did
 * it at once. The SEO walk showed the same shape: tools behind tool search, and
 * a fast model that did not know `site.publish_page` was an action.
 *
 * Two levers, in the repo's order (CLAUDE.md, *Structural over prompting*):
 *
 *   1. A harness rule in every agent's prompt (`CAN_DO_RULE`): before saying
 *      an action or a tool is unavailable, look in ACTIONS and search the
 *      tools, and try it; a step that failed is named with its error.
 *   2. A gated pass that fires only on the violation: a person's turn that
 *      asked for an act and wrote nothing, whose reply a model reads as "I
 *      can't" with a matching action in the turn's catalog
 *      (`turnJudge.readUnableClaim`), runs once more told which action does it
 *      and which steps failed (`canDoNudge`). Never on the reply's words.
 */

/** The harness rule, stated once in every agent's prompt (`services/agents/harness.ts`). */
export const CAN_DO_RULE = 'CAN BEFORE CAN\'T: before you tell the person an action or a tool is unavailable, look for it — in ACTIONS (what propose_action takes) and with tool search — and try it. Never say you cannot do something you have not tried. When a step you ran failed, say which step and the error it gave, not "I can\'t".';

/** A tool call that failed this turn. */
export type FailedStep = { tool: string; message: string };

/**
 * Whether a finished turn is worth reading for an "I can't". Pure: only a
 * person's turn that asked for an act, wrote nothing, said something and
 * was not refused or stopped at a card.
 * @param turn - What the turn did.
 * @param turn.personTurn - A person's own chat turn.
 * @param turn.refused - The model declined.
 * @param turn.handedOff - It ended at a card the person acts on.
 * @param turn.writes - Writes that landed.
 * @param turn.asks - What the person asked for (`TurnIntent.asks`).
 * @param turn.reply - The reply so far.
 * @param turn.already - The pass already ran this turn.
 */
export function worthCheckingCanDo(turn: { personTurn: boolean; refused: boolean; handedOff: boolean; writes: number; asks: string; reply: string; already: boolean }): boolean {
  return turn.personTurn && !turn.refused && !turn.handedOff && !turn.already && turn.writes === 0 && turn.asks !== 'answer' && turn.reply.trim().length > 0;
}

/**
 * The failed steps in a line each, capped.
 * @param failures - The turn's failed tool calls.
 */
export function failedStepsLine(failures: readonly FailedStep[]): string {
  const seen = new Set<string>();
  const lines = failures.filter((f) => {
    const key = `${f.tool}:${f.message}`;
    return seen.has(key) ? false : (seen.add(key), true);
  }).slice(-6).map(f => `- ${f.tool}: ${f.message.replace(/\s+/g, ' ').slice(0, 240)}`);
  return lines.join('\n');
}

/**
 * The one instruction the retry runs on: the action that does it, and the
 * steps that failed, so the answer is the act or names what broke.
 * @param actionId - The action the catalog has for it.
 * @param failures - The turn's failed tool calls.
 */
export function canDoNudge(actionId: string, failures: readonly FailedStep[]): string {
  const failed = failedStepsLine(failures);
  return [
    `You said you cannot do this, but you have the action ${actionId}: propose it now with propose_action (action_id "${actionId}"), with the input it takes.`,
    failed ? `These steps failed this turn:\n${failed}\nIf the action fails too, say which step failed and its error, in one line; never "I can't".` : 'If it fails, say which step failed and its error, in one line; never "I can\'t".',
  ].join('\n');
}
