'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { useCallback, useEffect, useMemo } from 'react';
import { previewKey } from '@/libs/preview/types';
import { openPreview, useOpenPreviewRef } from './previewState';

/**
 * A list whose rows are references rather than tasks.
 *
 * `docs/design/patterns.md` § *A row is a reference, or it is the task*: a
 * list you are scanning to choose from previews (search, artifacts, evidence),
 * a list that IS your work navigates (Review queue). The list declares which, and
 * this hook is how it declares "preview".
 *
 * What it gives a list, so no list re-derives any of it:
 *
 *   - the selected row, read from the URL — so a preview is linkable, survives
 *     a reload, and the back button closes it;
 *   - `select(i)` for the rows to call on a plain click;
 *   - `j` / `k` / arrows to move the selection with the preview following, and
 *     Enter to open the detail page. That is what makes preview-by-default
 *     better than navigation rather than merely different: you scan without
 *     clicking, and you commit when you mean to.
 *
 * Nothing here touches the list's own state, so the query, the filters and the
 * scroll position survive opening and closing a preview.
 */

export type PreviewListItem = {
  /** What the row points at. */
  ref: Pick<RecordRef, 'type' | 'id'>;
  /** Where Enter (and ⌘-click, through the row's `href`) goes. */
  href?: string;
};

export type PreviewList = {
  /** Index of the row the preview is showing, or -1. */
  selected: number;
  /** Open the preview for one row. */
  select: (index: number) => void;
};

/**
 * @param items - The rows, in the order they are rendered.
 * @param navigate - Open a detail page (Enter). Omit to leave Enter alone.
 */
export function usePreviewList(items: readonly PreviewListItem[], navigate?: (href: string) => void): PreviewList {
  const open = useOpenPreviewRef();
  const keys = useMemo(() => items.map(i => previewKey(i.ref)), [items]);
  const selected = open ? keys.indexOf(previewKey(open)) : -1;

  const select = useCallback((index: number) => {
    const item = items[index];
    if (item) {
      openPreview(item.ref, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
  }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) {
        return;
      }
      // Never steal a keystroke from someone typing — the search box on these
      // pages is the whole point of them.
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) {
        return;
      }
      if (items.length === 0) {
        return;
      }
      const down = e.key === 'j' || e.key === 'ArrowDown';
      const up = e.key === 'k' || e.key === 'ArrowUp';
      if (down || up) {
        e.preventDefault();
        const next = selected < 0 ? (down ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, selected + (down ? 1 : -1)));
        select(next);
        return;
      }
      if (e.key === 'Enter' && selected >= 0 && navigate) {
        const href = items[selected]?.href;
        if (href) {
          e.preventDefault();
          navigate(href);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items, selected, select, navigate]);

  return { selected, select };
}
