'use client';

import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { SplitDivider } from '@/components/ui/split-divider';
import { PreviewPane } from '@/features/preview/PreviewPane';
import { useOpenPreviewRef } from '@/features/preview/previewState';
import { cn } from '@/utils/Helpers';
import { claimColumn, columnOwner, openChatPane, publishDockOpen, RAIL_INSET_VAR, subscribeColumnOwner } from './dockState';
import { clampRailSplit, RAIL_MAX_FRACTION, RAIL_MIN_WIDTH, RAIL_SPLIT_DEFAULT, readStoredRailSplit, writeStoredRailSplit } from './railState';

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
  //
  // Two cases do not inset, and neither is an exception to that rule. A sheet
  // (`frame`, below the breakpoint) is a modal overlay by design. And a column
  // with no room left to reflow into — wider than half the viewport — would
  // pad the page by its own width and leave a column of nothing.
  useEffect(() => {
    if (!owns) {
      return;
    }
    const roomLeft = !props.frame && props.width > 0 && props.width < window.innerWidth / 2;
    publishDockOpen(open && roomLeft, props.width);
    return () => publishDockOpen(false);
  }, [owns, open, props.frame, props.width]);

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
              {/* THE divider — the same component the conversation surface
                  uses on its own split, turned ninety degrees. */}
              <SplitDivider
                layout="rows"
                containerRef={column}
                value={split}
                clamp={clampRailSplit}
                label="Resize the preview"
                testId="rail-divider"
                onChange={setSplit}
                onCommit={writeStoredRailSplit}
                onReset={() => {
                  setSplit(RAIL_SPLIT_DEFAULT);
                  writeStoredRailSplit(RAIL_SPLIT_DEFAULT);
                }}
              />
              <div className="flex min-h-0 flex-col" style={{ flexGrow: 1 - split, flexBasis: 0 }}>{props.chat}</div>
            </>
          )
        : hasPreview
          ? (
              <>
                {preview}
                {/* The preview holds the column on its own, so the rail's edge
                    tab is not on screen to open chat with. Without this the
                    only way back to the conversation is ⌘J, which is a
                    shortcut, not an affordance — and asking about what you are
                    reading is the reason the preview exists. Only where a dock
                    is actually mounted: on a page with no rail there is
                    nothing to open. */}
                {props.priority === 'dock' && !props.narrow && (
                  <button
                    type="button"
                    onClick={openChatPane}
                    data-testid="rail-open-chat"
                    className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-border text-[13px] text-muted-foreground transition hover:bg-surface-soft hover:text-foreground"
                  >
                    <MessageSquare className="size-3.5" aria-hidden />
                    Ask about this
                  </button>
                )}
              </>
            )
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
