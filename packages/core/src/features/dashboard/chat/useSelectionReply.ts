'use client';

import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { openAgentSurface } from './agentSurface';

/** A passage is worth quoting from four characters; below that it is a click. */
const MIN_CHARS = 4;

export type SelectionHit = { text: string; x: number; y: number; /** The container's width when read — for clamping the toolbar. */ width: number };

/**
 * Highlight-to-reply on the transcript — the document frame's "Ask" on a
 * passage, for the conversation itself (principle 6: one shape).
 *
 * Watches the selection inside `container`; a non-empty selection that starts
 * and ends in it yields a hit positioned in the container's own coordinates
 * (it is the scrolling element, so the toolbar scrolls with the text).
 * `reply()` hands the passage to whatever agent surface owns this page
 * through the ONE entry function: the surface claims it, quotes the passage
 * as `page_context.selection` on the next turn and focuses its composer —
 * exactly what a highlighted sentence in a rendered document does today.
 * @param container - The scrolling transcript element.
 */
export function useSelectionReply(container: RefObject<HTMLElement | null>) {
  const [hit, setHit] = useState<SelectionHit | null>(null);

  useEffect(() => {
    const read = () => {
      const el = container.current;
      const sel = typeof window === 'undefined' ? null : window.getSelection();
      if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setHit(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
        setHit(null);
        return;
      }
      // A selection that starts in the composer or a button is not a quote.
      const anchor = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      if (anchor?.closest('textarea, input, button, [data-selection-toolbar]')) {
        setHit(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < MIN_CHARS) {
        setHit(null);
        return;
      }
      const r = range.getBoundingClientRect();
      const host = el.getBoundingClientRect();
      setHit({ text, x: r.left + r.width / 2 - host.left, y: r.top - host.top + el.scrollTop, width: el.clientWidth });
    };
    const onUp = () => setTimeout(read, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
        setTimeout(read, 0);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest('[data-selection-toolbar]'))) {
        setHit(null);
      }
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [container]);

  const reply = useCallback(() => {
    if (!hit) {
      return;
    }
    const text = hit.text;
    setHit(null);
    window.getSelection()?.removeAllRanges();
    openAgentSurface(
      {
        context: {
          path: window.location.pathname,
          title: document.title,
          selection: { text, quote: true },
          openedFrom: true,
        },
        fallbackContext: text,
      },
      // A transcript is always inside a surface that claims the request; the
      // fallback is for a transcript rendered somewhere with none, and a
      // full navigation there is fine. No router hook, so MessageList stays
      // mountable anywhere.
      (href) => {
        window.location.assign(href);
      },
    );
  }, [hit]);

  return { hit, reply, clear: () => setHit(null) };
}
