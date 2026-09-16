'use client';

import { useEffect, useState } from 'react';

/**
 * The rail's open/collapse state, and the two ways to ask it to change —
 * the whole contract between the rail and anything that shares its edge.
 *
 * The dock publishes its state on the document (`data-dock-open`) and as a
 * window event whenever it opens or collapses; a page that wants to make room
 * reads it through `useDockOpen`. Going the other way, a surface that needs
 * the slot calls `yieldRail()` and later `restoreRail()`. No shared store, no
 * provider, and — the point — no other surface holding a reference to
 * `ChatDock`'s internals: this module is the seam, so the rail can be
 * rebuilt without breaking whoever borrows its edge.
 */

export const DOCK_STATE_EVENT = 'vocion:dock';
const ATTR = 'dockOpen';

/**
 * Ask the rail to collapse or open, from OUTSIDE the rail.
 *
 * Another surface that wants the rail's slot — the preview panel, which
 * stacks over the rail and restores it on close — sends this instead of
 * reaching into `ChatDock`'s state or synthesising a ⌘J. `restore: true`
 * says "put it back the way it was", which is the half a caller cannot
 * compute for itself: only the rail knows whether it was open before you
 * took the slot.
 *
 * The rail is the only listener. Nothing else may claim this event.
 */
export const RAIL_SET_EVENT = 'vocion:rail-set';

export type RailSetRequest = {
  /** True to open the rail, false to collapse it. Ignored when `restore` is set. */
  open?: boolean;
  /** Put the rail back to whatever it was before the last `yieldRail()`. */
  restore?: boolean;
  /**
   * Whether the change should be remembered as the PERSON's choice. A panel
   * borrowing the slot passes false: a rail collapsed by the preview opening
   * must not teach the browser that this person likes it collapsed.
   */
  persist?: boolean;
};

/**
 * Take the rail's slot: collapse it, without recording the collapse as a
 * preference, and remember whether it was open so `restoreRail()` can undo
 * exactly that.
 * @returns Whether the rail was open when you took the slot.
 */
export function yieldRail(): boolean {
  const wasOpen = typeof document !== 'undefined' && document.documentElement.dataset[ATTR] === 'true';
  requestRail({ open: false, persist: false });
  return wasOpen;
}

/** Give the rail its slot back, in the state it was in before `yieldRail()`. */
export function restoreRail(): void {
  requestRail({ restore: true });
}

/**
 * The low-level form of the two above — open or collapse the rail.
 * @param req - What to do.
 */
export function requestRail(req: RailSetRequest): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<RailSetRequest>(RAIL_SET_EVENT, { detail: req }));
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
 * Called by the dock whenever its open state settles.
 * @param open - True while the dock is expanded beside the page.
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
