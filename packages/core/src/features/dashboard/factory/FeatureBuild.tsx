'use client';

import { Hammer, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * BUILD IT, from the page (red team, 2026-09-26: the feature page offered
 * Dismiss and nothing else, so the only way to start a build was to go and
 * ask in chat). One tap files `factory.dispatch_task` for this request and
 * its plan and approves it as the person tapping: the contract comes from the
 * records, the plan is approved, the acceptance is frozen, the engineer is
 * queued. Undo while no worker has taken it.
 * @param props
 * @param props.requestId - The request.
 * @param props.planId - Its plan, when it has one.
 * @param props.children
 */
export function FeatureBuild({ requestId, planId, children }: { requestId: number; planId: number | null; children?: React.ReactNode }) {
  const [phase, setPhase] = useState<{ s: 'idle' } | { s: 'working' } | { s: 'done'; runId: number; workerRunId: number | null } | { s: 'error'; message: string }>({ s: 'idle' });

  const build = async () => {
    setPhase({ s: 'working' });
    try {
      const res = await client.review.propose({
        actionId: 'factory.dispatch_task',
        input: { requestId, ...(planId ? { planId } : {}), reason: 'Build started from the feature page.' },
        rationale: 'The product owner pressed Build on the feature page.',
        confidence: 1,
        suggestedDecision: null,
        suggestedDecisionReason: null,
      }) as { runId: number; status: string };
      const decided = res.status === 'done' ? null : await client.review.decideAction({ id: res.runId, decision: 'approve' }) as { result?: { workerRunId?: number } } | null;
      setPhase({ s: 'done', runId: res.runId, workerRunId: decided?.result?.workerRunId ?? null });
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
      <p className="flex items-center gap-2 text-sm" data-testid="feature-building">
        <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden />
        Building — queued for the engineer.
        <button type="button" onClick={() => void undo(phase.runId)} className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">
          <RotateCcw className="size-3.5" aria-hidden />
          Undo
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void build()}
        disabled={phase.s === 'working'}
        data-testid="feature-build"
        className="inline-flex h-9 items-center gap-2 self-start rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {phase.s === 'working' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Hammer className="size-4" aria-hidden />}
        {phase.s === 'working' ? 'Starting…' : 'Build it'}
      </button>
      {/* The other way out — Dismiss — only while nothing has started. */}
      {children}
      {phase.s === 'error' && <p className="w-full text-xs text-[var(--brand-fail)]">{phase.message}</p>}
    </div>
  );
}
