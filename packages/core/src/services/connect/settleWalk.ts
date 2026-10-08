/**
 * THE WALK ANSWERS THE DECISION THAT STARTED IT.
 *
 * "Connect your systems" reaches the person as one setup Decision whose
 * option opens the docked walk-through (`services/decisions/escalate.ts`).
 * The walk is the answer: when it finishes, the Decision is answered as the
 * person took it — typed, never words in their mouth — and the record of it
 * carries what happened ("Connected HubSpot and Slack; Gmail later"). It is
 * written as a `decision` row like any card answer, so the transcript shows
 * the receipt and the agent's next turn reads what became of it; no turn runs
 * now (the walk said everything there was to say). Scoped to the workspace
 * and the conversation.
 */

import type { DecisionAnswer } from '@/libs/decisions/decision';

/** The option the walk answers with. */
export const START_WALK_OPTION = 'start';

/**
 * The receipt's line: the option, then what happened ("Start: Connected HubSpot.").
 * @param summary - The walk's one line.
 */
export function walkLine(summary: string): string {
  return `Start: ${summary.trim()}`;
}

/**
 * Answer the walk's Decision with what happened.
 * @param opts - The finished walk.
 * @param opts.orgId - The workspace.
 * @param opts.userId - The person who walked it.
 * @param opts.conversationId - Where it was asked.
 * @param opts.decisionId - The Decision.
 * @param opts.summary - One line: what was connected, skipped, left for later.
 */
export async function settleConnectSystems(opts: { orgId: string; userId: string; conversationId: number; decisionId: number; summary: string }): Promise<{ settled: boolean }> {
  const { answerDecision, DecisionError } = await import('@/services/decisions/DecisionService');
  const answer: DecisionAnswer = { kind: 'option', optionIds: [START_WALK_OPTION] };
  let answered;
  try {
    answered = await answerDecision({ orgId: opts.orgId, conversationId: opts.conversationId, id: opts.decisionId, answer, by: opts.userId, via: 'card' });
  } catch (err) {
    // Already answered (a second Done, another tab) or not this conversation's: nothing to write.
    if (err instanceof DecisionError) {
      return { settled: false };
    }
    throw err;
  }
  const { decisionForModel } = await import('@/libs/decisions/decision');
  const { appendMessage } = await import('@/services/ConversationService');
  const summary = opts.summary.trim();
  await appendMessage({
    orgId: opts.orgId,
    conversationId: opts.conversationId,
    role: 'decision',
    content: `${decisionForModel(answered.asked, answer)}\nWhat happened: ${summary}`,
    runs: [{ type: 'decision_answer', id: answered.asked.id, question: answered.asked.question, answer, line: walkLine(summary), via: 'card' }],
  });
  return { settled: true };
}
