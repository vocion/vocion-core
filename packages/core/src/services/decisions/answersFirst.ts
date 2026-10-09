/**
 * ANSWERS FIRST — a message is judged against the open Decision before it is
 * routed or intent-read.
 *
 * Every answer a person gave a card used to re-enter the chat as a new user
 * message: the router read it for who should answer, the intent judge read it
 * for what was wanted, and "approve" or "the second one" could land on a
 * different agent, as a question, made read-only. Slack and email already
 * checked what was waiting before running the agent; the app did not.
 *
 * Now, before anything else reads a turn:
 *
 *   - a card's answer arrives TYPED (`decision_answer`, from its keys or a
 *     click) and is recorded as it is — nothing is read, nothing is routed;
 *   - a typed message in a conversation with an open Decision is read by a
 *     model against that one Decision (`turnJudge.readDecisionAnswer`): an
 *     answer by number, label, meaning or in their own words is recorded;
 *     a genuinely new topic routes as it always did, and the Decision stays.
 *
 * Either way the answer goes to the agent that asked, as a typed decision
 * event — never as words the person did not type.
 */

import type { AnsweredDecision } from './DecisionService';
import type { DecisionView } from '@/libs/decisions/decision';
import type { DecisionAnswerReading } from '@/services/agents/turnJudge';
import { readDecisionAnswerWire } from '@/libs/decisions/decision';

export type AnswersFirst
  /** Not an answer: route the turn as usual. `open` is what still waits, when anything does. */
  = | { kind: 'none'; open: DecisionView | null }
    /** An answer, recorded. `card`: keys or a click, nothing typed. `composer`: their typed words, read as the answer. */
    | { kind: 'answered'; source: 'card' | 'composer'; answered: AnsweredDecision }
    /** A card's answer that cannot be taken — not found here, already decided, or not an answer it takes. */
    | { kind: 'refused'; status: 400 | 404 | 409; message: string };

/**
 * What this turn is, before it is routed.
 * @param opts - The turn.
 * @param opts.orgId - The workspace.
 * @param opts.userId - The person.
 * @param opts.conversationId - The conversation, when it exists and they can see it.
 * @param opts.message - What they typed.
 * @param opts.wire - A card's typed answer (`decision_answer`), when the turn carries one.
 * @param opts.read - The model read; injected in tests.
 */
export async function answersFirst(opts: {
  orgId: string;
  userId: string;
  conversationId: number | null;
  message: string;
  wire?: unknown;
  read?: (input: { orgId: string; message: string; decision: DecisionView }) => Promise<DecisionAnswerReading>;
}): Promise<AnswersFirst> {
  const { answerDecision, DecisionError, openDecisions } = await import('./DecisionService');
  if (opts.wire !== undefined && opts.wire !== null) {
    const typed = readDecisionAnswerWire(opts.wire);
    if (!typed) {
      return { kind: 'refused', status: 400, message: 'decision_answer needs an id and exactly one of option_ids, free_text or skip' };
    }
    if (opts.conversationId === null) {
      return { kind: 'refused', status: 404, message: 'No such decision in this conversation' };
    }
    try {
      const answered = await answerDecision({ orgId: opts.orgId, conversationId: opts.conversationId, id: typed.id, subject: typed.subject, answer: typed.answer, by: opts.userId, via: 'card' });
      return { kind: 'answered', source: 'card', answered };
    } catch (err) {
      if (err instanceof DecisionError) {
        return { kind: 'refused', status: err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400, message: err.message };
      }
      throw err;
    }
  }
  if (opts.conversationId === null || !opts.message.trim()) {
    return { kind: 'none', open: null };
  }
  const open = (await openDecisions(opts.orgId, opts.conversationId, opts.userId))[0] ?? null;
  if (!open) {
    return { kind: 'none', open: null };
  }
  const { decisionAnswerFromReading, readDecisionAnswer } = await import('@/services/agents/turnJudge');
  const reading = await (opts.read ?? (i => readDecisionAnswer(i)))({ orgId: opts.orgId, message: opts.message, decision: open });
  const answer = decisionAnswerFromReading(open, reading, opts.message);
  if (!answer) {
    return { kind: 'none', open };
  }
  try {
    const answered = await answerDecision({ orgId: opts.orgId, conversationId: opts.conversationId, id: open.id, subject: open.subject, answer, by: opts.userId, via: 'composer' });
    return { kind: 'answered', source: 'composer', answered };
  } catch (err) {
    // Answered somewhere else a moment ago, or not an answer after all: the
    // message is still theirs, and it routes as usual.
    if (err instanceof DecisionError) {
      return { kind: 'none', open: null };
    }
    throw err;
  }
}

/**
 * The line the model reads under a message that did NOT answer the open
 * Decision: it is still docked, unanswered, and not to be asked again.
 * @param open - The Decision still waiting.
 */
export function stillOpenNote(open: Pick<DecisionView, 'id' | 'question'>): string {
  return `\n\n--- waiting on them ---\nDecision #${open.id} ("${open.question}") is still docked above their composer, unanswered. This message is about something else: answer it, and do not ask that question again.`;
}
