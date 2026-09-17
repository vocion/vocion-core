'use client';

import type { SequenceResolution } from '@/services/personalization/sequenceState';
import { Ban } from 'lucide-react';

/**
 * Current sequence · Vocion recommends · Approving will.
 *
 * The P0 that comes second only to the chat contradicting the page: the old
 * surface offered **Enroll** on a contact the CRM said had been enrolled in a
 * sequence minutes after becoming an MQL, with nothing on screen to say
 * whether approving would add, replace, or duplicate.
 *
 * Three lines, always in this order, and the third is a transaction rather
 * than a description. When the data cannot produce the third line, it says so
 * and the decision bar's primary is held — a one-click Enroll that might mean
 * either of two things is worse than no button, because neither the reviewer
 * nor the audit can say afterwards which one was authorised.
 * @param root0
 * @param root0.state
 */
export function SequenceStateBlock({ state }: { state: SequenceResolution }) {
  return (
    <div data-testid="sequence-state" className="flex flex-col gap-1.5 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="shrink-0 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Current state</span>
        <span className="min-w-0 break-words" data-testid="sequence-state-current">{state.currentLine}</span>
      </p>
      {state.recommendedLine && (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="shrink-0 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Vocion recommends</span>
          <span className="min-w-0 break-words" data-testid="sequence-state-recommended">{state.recommendedLine}</span>
        </p>
      )}
      {state.approvingWill
        ? (
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="shrink-0 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Approving will</span>
              <span className="min-w-0 font-medium break-words" data-testid="sequence-state-transaction">{state.approvingWill}</span>
            </p>
          )
        : (
            <p className="mt-0.5 flex items-start gap-2.5 border-l-2 border-brand-borderline py-1 pl-3" data-testid="sequence-state-held">
              <Ban className="mt-0.5 size-4 shrink-0 text-brand-borderline" aria-hidden />
              <span className="min-w-0">
                <span className="font-medium">Enroll is held.</span>
                {' '}
                <span className="text-muted-foreground">{state.blockedReason}</span>
              </span>
            </p>
          )}
    </div>
  );
}
