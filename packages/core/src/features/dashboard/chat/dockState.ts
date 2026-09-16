'use client';

import { useEffect, useState } from 'react';

/**
 * THE right column: one width, one resize handle, and the two panes that can
 * stand in it.
 *
 * Chris, 2026-09-16: *"I don't want to have more than 1 sidebar at a time.
 * Find a way to unify the Chat/Preview sidebars?"* There is now one column
 * holding zero, one or two stacked panes separated by a draggable divider:
 *
 *   preview   on top — what you are looking at
 *   chat      below  — what you are doing about it
 *
 * **Stacked, not tabbed**, and the reason is the whole point of both features:
 * you open a preview in order to ask about it. A tab would make you choose
 * between the evidence and the question, and hide the evidence at exactly the
 * moment you want to talk about it.
 *
 * This module is the seam. The dock publishes the column's state on the
 * document (`data-dock-open`) and as a window event; a page that wants to make
 * room reads `useDockOpen`. Going the other way, anything that wants a pane
 * opened or closed sends an event. No shared store, no provider, and no other
 * surface holding a reference to `ChatDock`'s internals, so the column can be
 * rebuilt without breaking whoever stands in it.
 */

export const DOCK_STATE_EVENT = 'vocion:dock';
const ATTR = 'dockOpen';

/**
 * Ask the column to open or close the CHAT pane, from outside the column.
 *
 * Replaces the old `yieldRail()` / `restoreRail()` borrow, which existed only
 * because a second panel had to take the rail's slot. Nothing takes the slot
 * any more — the preview stands beside chat in the same column — so there is
 * nothing to borrow and nothing to restore.
 *
 * The column is the only listener. Nothing else may claim this event.
 */
export const RAIL_SET_EVENT = 'vocion:rail-set';

export type RailSetRequest = {
  /** True to open the chat pane, false to close it. */
  open?: boolean;
  /**
   * Whether the change is remembered as the PERSON's choice. A chat pane
   * closed by something other than the person passes false, so the browser
   * does not learn a preference nobody expressed.
   */
  persist?: boolean;
};

/**
 * Open or close the chat pane.
 * @param req - What to do.
 */
export function requestRail(req: RailSetRequest): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<RailSetRequest>(RAIL_SET_EVENT, { detail: req }));
}

/** Close the chat pane, leaving whatever else is in the column. */
export function closeChatPane(): void {
  requestRail({ open: false, persist: true });
}

/** Open the chat pane beside whatever else is in the column. */
export function openChatPane(): void {
  requestRail({ open: true, persist: true });
}

/**
 * Who is drawing the column right now.
 *
 * Two components can: `ChatDock`, wherever a rail is mounted, and the preview's
 * own host on the pages that have no rail (the decision sheets). Exactly one
 * draws, and the dock wins, because the dock is the one that can hold both
 * panes. This is a claim rather than a provider for the same reason as the
 * rest of this module: no surface holds a reference to another.
 */
const owners = new Set<string>();
const ownerListeners = new Set<() => void>();

function ownerEmit(): void {
  ownerListeners.forEach(l => l());
}

/**
 * @param id - A stable id for the claimant.
 * @param priority - `dock` beats `preview`.
 */
export function claimColumn(id: string, priority: 'dock' | 'preview'): () => void {
  const key = `${priority === 'dock' ? '0' : '1'}:${id}`;
  owners.add(key);
  ownerEmit();
  return () => {
    owners.delete(key);
    ownerEmit();
  };
}

/**
 * Whether `id` is the claimant that should draw the column.
 * @param id
 * @param priority
 */
export function columnOwner(id: string, priority: 'dock' | 'preview'): boolean {
  const key = `${priority === 'dock' ? '0' : '1'}:${id}`;
  return [...owners].sort()[0] === key;
}

/**
 * Subscribe to changes in who owns the column.
 * @param listener
 */
export function subscribeColumnOwner(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

/**
 * How much room the open rail is taking on the right, as a CSS custom
 * property on the root.
 *
 * The rail is `fixed` and portalled to the document (see `ChatDock`), so it
 * takes no space in the page's layout — that is what makes a record page full
 * width and what keeps the rail's geometry the viewport's rather than some
 * page gutter's. But an open panel over the text is still an open panel over
 * the text, so the shell's page gutter pads itself by exactly this much while
 * the rail is open: nothing is covered, and the page returns to full width
 * the moment it closes. Zero when the rail is collapsed or is a sheet.
 */
export const RAIL_INSET_VAR = '--rail-inset';

/**
 * Called by whoever draws the column whenever its state settles. `open` means
 * the COLUMN is standing beside the page — either pane is enough.
 * @param open - True while the column is expanded beside the page.
 * @param width - Its current width in px; ignored when closed.
 */
export function publishDockOpen(open: boolean, width = 0): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset[ATTR] = open ? 'true' : 'false';
  document.documentElement.style.setProperty(RAIL_INSET_VAR, open ? `${Math.round(width)}px` : '0px');
  window.dispatchEvent(new CustomEvent(DOCK_STATE_EVENT, { detail: { open } }));
}

/**
 * Read at mount, then follow the dock's announcements. Server render and the
 * first client render say closed, so nothing depends on it for layout paint.
 */
export function useDockOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setOpen(document.documentElement.dataset[ATTR] === 'true');
    const onChange = (e: Event) => setOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open));
    window.addEventListener(DOCK_STATE_EVENT, onChange);
    return () => window.removeEventListener(DOCK_STATE_EVENT, onChange);
  }, []);
  return open;
}
