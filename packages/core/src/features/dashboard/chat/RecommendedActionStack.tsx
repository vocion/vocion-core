'use client';

import type { RecommendedAction } from './types';
import { Layers } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { RecommendedActionCard } from './RecommendedActionCard';

/**
 * Several recommended actions in chat: one strip you slide, one card in view,
 * dots for where you are. Each card carries its own decision — Approve, and
 * quietly Review first and Defer — so the strip needs nothing under it.
 *
 * Skip, Save for later and Queue all used to sit below. Under a slide strip
 * Skip is a slide, Save for later is the card's own Defer, and done-for-you
 * already files what should be filed; Review dropped the same two controls
 * on 2026-09-22 (Chris, 2026-09-25: "Add by subtracting. Could we lose it
 * all?").
 * @param root0
 * @param root0.recs
 * @param root0.autoPropose
 */
export function RecommendedActionStack({ recs }: { recs: RecommendedAction[] }) {
  const [idx, setIdx] = useState(0);

  // The strip is a native scroll-snap row: the card follows the finger and
  // settles on the nearest one, the way a phone's own carousels do (Chris,
  // 2026-09-25: "I want to be able to slide the cards").
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scrollToCard = useCallback((i: number) => {
    const strip = stripRef.current;
    const card = strip?.children[i] as HTMLElement | undefined;
    if (strip && card) {
      strip.scrollTo({ left: card.offsetLeft - strip.offsetLeft, behavior: 'smooth' });
    }
  }, []);
  // The current card is where the strip SETTLES, not every card it passes:
  // a tap on the last dot glides past the middle ones.
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
    return <>{recs.map((rec, i) => <RecommendedActionCard key={i} rec={rec} />)}</>;
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

      {/* Every card is mounted, so a card keeps its own state when you slide
          past it. The next card peeks at the edge, which is what says "this
          slides". */}
      <div
        ref={stripRef}
        onScroll={onStripScroll}
        data-testid="recommended-action-strip"
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {recs.map((rec, i) => (
          <div key={i} className="w-[calc(100%-1.5rem)] min-w-0 shrink-0 snap-start snap-always last:w-full" aria-hidden={i !== idx ? true : undefined}>
            <RecommendedActionCard rec={rec} />
          </div>
        ))}
      </div>

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
    </div>
  );
}
