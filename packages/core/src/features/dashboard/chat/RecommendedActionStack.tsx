'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, Bookmark, Check, Layers, Loader2, SkipForward } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { recommendedActionAdvice } from '@/services/chat/recommendedActionAdvice';
import { RecommendedActionCard } from './RecommendedActionCard';

/**
 * Multi-card triage IN CHAT — when a turn surfaces several recommended
 * actions, show them as an ephemeral stepper (the Slack-catch-up pattern)
 * instead of a wall of cards: one card at a time with Skip / Save-for-later,
 * plus "Queue all" bulk. Save + Queue-all JIT-propose to the review queue
 * (same gated review.propose path as the card CTA — nothing sends); Skip is
 * ephemeral. Finishing shows a tally + queue link.
 */

type Outcome = 'saved' | 'skipped' | 'acted';

export function RecommendedActionStack({ recs, autoPropose = false }: { recs: RecommendedAction[]; autoPropose?: boolean }) {
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [bulkDone, setBulkDone] = useState(false);

  const touchX = useRef<number | null>(null);
  if (recs.length <= 1) {
    return <>{recs.map((rec, i) => <RecommendedActionCard key={i} rec={rec} autoPropose={autoPropose} />)}</>;
  }
  // Several cards are ALWAYS one at a time — filed or not. A person on a phone
  // answers one decision, swipes, answers the next; a column of cards is the
  // wall this stack exists to avoid (Chris, 2026-09-24). Cards the server
  // already filed carry their live status inside the same stepper.

  const propose = async (rec: RecommendedAction): Promise<void> => {
    // Same refusal as the card's: a recommendation with no action id cannot
    // produce a valid proposal, and "Queue all" must not turn one bad payload
    // into a burst of 400s.
    if (!rec.actionId) {
      throw new Error('This recommendation named no action, so there is nothing to prepare.');
    }
    await client.review.propose({
      actionId: rec.actionId,
      input: rec.input,
      agentSlug: rec.agentSlug,
      rationale: rec.rationale,
      confidence: rec.confidence,
      ...recommendedActionAdvice(rec),
    });
  };

  const advance = (o: Outcome) => {
    setOutcomes(prev => [...prev, o]);
    setIdx(i => i + 1);
  };

  const onSave = async () => {
    const rec = recs[idx];
    if (!rec) {
      return;
    }
    setBusy(true);
    try {
      await propose(rec);
      advance('saved');
    } catch {
      advance('skipped');
    } finally {
      setBusy(false);
    }
  };

  const onQueueAll = async () => {
    setBusy(true);
    try {
      // Upsert-by-key on the server dedupes anything already proposed.
      for (const rec of recs.slice(idx)) {
        await propose(rec).catch(() => {});
      }
      setBulkDone(true);
    } finally {
      setBusy(false);
    }
  };

  const done = bulkDone || idx >= recs.length;
  const saved = outcomes.filter(o => o === 'saved').length + (bulkDone ? recs.length - idx : 0);

  if (done) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
        <Check className="size-4 text-brand-amber-deep" aria-hidden />
        <span className="text-foreground/85">
          {saved > 0 ? `${saved} saved to your queue` : 'All set'}
          {outcomes.filter(o => o === 'skipped').length > 0 && ` · ${outcomes.filter(o => o === 'skipped').length} skipped`}
        </span>
        {saved > 0 && (
          <Link href="/dashboard/inbox?kind=proposal" className="inline-flex items-center gap-1 font-medium text-brand-amber-deep hover:opacity-90">
            Review queue
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    );
  }

  const current = recs[idx]!;
  const go = (delta: number) => setIdx(i => Math.min(recs.length - 1, Math.max(0, i + delta)));
  return (
    <div
      className="mt-3"
      data-testid="recommended-action-stack"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start === null || end === undefined || Math.abs(end - start) < 48) {
          return;
        }
        go(end < start ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          <Layers className="size-3.5" aria-hidden />
          Suggested actions
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {idx + 1}
          {' of '}
          {recs.length}
        </span>
      </div>

      <RecommendedActionCard key={idx} rec={current} autoPropose={autoPropose && current.runId === undefined} />

      {/* Dots: where you are, and a tap to any card. Swipe does the same on touch. */}
      <div className="mt-2 flex items-center justify-center gap-1.5" role="tablist" aria-label="Suggested actions">
        {recs.map((r, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === idx}
            aria-label={`Card ${i + 1} of ${recs.length}: ${r.label}`}
            onClick={() => setIdx(i)}
            className={`size-2 rounded-full transition-colors ${i === idx ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground/50'}`}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => advance('skipped')}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <SkipForward className="size-3.5" aria-hidden />
          Skip
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
          Save for later
        </button>
        <button
          type="button"
          onClick={() => void onQueueAll()}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-amber-deep transition hover:opacity-90 disabled:opacity-50"
        >
          Queue all
          {' '}
          {recs.length - idx}
          {' '}
          for review
          <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
