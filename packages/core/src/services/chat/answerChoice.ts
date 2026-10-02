/**
 * Answering a choice card (#1028): the answer is the person's turn, and a
 * bound option runs as them.
 *
 * The stream route calls this before it appends the person's message or opens
 * a stream, so a doubled, tampered or foreign answer is refused with a status
 * and never starts an agent turn.
 */

import type { CardAnswer, ChoiceOption } from '@/libs/cards/card';
import type { ConversationRun } from '@/services/ConversationService';
import { z } from 'zod';
import { bindingProblem } from '@/libs/actions/bindable';
import { choiceAllowsOther } from '@/libs/cards/card';
import { proposeAction } from '@/services/ActionService';
import { outcomeOf } from '@/services/chat/historyTools';
import { cardRunState, markCardRun, readCardRun } from '@/services/ConversationService';
import { decide } from '@/services/ReviewService';

/**
 * The shape of `card_answer` on the wire, checked at the route before anything
 * is read. A card id is a short string, the option is a letter or `other`, and
 * typed text is capped so an answer cannot become a way to post a document.
 */
export const ChoiceAnswerRequestSchema = z.object({
  cardId: z.string().min(1).max(64),
  optionId: z.enum(['A', 'B', 'C', 'D', 'other']),
  text: z.string().max(2000).optional(),
});

export type ChoiceAnswer = { cardId: string; optionId: 'A' | 'B' | 'C' | 'D' | 'other'; text?: string /* required for 'other' */ };

export type AnsweredChoice
  = | { ok: true; question: string; answerText: string; modelPrefix: string; userRuns: ConversationRun[]; actionOutcome: string | null; answer: CardAnswer }
    | { ok: false; status: 404 | 409 | 400; error: string };

type BoundAction = NonNullable<ChoiceOption['actions']>[number];

/**
 * One bound action's result as a single line: `<actionId> ran: …` or
 * `<actionId> failed: …`.
 */
type ActionLine = string;

/**
 * Propose one bound action as the person and approve it as them.
 *
 * The pick is the person's approval of exactly the stored input, so the
 * proposal is made with their own principal and, if it lands pending, decided
 * with `reviewedBy` set to them. Actions that check who approved
 * (`source.connect` refuses non-admins) therefore see the real person.
 * Never throws: a refusal, a bad input or a thrown execute comes back as the
 * action's `failed:` line, because the card is already answered and one
 * action's failure must not hide the others.
 * @param input
 * @param input.orgId - The workspace.
 * @param input.userId - The person who answered.
 * @param input.conversationId - The thread, recorded as where the action was asked for.
 * @param input.action - The action as persisted on the option.
 * @returns The action's line.
 */
