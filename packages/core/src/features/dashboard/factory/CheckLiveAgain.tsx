'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * CHECK LIVE AGAIN (2026-10-02, FE-314 / REL-347). A live check that did not
 * see the change stops after its attempts; once what stopped it is fixed, the
 * person who owns the feature asks QA for a fresh round here. Their word runs
 * (`factory.check_live_again`), with Undo, and QA's new answer lands on the
 * feature's Current state.
 * @param props
 * @param props.releaseId - The release to check again.
 * @param props.label - The move's words.
 */
export function CheckLiveAgain({ releaseId, label }: { releaseId: number; label: string }) {
  const [phase, setPhase] = useState<{ s: 'idle' } | { s: 'working' } | { s: 'done'; runId: number } | { s: 'error'; message: string }>({ s: 'idle' });

  const ask = async () => {
    setPhase({ s: 'working' });
    try {
      const why = 'A person asked for the live check again from the feature page.';
      const res = await client.review.propose({
        actionId: 'factory.check_live_again',
        input: { releaseId, reason: why },
        rationale: why,
        confidence: 0.95,
        suggestedDecision: null,
        suggestedDecisionReason: null,
      }) as { runId: number; status: string };
      if (res.status !== 'done') {
        await client.review.decideAction({ id: res.runId, decision: 'approve' });
      }
      setPhase({ s: 'done', runId: res.runId });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  const undo = async (runId: number) => {
    setPhase({ s: 'working' });
    try {
      await client.review.undoAction({ id: runId });
      setPhase({ s: 'idle' });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  if (phase.s === 'done') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="check-live-asked">
        QA is checking it on the live product again.
        <button type="button" onClick={() => void undo(phase.runId)} className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">
          <RotateCcw className="size-3.5" aria-hidden />
          Undo
        </button>
      </p>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="check-live-again"
        onClick={() => void ask()}
        disabled={phase.s === 'working'}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        {phase.s === 'working' && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {label}
      </button>
      {phase.s === 'error' && <span role="alert" className="text-[13px] text-brand-fail">{phase.message}</span>}
    </span>
  );
}
