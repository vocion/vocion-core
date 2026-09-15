'use client';

import { useEffect, useState } from 'react';

export type SelectionHit = { x: number; y: number; text: string };

/**
 * Watch for a text selection that lands inside `rootSelector` and report
 * where to anchor a floating action. Returns null when nothing (or too
 * little) is selected. Extracted from the Briefings pill so every
 * "Ask about this" surface behaves the same.
 * @param rootSelector - CSS selector the selection must be inside, e.g. `[data-briefing-root]`.
 * @param minLength - Shortest selection worth offering (default 4).
 */
export function useSelectionWatcher(rootSelector: string | undefined, minLength = 4): [SelectionHit | null, () => void] {
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
        if (!anchor?.closest(rootSelector)) {
          setHit(null);
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setHit({ x: rect.left + rect.width / 2, y: rect.top, text });
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [rootSelector, minLength]);

  const clear = () => {
    setHit(null);
    window.getSelection()?.removeAllRanges();
  };
  return [hit, clear];
}
