'use client';

import type { RecordRef, RecordType } from '@/services/chat/pageContext';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { dismissSelectionControl } from '@/features/comments/AnchoredComments';
import { parsePreviewKey, PREVIEW_PARAM, previewKey } from '@/libs/preview/types';
import { RECORD_TYPES, recordFromPath } from '@/services/chat/pageContext';

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

/**
 * THE PANE FOLDED ON A PHONE (Chris, 2026-10-23: "if 'open' but collapsed on
 * mobile, I should have a way to see that and expand the drawer"). Folding
 * keeps every entry and the URL; the drawer shrinks to a bar above the
 * composer that says what is open. Anything newly opened unfolds it.
 */
let collapsed = false;

/**
 * THE PANE'S STACK — what was open in it before the preview on top.
 *
 * Chris, 2026-10-23: open a record, then the thread's background work, and
 * the second must not become a second side surface; it stands on top of the
 * first in the same pane, and a back control returns to it ("our standard
 * sidebar panes, that can stack if needed"). Every opening already pushes
 * a history entry, so the browser's Back walks down the same stack; this
 * list only lets the pane say what is underneath and offer it. It lives in
 * memory for the page it was built on: a reload or another page starts with
 * none, and the pane simply has no back control.
 *
 * Pure: the keys under the top after `next` opens on top of `current`. An
 * item already underneath moves up rather than appearing twice.
 * @param stack - What was underneath.
 * @param current - What the pane shows now, or null when it is closed.
 * @param next - What opens.
 */
export function stackAfterOpen(stack: readonly string[], current: string | null, next: string): string[] {
  if (!current || current === next) {
    return current ? [...stack] : [];
  }
  return [...stack.filter(k => k !== next && k !== current), current];
}

/**
 * Pure: the stack once the URL says `current` is on top — after Back, the
 * pane's own back control, or a close. A key found underneath means the
 * person walked back to it, so it and everything above it come off.
 * @param stack - What was underneath.
 * @param current - What the URL says is open.
 */
export function stackAfterUrl(stack: readonly string[], current: string | null): readonly string[] {
  if (current === null) {
    return stack.length === 0 ? stack : [];
  }
  const at = stack.lastIndexOf(current);
  return at === -1 ? stack : stack.slice(0, at);
}

let stack: readonly string[] = [];
let stackPath: string | null = null;

function currentKey(): string | null {
  return new URLSearchParams(window.location.search).get(PREVIEW_PARAM);
}

/** The stack as the URL now reads it; the same array while nothing moved. */
function readStack(): readonly string[] {
  if (window.location.pathname !== stackPath) {
    if (stack.length > 0) {
      stack = [];
    }
    return stack;
  }
  const next = stackAfterUrl(stack, currentKey());
  if (next !== stack) {
    stack = next;
  }
  return stack;
}

const NO_STACK: readonly string[] = [];

/** What each preview opened on this page was called, so the back control can name it. */
const titles = new Map<string, string>();

/**
 * Remember what a preview is called once its pane has read it.
 * @param key - Its `<type>:<id>`.
 * @param title - Its title.
 */
export function rememberPreviewTitle(key: string, title: string): void {
  titles.set(key, title);
}

/**
 * What a preview underneath is called: its read title, or null before it was read.
 * @param key - Its `<type>:<id>`.
 */
export function previewTitle(key: string): string | null {
  return titles.get(key) ?? null;
}

function writeParam(value: string | null, mode: 'push' | 'replace' = 'push'): void {
  const params = new URLSearchParams(window.location.search);
  if (value === null) {
    params.delete(PREVIEW_PARAM);
  } else {
    params.set(PREVIEW_PARAM, value);
  }
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  // push, not replace: Back must close the preview rather than leave the page.
  //
  // `null`, never `window.history.state`, so the router ADOPTS the URL. Next
  // patches `pushState` and folds a write into its own URL only when the
  // state it is handed is not already its own (`__NA`); the router's state
  // was passed here, so it skipped the write and kept the URL without
  // `?preview=`. Its next commit — any `router.refresh()`, the feature
  // page's live refresh every 5 s — then wrote that URL back with
  // `replaceState`, and the pane closed (Chris, 2026-09-30, #269). Handed
  // `null`, the patch copies the router's own history state onto the entry
  // itself, so Back still traverses, and every later commit keeps the param.
  if (mode === 'replace') {
    window.history.replaceState(null, '', next);
  } else {
    window.history.pushState(null, '', next);
  }
  emit();
}

/**
 * Whether a preview may open on its own right now. A running workspace tour
 * (`features/dashboard/WorkspaceTour`) directs attention step by step, and a
 * pane that opens itself mid-run splits the column the tour is pointing at
 * and hides the work it asked people to watch (Chris, 2026-10-02). While a
 * tour is up, what a turn makes waits for the tour's own "tap to open".
 */
