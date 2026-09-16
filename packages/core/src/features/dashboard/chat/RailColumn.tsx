'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { PreviewPane } from '@/features/preview/PreviewPane';
import { useOpenPreviewRef } from '@/features/preview/previewState';
import { cn } from '@/utils/Helpers';
import { claimColumn, columnOwner, publishDockOpen, RAIL_INSET_VAR, subscribeColumnOwner } from './dockState';
import { clampRailSplit, RAIL_MAX_FRACTION, RAIL_MIN_WIDTH, RAIL_SPLIT_DEFAULT, RAIL_SPLIT_MIN, readStoredRailSplit, writeStoredRailSplit } from './railState';

/**
 * THE right column. One width, one resize handle, two stacked panes.
 *
 * Chris, 2026-09-16: *"I don't want to have more than 1 sidebar at a time.
 * Find a way to unify the Chat/Preview sidebars? either as tabs when both are
 * present? or top/bottom layout…"*
 *
 * Stacked, not tabbed, and the reason is the point of both features: you open
 * a preview in order to ask about it. A tab makes you choose between the
 * evidence and the question, and hides the evidence at exactly the moment you
 * want to talk about it. So:
 *
 *   ┌──────────────┐  preview — what you are looking at
 *   ├─ ─ ─ ─ ─ ─ ─ ┤  a divider you can drag; its position persists
 *   └──────────────┘  chat — what you are doing about it
 *
 * Either pane closes on its own. Closing the preview gives the column back to
 * chat; closing chat leaves the preview full height; closing both closes the
 * column. The column's WIDTH is one width for the column, never one per pane,
 * and it stays the rail's existing width and resize behaviour.
 *
 * Two components can draw this column — `ChatDock` wherever a rail is mounted,
 * and the preview's own host on the pages that have no rail (the decision
 * sheets). Exactly one draws, and the dock wins, because the dock is the one
 * that can hold both panes. The claim lives in `dockState.ts` so neither holds
 * a reference to the other.
 */

/** Below this the column is a sheet; a small screen shows one pane at a time. */
export type RailColumnProps = {
  /** The chat pane's content, or null when there is no chat here. */
  'chat': ReactNode | null;
  /** Rendered instead of the column when nothing is open (the edge tab). */
  'closed'?: ReactNode;
  /** True while the viewport is too narrow for a side-by-side column. */
  'narrow'?: boolean;
  /** The column's width in px. */
  'width': number;
  /** The resize handle, drawn by the owner so it keeps its own drag state. */
  'resizeHandle'?: ReactNode;
  /** `dock` beats `preview` when both are mounted. */
  'priority': 'dock' | 'preview';
  'aria-label': string;
  /** Wrap the column — the sheet does this. */
  'frame'?: (content: ReactNode) => ReactNode;
};

/**
 * Whether this component instance is the one that should draw the column.
 * @param priority
 */
function useOwnsColumn(priority: 'dock' | 'preview'): boolean {
  const id = useId();
  useEffect(() => claimColumn(id, priority), [id, priority]);
  return useSyncExternalStore(subscribeColumnOwner, () => columnOwner(id, priority), () => false);
}

/**
 * @param props
 */
export function RailColumn(props: RailColumnProps) {
  const owns = useOwnsColumn(props.priority);
  const previewRef = useOpenPreviewRef();
  const column = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(RAIL_SPLIT_DEFAULT);
  const dragging = useRef<{ top: number; height: number } | null>(null);

  // The server renders the default split and the browser adopts its own
  // remembered one after mount — localStorage does not exist during the
  // server render, and a split that differs between the two is a hydration
  // mismatch. Same shape as the rail's remembered width.
  useEffect(() => {
    const stored = readStoredRailSplit();
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
      setSplit(stored);
    }
  }, []);

  const hasChat = props.chat !== null;
  const hasPreview = previewRef !== null;
  const open = hasChat || hasPreview;
  // A small screen shows one pane: the preview REPLACES the sheet's content
  // and its close control becomes "back", rather than halving a phone.
  const stacked = hasChat && hasPreview && !props.narrow;

  // The column never covers the record it is about: the shell's page gutter
  // pads by exactly this much while it stands beside the page.
  useEffect(() => {
    if (!owns) {
      return;
    }
    publishDockOpen(open && !props.narrow, props.width);
    return () => publishDockOpen(false);
  }, [owns, open, props.narrow, props.width]);

  const onDividerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = column.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    dragging.current = { top: rect.top, height: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onDividerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d || d.height === 0) {
      return;
    }
    setSplit(clampRailSplit((e.clientY - d.top) / d.height));
  }, []);

  const onDividerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      dragging.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setSplit((s) => {
        writeStoredRailSplit(s);
        return s;
      });
    }
  }, []);

  const onDividerKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
      return;
    }
    e.preventDefault();
    setSplit((s) => {
      const next = clampRailSplit(s + (e.key === 'ArrowDown' ? 0.05 : -0.05));
      writeStoredRailSplit(next);
      return next;
    });
  }, []);

  if (!owns) {
    return null;
  }
  if (!open) {
    return <>{props.closed ?? null}</>;
  }

  const preview = hasPreview && (
    <PreviewPane key={`${previewRef.type}:${previewRef.id}`} recordRef={previewRef} back={props.narrow && hasChat} />
  );

  const content = (
    <div ref={column} data-testid="rail-column" className="flex min-h-0 flex-1 flex-col">
      {stacked
        ? (
            <>
              {/* The split is flex-grow, not a percentage height: a pane sized
                  as a fraction of an auto-height parent collapses to nothing,
                  and grow states the same intent without depending on the
                  parent having resolved its own height first. */}
              <div className="flex min-h-0 flex-col overflow-hidden" style={{ flexGrow: split, flexBasis: 0 }}>
                {preview}
              </div>
              <div
                role="slider"
                aria-label="Resize the preview"
                aria-orientation="vertical"
                aria-valuemin={Math.round(RAIL_SPLIT_MIN * 100)}
                aria-valuemax={Math.round((1 - RAIL_SPLIT_MIN) * 100)}
                aria-valuenow={Math.round(split * 100)}
                tabIndex={0}
                data-testid="rail-divider"
                onPointerDown={onDividerDown}
                onPointerMove={onDividerMove}
                onPointerUp={onDividerUp}
                onPointerCancel={onDividerUp}
                onKeyDown={onDividerKey}
                className="h-2 shrink-0 cursor-row-resize touch-none border-y border-border bg-surface-soft transition select-none hover:bg-brand-amber/30 focus-visible:bg-brand-amber/40 focus-visible:outline-none"
              />
              <div className="flex min-h-0 flex-col" style={{ flexGrow: 1 - split, flexBasis: 0 }}>{props.chat}</div>
            </>
          )
        : hasPreview
          ? preview
          : <div className="flex min-h-0 flex-1 flex-col">{props.chat}</div>}
    </div>
  );

  if (props.frame) {
    return <>{props.frame(content)}</>;
  }

  return (
    <aside
      aria-label={props['aria-label']}
      data-testid="agent-rail"
      style={{ width: props.width }}
      className={cn('fixed top-16 right-0 z-40 flex h-[calc(100dvh-4rem)] flex-col border-l border-border bg-background shadow-(--shadow-pop)')}
    >
      {props.resizeHandle}
      {content}
    </aside>
  );
}

export { RAIL_INSET_VAR, RAIL_MAX_FRACTION, RAIL_MIN_WIDTH };
