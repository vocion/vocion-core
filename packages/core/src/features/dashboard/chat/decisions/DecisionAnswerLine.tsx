'use client';

import type { DecisionAnswerReceipt } from '../types';

/**
 * AN ANSWERED DECISION, IN THE THREAD — on the person's side, where their own
 * message would be: the question in small text, their answer under it
 * ("Which repositories should the factory include? / Northwind API").
 *
 * Founder, 2026-10-09, after the Claude app: when a docked question is
 * answered it becomes an inline element in the conversation, and that record
 * IS the turn the agent answers — technically and visually. So the card
 * collapses into this, no answer line elsewhere and no card left behind;
 * "Something else" shows what they typed, Skip shows "Skipped". It scrolls up
 * with the history like any message.
 * @param props - The bubble.
 * @param props.answer - The answer, as recorded.
 * @param props.typed - The words they typed, when they answered in the composer.
 */
export function DecisionAnswerLine({ answer, typed }: { answer: DecisionAnswerReceipt; typed?: string | null }) {
  const said = answer.kind === 'skip' ? 'Skipped' : (typed?.trim() || answer.line);
  return (
    <div className="flex justify-end" data-testid="decision-answer" data-decision-id={answer.id} data-via={answer.via} data-kind={answer.kind}>
      <div className="max-w-2xl rounded-[18px] rounded-br-md bg-muted/60 px-4 py-2.5 text-left break-words" data-testid="user-message">
        <p className="text-[12.5px] leading-snug text-muted-foreground" data-testid="decision-answer-question">{answer.question}</p>
        <p className={`mt-1 text-[15px] leading-[1.45] whitespace-pre-wrap ${answer.kind === 'skip' ? 'text-muted-foreground' : 'text-foreground'}`} data-testid="decision-answer-said">{said}</p>
      </div>
    </div>
  );
}