export function previewMayOpenItself(): boolean {
  return typeof document === 'undefined' || document.querySelector('[data-tour-chrome]') === null;
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
  // THE PAGE'S OWN RECORD IS NEVER PEEKED BESIDE ITSELF (Chris, 2026-09-30,
  // product #25: a rename from the docked chat opened a "StampSend" pane next
  // to the StampSend page). The page is already showing it and re-reads
  // itself in place when it changes (`VersionWatch`); a pane would be the
  // same record twice. So a chat link, a turn's new-record event or a row
  // that names the record on the page opens nothing.
  if (typeof window !== 'undefined' && isPageRecord(ref, window.location.pathname)) {
    return;
  }
  opener = from;
  dismissSelectionControl();
  collapsed = false;
  const key = previewKey(ref);
  stack = stackAfterOpen(readStack(), currentKey(), key);
  stackPath = window.location.pathname;
  writeParam(key);
}

/**
 * Open a preview IN PLACE of the current history entry, with nothing
 * underneath — what a page does when it arrives already showing something
 * (the conversation route opening its newest artifact), so Back leaves the
 * page instead of closing what it arrived with.
 * @param ref - What opens.
 * @param drop - Older query params this one replaces (`artifact`), removed in the same write.
 */
export function replacePreview(ref: Pick<RecordRef, 'type' | 'id'>, drop: readonly string[] = []): void {
  collapsed = false;
  stack = [];
  stackPath = window.location.pathname;
  if (drop.length > 0) {
    const params = new URLSearchParams(window.location.search);
    for (const name of drop) {
      params.delete(name);
    }
    const search = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
  }
  writeParam(previewKey(ref), 'replace');
}

/**
 * What is underneath the preview on top, nearest last — empty when the pane
 * has nothing to go back to.
 */
export function usePreviewStack(): readonly string[] {
  return useSyncExternalStore(subscribe, readStack, () => NO_STACK);
}

/**
 * Back to what the pane showed before the preview on top. The browser's own
 * history holds that entry, so this is its Back; should the entry it lands
 * on show something else, the URL is set to what the pane promised.
 */
export function previewBack(): void {
  const target = readStack().at(-1);
  if (!target) {
    return;
  }
  const settle = () => {
    window.removeEventListener('popstate', settle);
    if (currentKey() !== target) {
      writeParam(target, 'replace');
    }
  };
  window.addEventListener('popstate', settle);
  window.history.back();
}

/**
 * Pure: the stack and the URL's key once `key` closes. Closing what is on top
 * shows what was under it; closing something underneath only takes it out of
 * the stack. Null `current` afterwards means the pane is empty and goes away.
 * @param stack - What was underneath.
 * @param current - What the pane shows now.
 * @param key - The entry to close.
 */
export function stackAfterClose(stack: readonly string[], current: string | null, key: string): { stack: readonly string[]; current: string | null } {
  if (key !== current) {
    return { stack: stack.filter(k => k !== key), current };
  }
  const below = stack.at(-1) ?? null;
  return { stack: below === null ? [] : stack.slice(0, -1), current: below };
}

/**
 * Close ONE entry of the pane (a tab's X on a phone, an artifact's close):
 * the one on top gives the pane to what was under it, one underneath just
 * leaves. The last one closes the pane.
 * @param key - Its `<type>:<id>`.
 */
export function closePreviewEntry(key: string): void {
  const next = stackAfterClose(readStack(), currentKey(), key);
  if (next.current === null) {
    closePreview();
    return;
  }
  stack = next.stack;
  stackPath = window.location.pathname;
  if (next.current === currentKey()) {
    emit();
    return;
  }
  writeParam(next.current, 'replace');
}

/**
 * Put an entry already in the pane on top (a tab on a phone). It is an
 * opening like any other, so Back walks it.
 * @param key - Its `<type>:<id>`.
 */
export function showPreviewEntry(key: string): void {
  const ref = parsePreviewKey(key, isRecordType);
  if (ref) {
    openPreview(ref, null);
  }
}

function readCollapsed(): boolean {
  return collapsed;
}

/**
 * Fold or unfold the phone drawer.
 * @param next - Folded.
 */
export function setPaneCollapsed(next: boolean): void {
  if (collapsed !== next) {
    collapsed = next;
    emit();
  }
}

/** Whether the phone drawer is folded to its bar. */
export function usePaneCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readCollapsed, () => false);
}

/** Ref types that name one `business_object` by id — one record, two spellings. */
const RECORD_REF_TYPES: ReadonlySet<string> = new Set(['object', 'request']);

/**
 * Whether a ref is the record the page at this path is about
 * (`recordFromPath`) — a record by either spelling, or the run on a run's page.
 * @param ref - What would open.
 * @param path - The page's path.
 */
export function isPageRecord(ref: Pick<RecordRef, 'type' | 'id'>, path: string): boolean {
  const here = recordFromPath(path);
  if (!here || String(here.id) !== String(ref.id)) {
    return false;
  }
  return here.type === ref.type || (RECORD_REF_TYPES.has(here.type) && RECORD_REF_TYPES.has(ref.type));
}

/** Close the open preview and hand focus back to whatever opened it. */
export function closePreview(): void {
  const back = opener;
  opener = null;
  collapsed = false;
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
