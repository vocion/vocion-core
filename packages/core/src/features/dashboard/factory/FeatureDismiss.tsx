'use client';

import { Loader2, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';

/**
 * DISMISS A PROPOSAL, with undo (Chris, 2026-09-25: "a mechanism to dismiss a
 * proposal"). One tap writes the decision on the record — out of scope, the
 * recommendation rejected, the reason — through `objects.update_meta`, so it
 * is a run a person can read and put back. Done for you, then Undo: approval
 * gates are debt. The Work page drops a dismissed proposal from the queue.
 * @param props
 * @param props.requestId - The request.
 */
export function FeatureDismiss({ requestId }: { requestId: number }) {
  const [phase, setPhase] = useState<{ s: 'idle' } | { s: 'working' } | { s: 'done'; runId: number } | { s: 'error'; message: string }>({ s: 'idle' });
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);

  const dismiss = async () => {
    setPhase({ s: 'working' });
    try {
      const why = reason.trim() || 'Dismissed from the feature page.';
      const res = await client.review.propose({
        actionId: 'objects.update_meta',
        input: { objectType: 'request', id: requestId, set: { state: 'out_of_scope', recommendationState: 'rejected', decisionReason: why, decidedAt: new Date().toISOString() }, reason: why },
        rationale: why,
        confidence: 0.95,
        suggestedDecision: null,
        suggestedDecisionReason: null,
      }) as { runId: number; status: string };
      if (res.status !== 'done') {
        await client.review.decideAction({ id: res.runId, decision: 'approve' });
      }
      setPhase({ s: 'done', runId: res.runId });
      setAsking(false);
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
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="feature-dismissed">
        Dismissed — off the Work page.
        <button type="button" onClick={() => void undo(phase.runId)} className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">
          <RotateCcw className="size-3.5" aria-hidden />
          Undo
        </button>
      </p>
    );
  }
  if (asking) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="feature-dismiss-form">
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void dismiss()}
          placeholder="Why not? (optional)"
          aria-label="Why dismiss this proposal"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
        />
        <button type="button" onClick={() => void dismiss()} disabled={phase.s === 'working'} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-medium text-background disabled:opacity-60">
          {phase.s === 'working' && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Dismiss
        </button>
        <button type="button" onClick={() => setAsking(false)} className="h-8 px-2 text-[13px] text-muted-foreground">Cancel</button>
        {phase.s === 'error' && <p className="w-full text-xs text-[var(--brand-fail)]">{phase.message}</p>}
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => setAsking(true)} data-testid="feature-dismiss" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" aria-hidden />
          Dismiss
        </button>
      </TooltipTrigger>
      <TooltipContent>Not building this — take it off the Work page</TooltipContent>
    </Tooltip>
  );
}
