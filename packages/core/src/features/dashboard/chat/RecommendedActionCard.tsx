'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * A2UI recommended-action card — turns a suggested next action into ONE tap.
 *
 * Tapping "Prepare for review" JIT-creates the gated review item
 * (review.propose, reusing the agent's authority) — nothing sends without
 * approval. On success it links straight through to the review card where the
 * draft is edited + approved. This is the click-through to the HITL card.
 */

type State = { status: 'idle' | 'working' | 'done' | 'error'; runId?: number; message?: string };

export function RecommendedActionCard({ rec }: { rec: RecommendedAction }) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const prepare = async () => {
    setState({ status: 'working' });
    try {
      const res = await client.review.propose({
        actionId: rec.actionId,
        input: rec.input,
        agentSlug: rec.agentSlug,
        rationale: rec.rationale,
        confidence: rec.confidence,
      }) as { runId: number; status: string };
      setState({ status: 'done', runId: res.runId });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  };

  const pct = rec.confidence !== undefined ? `${Math.round(rec.confidence * 100)}%` : null;

  return (
    <div className="mt-2 rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-amber-deep" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium break-words">{rec.label}</div>
          {rec.rationale && <p className="mt-0.5 text-xs text-muted-foreground break-words">{rec.rationale}</p>}
          {pct && <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{pct} confidence</span>}
        </div>
      </div>

      <div className="mt-3">
        {state.status === 'done'
          ? (
              <a
                href="/dashboard/review"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-tint px-3 py-1.5 text-sm font-medium text-brand-amber-deep transition hover:opacity-90"
              >
                <Check className="size-4" aria-hidden />
                Added to your review — open it
                <ArrowRight className="size-3.5" aria-hidden />
              </a>
            )
          : (
              <button
                type="button"
                onClick={prepare}
                disabled={state.status === 'working'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-amber/40 bg-brand-amber-tint px-3 py-1.5 text-sm font-medium text-brand-amber-deep transition hover:bg-brand-amber-tint/70 disabled:opacity-60"
              >
                {state.status === 'working' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
                Prepare for review
              </button>
            )}
        {state.status === 'error' && (
          <p className="mt-1.5 text-xs text-destructive">Couldn’t prepare it: {state.message}</p>
        )}
      </div>
    </div>
  );
}
