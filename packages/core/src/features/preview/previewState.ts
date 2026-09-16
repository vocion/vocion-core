'use client';

import type { RecordRef, RecordType } from '@/services/chat/pageContext';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { dismissSelectionControl } from '@/features/comments/AnchoredComments';
import { parsePreviewKey, PREVIEW_PARAM, previewKey } from '@/libs/preview/types';
import { RECORD_TYPES } from '@/services/chat/pageContext';

/**
 * Which preview is open, and who is showing it.
 *
 * The open preview lives in the URL (`?preview=<type>:<id>`), for three
 * reasons that are really one reason — a preview is a place, not a mode:
 * it is linkable, it survives a reload, and the Back button closes it.
 *
 * Any number of surfaces may render `<PreviewPanel/>` — an evidence list does
 * not know whether the page already has one, or whether it has a chat rail
 * that will draw the column instead. Exactly one paints; `claimColumn` in
 * `dockState.ts` settles which, and the dock wins.
 *
 * And one column on the right, not two panels: the preview stands ABOVE chat
 * in the same column (`features/dashboard/chat/RailColumn`), so there is
 * nothing to borrow from the rail and nothing to give back. Opening one does
 * stand the selection control down — `dismissSelectionControl()`, an event,
 * so nothing here holds a reference to the comment layer — because a floating
 * control about a passage on this page and a panel about a record on another
 * are two things the person asked for one of.
 */

function isRecordType(s: string): s is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(s);
}

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(l => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function readSearch(): string {
  return window.location.search;
}

/** The element that opened the current preview, so Escape can hand focus back. */
let opener: HTMLElement | null = null;

function writeParam(value: string | null): void {
  const params = new URLSearchParams(window.location.search);
  if (value === null) {
    params.delete(PREVIEW_PARAM);
  } else {
    params.set(PREVIEW_PARAM, value);
  }
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  // push, not replace: Back must close the preview rather than leave the page.
  window.history.pushState(window.history.state, '', next);
  emit();
}

/** The ref the URL says is open, or null. */
export function useOpenPreviewRef(): Pick<RecordRef, 'type' | 'id'> | null {
  const search = useSyncExternalStore(subscribe, readSearch, () => '');
  return parsePreviewKey(new URLSearchParams(search).get(PREVIEW_PARAM), isRecordType);
}

/**
 * Open a preview, remembering what opened it. Closing returns focus there.
 * @param ref
 * @param from - The element the person activated.
 */
export function openPreview(ref: Pick<RecordRef, 'type' | 'id'>, from: HTMLElement | null): void {
  opener = from;
  dismissSelectionControl();
  writeParam(previewKey(ref));
}

/** Close the open preview and hand focus back to whatever opened it. */
export function closePreview(): void {
  const back = opener;
  opener = null;
  writeParam(null);
  back?.focus();
}

/**
 * Escape closes the panel. Bound on the document rather than inside it so the
 * panel never has to hold focus: the page's own shortcuts — the decision
 * verbs, `j`/`k` — keep working with a preview open, which is the whole point
 * of a peek.
 * @param active - Whether a preview is open.
 */
export function useEscapeToClose(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        closePreview();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

/**
 * Bound opener for a trigger element.
 * @param ref
 */
export function usePreviewOpener(ref: Pick<RecordRef, 'type' | 'id'>): (event: { currentTarget: HTMLElement }) => void {
  const key = previewKey(ref);
  return useCallback((event: { currentTarget: HTMLElement }) => {
    const [type, ...rest] = key.split(':');
    openPreview({ type: type as RecordType, id: rest.join(':') }, event.currentTarget);
  }, [key]);
}
