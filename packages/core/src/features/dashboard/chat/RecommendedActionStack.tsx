'use client';

import type { RecommendedAction } from './types';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
 *
 * Every card in the strip is as tall as the tallest, so paging never makes
 * the chat jump; and a mouse gets previous / next beside the counter, since a
 * trackpad swipe is not something a desktop person thinks to try (Chris,
 * 2026-09-28: "Make the cards the same height. Give me desktop ability to
 * paginate cards."). A phone keeps the swipe and the dots.
 * @param root0 - The stack's props.
 * @param root0.recs - The turn's recommended actions, in order.
 * @param root0.replyInProgress - True while the reply holding the cards is still streaming.
 */
export function RecommendedActionStack({ recs, replyInProgress = false }: { recs: RecommendedAction[]; replyInProgress?: boolean }) {
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

  const go = useCallback((i: number) => {
    const next = Math.max(0, Math.min(recs.length - 1, i));
    scrollToCard(next);
    setIdx(next);
  }, [recs.length, scrollToCard]);

  if (recs.length <= 1) {
    return <>{recs.map((rec, i) => <RecommendedActionCard key={i} rec={rec} replyInProgress={replyInProgress} />)}</>;
  }

  return (
    <div className="mt-3 min-w-0" data-testid="recommended-action-stack">
      <div className="flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          <Layers className="size-3.5" aria-hidden />
          Suggested actions
        </span>
        <span className="inline-flex items-center gap-1">
          <PageButton dir="prev" disabled={idx === 0} onClick={() => go(idx - 1)} />
          <span className="font-mono text-[11px] text-muted-foreground">
            {idx + 1}
            {' of '}
            {recs.length}
          </span>
          <PageButton dir="next" disabled={idx === recs.length - 1} onClick={() => go(idx + 1)} />
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
          // `flex` so the card stretches to the row's height: the row is as
          // tall as its tallest card, and so is every card in it.
          <div key={i} data-testid="recommended-action-slide" className="flex w-[calc(100%-1.5rem)] min-w-0 shrink-0 snap-start snap-always last:w-full [&>*]:min-w-0 [&>*]:flex-1" aria-hidden={i !== idx ? true : undefined}>
            <RecommendedActionCard rec={rec} replyInProgress={replyInProgress} />
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
            onClick={() => go(i)}
            className={`size-2 rounded-full transition-colors ${i === idx ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground/50'}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Previous / next for a pointer that is not a finger. Hidden on a touch
 * screen, where the strip is swiped; disabled at either end rather than
 * wrapping, so the counter and the button never disagree.
 * @param root0 - The button's props.
 * @param root0.dir - Which way it pages.
 * @param root0.disabled - True at that end of the strip.
 * @param root0.onClick - Moves the strip one card.
 */
function PageButton({ dir, disabled, onClick }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  const label = dir === 'prev' ? 'Previous card' : 'Next card';
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          data-testid={`recommended-action-${dir}`}
          className="hidden size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 pointer-fine:inline-flex"
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
