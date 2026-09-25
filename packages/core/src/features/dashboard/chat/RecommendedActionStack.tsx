'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, Bookmark, Check, Layers, Loader2, SkipForward } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
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

  // The strip is a native scroll-snap row: the card follows the finger and
  // settles on the nearest one, the way a phone's own carousels do. It used to
  // be a touch-end handler that swapped one card for the next once a swipe had
  // finished — nothing moved under the finger (Chris, 2026-09-25: "I want to
  // be able to slide the cards. Not just swipe to change").
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scrollToCard = useCallback((i: number) => {
    const strip = stripRef.current;
    const card = strip?.children[i] as HTMLElement | undefined;
    if (strip && card) {
      strip.scrollTo({ left: card.offsetLeft - strip.offsetLeft, behavior: 'smooth' });
    }
  }, []);
  // The current card is where the strip SETTLES, not every card it passes:
  // a tap on the last dot glides past the middle ones, and a card that was
  // "current" for one frame must not count as seen (or propose itself).
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStripScroll = useCallback(() => {
    if (settleRef.current) {
      clearTimeout(settleRef.current);
    }
    settleRef.current = setTimeout(() => {
      const strip = stripRef.current;
      if (!strip) {
        return;
      }
      // The card whose left edge is nearest the strip's scroll position.
      let best = 0;
      let bestGap = Number.POSITIVE_INFINITY;
      Array.from(strip.children).forEach((c, i) => {
        const gap = Math.abs((c as HTMLElement).offsetLeft - strip.offsetLeft - strip.scrollLeft);
        if (gap < bestGap) {
          best = i;
          bestGap = gap;
        }
      });
      setIdx(i => (i === best ? i : best));
    }, 120);
  }, []);
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
    const next = idx + 1;
    if (next >= recs.length) {
      setIdx(next);
      return;
    }
    scrollToCard(next);
    setIdx(next);
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

  return (
    <div className="mt-3 min-w-0" data-testid="recommended-action-stack">
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

      {/* Every card is mounted, so a card keeps its own state (an open
          editor, a decision in flight) when you slide past it. The next card
          peeks at the edge, which is what says "this slides". Only the card
          in view may propose itself, as when they came one at a time. */}
      <div
        ref={stripRef}
        onScroll={onStripScroll}
        data-testid="recommended-action-strip"
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {recs.map((rec, i) => (
          <div key={i} className="w-[calc(100%-1.5rem)] min-w-0 shrink-0 snap-start snap-always last:w-full" aria-hidden={i !== idx ? true : undefined}>
            <RecommendedActionCard rec={rec} autoPropose={autoPropose && i === idx && rec.runId === undefined} />
          </div>
        ))}
      </div>

      {/* Dots: where you are, and a tap to any card. */}
      <div className="mt-2 flex items-center justify-center gap-1.5" role="tablist" aria-label="Suggested actions">
        {recs.map((r, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === idx}
            aria-label={`Card ${i + 1} of ${recs.length}: ${r.label}`}
            onClick={() => {
              scrollToCard(i);
              setIdx(i);
            }}
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