async function runBoundAction(input: { orgId: string; userId: string; conversationId: number; action: BoundAction }): Promise<ActionLine> {
  const { orgId, userId, conversationId, action } = input;
  // The binding was checked when the card was asked; checked again here
  // because the row is what runs, and a tap must never carry an outside change.
  if (bindingProblem(action.actionId) !== null) {
    return `${action.actionId} failed: not run — it changes something outside Vocion and needs its own approval`;
  }
  try {
    const proposed = await proposeAction({
      orgId,
      actionId: action.actionId,
      input: action.input,
      principal: { kind: 'user', id: userId, role: 'member', scope: { orgId } },
      invokedBy: userId,
      origin: { conversationId, userId, byPerson: true },
    });
    if (proposed.outcome === 'already_underway') {
      return `${action.actionId} ran: already under way (${proposed.underway?.line ?? 'nothing new was started'})`;
    }
    if (proposed.outcome === 'already_decided') {
      return `${action.actionId} ran: a person already decided this exact record (${proposed.status}), so nothing new was started`;
    }
    if (proposed.status === 'pending') {
      const decided = await decide({ kind: 'action', id: proposed.runId }, 'approve', orgId, { reviewedBy: userId });
      return lineForExecution(action.actionId, decided.execution?.status ?? 'done', decided.execution?.error ?? undefined, decided.execution?.result);
    }
    return lineForExecution(action.actionId, proposed.status, proposed.error, proposed.result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'it could not run';
    return `${action.actionId} failed: ${message}`;
  }
}

/**
 * Word an action's end state as its line.
 * @param actionId - The action.
 * @param status - Where its run ended.
 * @param error - Why it failed, when it did.
 * @param result - What it returned, when it ran.
 */
function lineForExecution(actionId: string, status: string, error: string | undefined, result: Record<string, unknown> | null | undefined): ActionLine {
  if (status === 'failed') {
    return `${actionId} failed: ${error ?? 'it did not complete'}`;
  }
  if (status === 'rejected' || status === 'undone') {
    return `${actionId} failed: the run ended ${status}`;
  }
  if (status === 'awaiting_execution') {
    return `${actionId} ran: handed off, waiting for whoever does the work outside Vocion`;
  }
  return `${actionId} ran: ${outcomeOf(result) ?? resultAsJson(result)}`;
}

/** The longest a result may run in a line the agent reads. */
const RESULT_LINE_LIMIT = 600;

/**
 * An action's result as compact JSON for the agent, cut with `…` past the limit.
 * One rule for every action, so what an action returns (a source slug, a
 * `created` flag) is what the agent reads.
 * @param result - What the action returned.
 * @returns The JSON, or `done` when it returned nothing.
 */
function resultAsJson(result: Record<string, unknown> | null | undefined): string {
  if (!result || Object.keys(result).length === 0) {
    return 'done';
  }
  const json = JSON.stringify(result);
  return json.length > RESULT_LINE_LIMIT ? `${json.slice(0, RESULT_LINE_LIMIT)}…` : json;
}

/**
 * What the person said, from the option they picked or the words they typed.
 * @param options - The card's persisted options.
 * @param answer - The request's answer.
 * @param allowsOther - Whether the card takes typed text.
 * @returns The answer's text and the option picked, or a refusal.
 */
function resolveAnswer(options: ChoiceOption[], answer: ChoiceAnswer, allowsOther: boolean): { text: string; option?: ChoiceOption } | { error: string } {
  if (answer.optionId === 'other') {
    const typed = answer.text?.trim() ?? '';
    if (!allowsOther) {
      return { error: 'This question does not take a typed answer.' };
    }
    return typed ? { text: typed } : { error: 'Type your answer first.' };
  }
  const option = options.find(candidate => candidate.id === answer.optionId);
  return option ? { text: option.label, option } : { error: `This question has no option ${answer.optionId}.` };
}

/**
 * Mark a choice card answered and run its bound actions as the person, in order (#1028).
 *
 * The card and its binding are read from the persisted run, never from the
 * request: the answer carries a card id and a letter, nothing the agent wrote.
 * `markCardRun` with `expectState: 'proposed'` decides a race on the locked
 * message row, so the loser is a 409 and runs nothing. Actions run only after
 * the card is answered, outside any transaction, one after another; a failing
 * action never un-answers the card or stops the next.
 * @param input
 * @param input.orgId - The workspace.
 * @param input.userId - The person answering.
 * @param input.conversationId - The thread the card is in.
 * @param input.answer - Which card, which option, and the typed words for `other`.
 */
export async function answerChoice(input: { orgId: string; userId: string; conversationId: number; answer: ChoiceAnswer }): Promise<AnsweredChoice> {
  const { orgId, userId, conversationId, answer } = input;
  const card = await readCardRun({ orgId, conversationId, cardId: answer.cardId });
  if (!card || card.kind !== 'choice') {
    return { ok: false, status: 404, error: 'That question is not in this conversation.' };
  }
  if (cardRunState(card) !== 'proposed') {
    return { ok: false, status: 409, error: 'That question is already answered or skipped.' };
  }
  const resolved = resolveAnswer(card.options ?? [], answer, choiceAllowsOther(card));
  if ('error' in resolved) {
    return { ok: false, status: 400, error: resolved.error };
  }
  const stored: CardAnswer = { optionId: answer.optionId, text: resolved.text, at: new Date().toISOString(), by: userId };
  const won = await markCardRun({ orgId, conversationId, cardId: answer.cardId, expectState: 'proposed', patch: { state: 'decided', answer: stored } });
  if (!won) {
    return { ok: false, status: 409, error: 'That question is already answered or skipped.' };
  }
  const lines: ActionLine[] = [];
  for (const action of resolved.option?.actions ?? []) {
    lines.push(await runBoundAction({ orgId, userId, conversationId, action }));
  }
  const modelPrefix = [`Answered "${card.label}": ${resolved.text}`, ...lines.map(line => `(${line})`)].join('\n');
  return {
    ok: true,
    question: card.label,
    answerText: resolved.text,
    modelPrefix,
    userRuns: [{ type: 'card_decision', cardId: answer.cardId, action: 'answer', label: card.label, option: answer.optionId }],
    actionOutcome: lines.length > 0 ? lines.join('\n') : null,
    answer: stored,
  };
}
