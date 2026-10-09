'use client';

import type { DecisionAnswerReceipt } from '../types';
import { CircleCheck, CornerDownRight, SkipForward } from 'lucide-react';

/**
 * A person's answer to a Decision, in the transcript — on their side, as what
 * it is: "Chose Northwind API · Which repo should the factory build in?".
 *
 * A card's answer (keys or a click) is never drawn as a bubble of words: they
 * did not type any. Typed words that answered keep their bubble, and this
 * line sits beneath it saying which question they answered.
 * @param props - The line.
 * @param props.answer - The answer, as recorded.
 */
export function DecisionAnswerLine({ answer }: { answer: DecisionAnswerReceipt }) {
  const Icon = answer.kind === 'skip' ? SkipForward : answer.via === 'composer' ? CornerDownRight : CircleCheck;
  const verb = answer.kind === 'skip' ? 'Skipped' : answer.kind === 'free_text' ? 'Answered' : 'Chose';
  return (
    <div className="flex justify-end" data-testid="decision-answer" data-decision-id={answer.id} data-via={answer.via}>
      <p className="inline-flex max-w-2xl items-start gap-1.5 text-right text-[13px] text-muted-foreground">
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {answer.via === 'composer'
            ? (
                <>
                  {'Answered '}
                  <span className="text-foreground/80">{answer.question}</span>
                </>
              )
            : (
                <>
                  {answer.kind === 'skip' ? verb : `${verb} `}
                  {answer.kind !== 'skip' && <span className="font-medium text-foreground">{answer.line}</span>}
                  <span className="text-muted-foreground/80">
                    {' · '}
                    {answer.question}
                  </span>
                </>
              )}
        </span>
      </p>
    </div>
  );
}
