'use client';

import { useEffect, useState } from 'react';

export type SelectionHit = { x: number; y: number; text: string };

/**
 * Regions that show their own selection toolbar (a record's body, a report),
 * by selector, while mounted. The shell's page-wide Ask yields to them, so a
 * selection never gets two toolbars.
 */
const ownedRoots = new Map<string, number>();

/**
 * Claim `rootSelector` for a region's own toolbar while the caller is mounted.
 * @param rootSelector - The region's selector, or undefined for none.
 */
export function useOwnSelectionRoot(rootSelector: string | undefined): void {
  useEffect(() => {
    if (!rootSelector) {
      return;
    }
    ownedRoots.set(rootSelector, (ownedRoots.get(rootSelector) ?? 0) + 1);
    return () => {
      const n = (ownedRoots.get(rootSelector) ?? 1) - 1;
      if (n <= 0) {
        ownedRoots.delete(rootSelector);
      } else {
        ownedRoots.set(rootSelector, n);
      }
    };
  }, [rootSelector]);
}

/**
 * Whether a node sits in a region with its own toolbar, or in something the
 * person is typing into.
 * @param node - Where the selection starts.
 */
function claimedElsewhere(node: Element): boolean {
  if (node.closest('input, textarea, [contenteditable="true"]')) {
    return true;
  }
  const owned = [...ownedRoots.keys()];
  return owned.length > 0 && Boolean(node.closest(owned.join(',')));
}

/**
 * Watch for a text selection that lands inside `rootSelector` and report
 * where to anchor a floating action. Returns null when nothing (or too
 * little) is selected. Extracted from the Briefings pill so every
 * "Ask about this" surface behaves the same.
 * @param rootSelector - CSS selector the selection must be inside, e.g. `[data-briefing-root]`.
 * @param minLength - Shortest selection worth offering (default 4).
 * @param yieldToOwned - Page-wide watchers only: ignore selections in a region that shows its own toolbar.
 */
export function useSelectionWatcher(rootSelector: string | undefined, minLength = 4, yieldToOwned = false): [SelectionHit | null, () => void] {
  const [hit, setHit] = useState<SelectionHit | null>(null);

  useEffect(() => {
    if (!rootSelector) {
      return;
    }
    const onMouseUp = () => {
      // Let the browser finalize the selection first.
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? '';
        if (!sel || sel.isCollapsed || text.length < minLength) {
          setHit(null);
          return;
        }
        const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
        if (!anchor?.closest(rootSelector) || (yieldToOwned && claimedElsewhere(anchor))) {
          setHit(null);
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setHit({ x: rect.left + rect.width / 2, y: rect.top, text });
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [rootSelector, minLength, yieldToOwned]);

  const clear = () => {
    setHit(null);
    window.getSelection()?.removeAllRanges();
  };
  return [hit, clear];
}
