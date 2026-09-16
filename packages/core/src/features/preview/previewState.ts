'use client';

import type { RecordRef, RecordType } from '@/services/chat/pageContext';
import { useCallback, useEffect, useId, useSyncExternalStore } from 'react';
import { dismissSelectionControl } from '@/features/comments/AnchoredComments';
import { restoreRail, yieldRail } from '@/features/dashboard/chat/dockState';
import { parsePreviewKey, PREVIEW_PARAM, previewKey } from '@/libs/preview/types';
import { RECORD_TYPES } from '@/services/chat/pageContext';

/**
 * Which preview is open, and who is showing it.
 *
 * The open preview lives in the URL (`?preview=<type>:<id>`), for three
 * reasons that are really one reason — a preview is a place, not a mode:
 * it is linkable, it survives a reload, and the Back button closes it.
 *
 * At most one panel paints. Any number of surfaces may render `<PreviewPanel/>`
 * (an evidence list does not know whether the page already has one), so the
 * first mounted host claims the slot and the rest render nothing. No provider,
 * no shell edit — the same shape as `dockState.ts`.
 *
 * And at most one thing on the right, across all three members of the family
 * (`docs/design/patterns.md`): opening a preview borrows the rail's slot
 * through `yieldRail()` and stands the selection control down through
 * `dismissSelectionControl()`; closing gives the rail back with
 * `restoreRail()`, in the state it was in. Both are events — nothing here
 * holds a reference to the rail or to the comment layer.
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
/** Whether the rail was open when this preview took its slot. */
let railWasOpen = false;
/** Whether a preview currently holds the slot (swapping refs does not re-borrow). */
let holdingSlot = false;

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
  // Borrow the slot once. Swapping from one reference to another is still the
  // same borrow — asking again would read the rail as already closed and lose
  // the memory of how to put it back.
  if (!holdingSlot) {
    railWasOpen = yieldRail();
    holdingSlot = true;
  }
  dismissSelectionControl();
  writeParam(previewKey(ref));
}

/** Close the open preview and hand focus back to whatever opened it. */
export function closePreview(): void {
  const back = opener;
  opener = null;
  writeParam(null);
  if (holdingSlot) {
    holdingSlot = false;
    if (railWasOpen) {
      restoreRail();
    }
    railWasOpen = false;
  }
  back?.focus();
}

const hosts: string[] = [];
const hostListeners = new Set<() => void>();

function hostEmit(): void {
  hostListeners.forEach(l => l());
}

function subscribeHost(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

/**
 * True for exactly one mounted host at a time — the one that paints. Any
 * number of surfaces may render the panel; the first to mount claims the
 * slot, so "never two panels" holds without a provider or a shell edit.
 */
export function usePreviewHost(): boolean {
  const id = useId();
  useEffect(() => {
    hosts.push(id);
    hostEmit();
    return () => {
      const at = hosts.indexOf(id);
      if (at >= 0) {
        hosts.splice(at, 1);
      }
      hostEmit();
    };
  }, [id]);
  return useSyncExternalStore(subscribeHost, () => hosts[0] === id, () => false);
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
