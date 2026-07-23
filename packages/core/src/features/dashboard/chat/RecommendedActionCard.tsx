'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, Check, Loader2, Mail, PencilLine, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * A2UI recommended-action card — turns a suggested next action into ONE tap.
 *
 * Shows a real preview of what will be prepared (to / subject / body for an
 * email send) so the decision is informed, then "Prepare for review" JIT-
 * creates the gated review item (review.propose, reusing the agent's
 * authority) — nothing sends without approval. On success it links straight
 * to the review card where the draft is edited + approved.
 */

type State = { status: 'idle' | 'working' | 'done' | 'error'; runId?: number; message?: string };

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

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

  const pct = rec.confidence !== undefined ? Math.round(rec.confidence * 100) : null;
  const isEmail = rec.actionId === 'gmail.send';
  const to = str(rec.input.to);
  const subject = str(rec.input.subject);
  const body = str(rec.input.body);
  const isDraft = rec.input.draft === true;
  const busy = state.status === 'working';

  return (
    <div data-testid="recommended-action-card" className="mt-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
          {isEmail ? <Mail className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-words">{rec.label}</div>
          {rec.rationale && <p className="mt-0.5 text-xs text-muted-foreground break-words">{rec.rationale}</p>}
        </div>
        {pct !== null && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              pct >= 85 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : pct >= 60 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
            }`}
            title="Agent confidence from grounding"
          >
            {pct}%
          </span>
        )}
      </div>

      {/* Draft preview — what will be prepared */}
      {isEmail && (to || subject || body) && (
        <div className="mx-4 mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          {to && (
            <div className="flex gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">To</span>
              <span className="min-w-0 flex-1 break-words">{to}</span>
            </div>
          )}
          {subject && (
            <div className="mt-1 flex gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">Subject</span>
              <span className="min-w-0 flex-1 font-medium break-words">{subject}</span>
            </div>
          )}
          {body && (
            <p className="mt-1.5 line-clamp-3 border-t border-border/50 pt-1.5 leading-relaxed break-words text-foreground/80">
              {body}
            </p>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center gap-2 px-4 py-3">
        {state.status === 'done'
          ? (
              <a
                href="/dashboard/review"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-tint px-3 py-1.5 text-sm font-medium text-brand-amber-deep transition hover:opacity-90"
              >
                <Check className="size-4" aria-hidden />
                In your review queue — open it
                <ArrowRight className="size-3.5" aria-hidden />
              </a>
            )
          : (
              <button
                type="button"
                onClick={prepare}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PencilLine className="size-4" aria-hidden />}
                {busy ? 'Preparing…' : isDraft ? 'Prepare draft for review' : 'Prepare for review'}
              </button>
            )}
        {isDraft && state.status !== 'done' && (
          <span className="text-[11px] text-muted-foreground">saves to Gmail Drafts — nothing sends without you</span>
        )}
        {state.status === 'error' && (
          <span className="text-xs text-destructive">Couldn’t prepare it: {state.message}</span>
        )}
      </div>
    </div>
  );
}
