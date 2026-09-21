'use client';

/**
 * The conversation and the ONE artifact beside it, and the line between them.
 *
 * Two things were wrong with the fixed `5fr / 7fr` grid this replaces, and
 * both showed up in the same screenshot (Chris, 2026-09-18, a 1990px window:
 * "this should be full width / better use of the space"*):
 *
 * 1. The shell's reading-width cap stopped the pair at 1180px, so ~450px of
 *    the window was empty. The route opts out of the cap now
 *    (`features/navigation/pageWidth.ts`) — but a cap dropped without a rule
 *    to replace it just stretches a transcript across a monitor.
 * 2. A ratio cannot serve both panes at once. The transcript wants a fixed
 *    MEASURE (720px, 68–78 characters); the document wants as many pixels as
 *    it takes to render a US-Letter sheet 1:1 (884px) and nothing after that.
 *    So the widths are the rule and the ratio is derived from them
 *    (`splitState.ts`), and the extra pixels of a wide monitor land on
 *    the document, which is the pane that can still use them.
 *
 * Where a person moves the line, it stays: the divider is draggable, it is
 * reachable from the keyboard, and the ratio it was left at is remembered in
 * this browser. Double-click hands it back to the rule.
 *
 * Two cases deliberately keep the cap rather than the window:
 *
 * - **No artifact open.** The transcript alone is prose, and prose gets the
 *   same reading column every other page gets. A conversation does not become
 *   a working surface because it could be one.
 * - **Below `lg`.** The panes stack, exactly as they did before, and the
 *   divider is not rendered at all — there is no split to drag on a phone.
 */

import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { SplitDivider } from '@/components/ui/split-divider';
import { READING_WIDTH_CLASS } from '@/features/navigation/pageWidth';
import { cn } from '@/utils/Helpers';
import {
  clampConversationSplit,
  clearStoredConversationSplit,
  defaultConversationSplit,
  readStoredConversationSplit,
  SPLIT_STEP,
  writeStoredConversationSplit,
} from './splitState';

/** The divider's own column, and the gap either side of it (Tailwind `lg:gap-2`). */
const DIVIDER_WIDTH = 8;
const GAP = 8;

export type ConversationSplitProps = {
  conversation: ReactNode;
  /** The artifact pane, or null when nothing is open beside the conversation. */
  pane: ReactNode | null;
};

export function ConversationSplit(props: ConversationSplitProps) {
  const container = useRef<HTMLDivElement>(null);
  /** What the two panes actually have to share, gaps and divider removed. */
  const [usable, setUsable] = useState(0);
  /** What this browser remembers, or null — "use the rule for this width". */
  const [stored, setStored] = useState<number | null>(null);

  const open = props.pane !== null;

  // Geometry is the browser's to know. Measured in a LAYOUT effect, before
  // the first paint, so the server's fallback ratio is corrected without the
  // panes visibly jumping. localStorage is read the same way and for the same
  // reason — reading it during render would be a hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  useLayoutEffect(() => {
    setStored(readStoredConversationSplit());
  }, []);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el || !open) {
      return;
    }
    const measure = () => setUsable(Math.max(0, el.getBoundingClientRect().width - DIVIDER_WIDTH - GAP * 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */

  const split = clampConversationSplit(stored ?? defaultConversationSplit(usable), usable);
  const clamp = useCallback((fraction: number) => clampConversationSplit(fraction, usable), [usable]);

  if (!open) {
    // Prose keeps the reading column — the same one the shell gives every
    // other page, so closing the pane does not throw the transcript across
    // the monitor.
    return (
      <div className={cn(READING_WIDTH_CLASS, 'flex min-h-0 flex-1 flex-col')} data-conversation-split="closed">
        {props.conversation}
      </div>
    );
  }

  return (
    <div
      ref={container}
      data-conversation-split="open"
      data-split={split.toFixed(3)}
      // Stacked (below `lg`) the grid has ONE column, and it is
      // `minmax(0, 1fr)` rather than the implicit `auto`. An `auto` track's
      // floor is the widest item's min-content, and the transcript's
      // min-content is its own `max-w-3xl` measure plus its gutters — 800px.
      // So a 390px phone laid both panes out 800px wide and cut every line at
      // both edges (the owner's screenshot, 2026-09-19). `minmax(0, 1fr)`
      // gives the column the container's width and makes the panes shrink into
      // it, which is what `min-w-0` on each of them below allows.
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-(--conversation-split) lg:gap-2"
      style={{ '--conversation-split': `minmax(0, ${split}fr) ${DIVIDER_WIDTH}px minmax(0, ${1 - split}fr)` } as React.CSSProperties}
    >
      <div className="flex min-h-0 min-w-0 flex-col" data-conversation-column>{props.conversation}</div>
      {/* Stacked panes have no split to drag, so below `lg` the divider is not
          in the page at all — `hidden` keeps it out of the accessibility tree
          too, rather than offering a control that moves nothing. */}
      <SplitDivider
        layout="columns"
        containerRef={container}
        value={split}
        clamp={clamp}
        step={SPLIT_STEP}
        label="Resize the document — drag, or use the arrow keys; double-click to reset"
        testId="conversation-divider"
        className="hidden self-stretch lg:block"
        onChange={setStored}
        onCommit={writeStoredConversationSplit}
        onReset={() => {
          clearStoredConversationSplit();
          setStored(null);
        }}
      />
      {props.pane}
    </div>
  );
}
