'use client';

/**
 * THE divider between two panes. One shape, both orientations.
 *
 * The right column already had one — a rule you drag to move the line between
 * the preview and the chat beneath it (`features/dashboard/chat/RailColumn`).
 * The conversation surface needed the same thing turned ninety degrees, and a
 * second hand-rolled drag handle beside the first is exactly the "two
 * surfaces doing the same job" that principle 6 calls a defect. So the drag
 * arithmetic, the keyboard rule, the reset and the ARIA live here, and the
 * caller supplies only its own container, its own clamp and its own memory.
 *
 * `role="separator"` with a tabindex is the window-splitter pattern: a
 * separator that can be moved is focusable and carries the value it was
 * moved to. `aria-orientation` describes the RULE, not the drag — a rule
 * between a left and a right pane is vertical, a rule between a top and a
 * bottom pane is horizontal.
 *
 * Arrow keys move it one step; double-click hands it back to the caller's
 * default. Every move is committed, so nothing is lost by letting go.
 */

import type { RefObject } from 'react';
import { useRef } from 'react';
import { cn } from '@/utils/Helpers';

export type SplitDividerProps = {
  /** `columns` — two panes side by side. `rows` — two panes stacked. */
  layout: 'columns' | 'rows';
  /** The element the fraction is measured against: the box holding both panes. */
  containerRef: RefObject<HTMLElement | null>;
  /** The FIRST pane's share of the container, 0–1. */
  value: number;
  /** The caller's own limits — what neither of its panes may shrink past. */
  clamp: (fraction: number) => number;
  onChange: (fraction: number) => void;
  /** The move settled (the pointer came up, or a key landed): remember it. */
  onCommit?: (fraction: number) => void;
  /** Double-click: back to the default. Omit and the double-click does nothing. */
  onReset?: () => void;
  /** What the divider moves, for a screen reader: "Resize the document". */
  label: string;
  /** One arrow key, as a fraction of the container. */
  step?: number;
  testId?: string;
  className?: string;
};

export function SplitDivider(props: SplitDividerProps) {
  const columns = props.layout === 'columns';
  const step = props.step ?? 0.05;

  // The drag's frame of reference, captured on pointer-down: where the
  // container starts and how big it is. A ref, not state — every pointer move
  // re-renders the caller, and a plain local would be gone by the second one.
  // Read once per drag, because a move that re-measured would fight the
  // layout the same move is changing.
  const origin = useRef<{ start: number; size: number } | null>(null);

  const fractionAt = (client: number) => {
    const o = origin.current;
    if (!o || o.size === 0) {
      return null;
    }
    return props.clamp((client - o.start) / o.size);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a FOCUSABLE separator is the ARIA window-splitter pattern (a separator that can be moved takes a tabindex and carries aria-valuenow); jsx-a11y models only the decorative kind.
    <div
      role="separator"
      aria-label={props.label}
      aria-orientation={columns ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(props.clamp(0) * 100)}
      aria-valuemax={Math.round(props.clamp(1) * 100)}
      aria-valuenow={Math.round(props.value * 100)}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- same reason: the splitter is reached and moved from the keyboard.
      tabIndex={0}
      data-testid={props.testId}
      onPointerDown={(e) => {
        const rect = props.containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        origin.current = columns ? { start: rect.left, size: rect.width } : { start: rect.top, size: rect.height };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const next = fractionAt(columns ? e.clientX : e.clientY);
        if (next !== null) {
          props.onChange(next);
        }
      }}
      onPointerUp={(e) => {
        if (!origin.current) {
          return;
        }
        origin.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        props.onCommit?.(props.value);
      }}
      onPointerCancel={() => {
        origin.current = null;
      }}
      onDoubleClick={() => props.onReset?.()}
      onKeyDown={(e) => {
        const back = columns ? 'ArrowLeft' : 'ArrowUp';
        const forward = columns ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== forward) {
          return;
        }
        e.preventDefault();
        const next = props.clamp(props.value + (e.key === forward ? step : -step));
        props.onChange(next);
        props.onCommit?.(next);
      }}
      className={cn(
        'shrink-0 touch-none bg-surface-soft transition select-none hover:bg-brand-amber/30 focus-visible:bg-brand-amber/40 focus-visible:outline-none',
        columns ? 'w-2 cursor-col-resize border-x border-border' : 'h-2 cursor-row-resize border-y border-border',
        props.className,
      )}
    />
  );
}
