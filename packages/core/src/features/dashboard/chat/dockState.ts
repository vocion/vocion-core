'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the conversation dock is open, for pages that give way to it (058).
 *
 * The dock publishes its state on the document (`data-dock-open`) and as a
 * window event whenever it opens or collapses; a page that wants to make room
 * (the review queue folds its Up-next rail) reads it through `useDockOpen`.
 * No shared store, no provider: the dock and the page are siblings under the
 * shell and this is the one bit they share.
 */

export const DOCK_STATE_EVENT = 'vocion:dock';
const ATTR = 'dockOpen';

/**
 * Called by the dock whenever its open state settles.
 * @param open - True while the dock is expanded.
 */
export function publishDockOpen(open: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset[ATTR] = open ? 'true' : 'false';
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
