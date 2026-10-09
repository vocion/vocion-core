'use client';

import type { PinTarget, ResolvedPin } from '@/libs/pins/pinTarget';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { SETUP_CHANGED_EVENT } from '@/features/dashboard/setupChanged';
import { client } from '@/libs/Orpc';
import { addPin, movePinWithin, pinKey, removePin } from '@/libs/pins/pinTarget';
import { togglePin as togglePinPure } from './navPins';

/**
 * Per-user sidebar prefs with a localStorage fast path and the
 * `user_nav_pref` row as the truth: read local on mount so the first paint
 * has the pins, then reconcile with the server and write back on change.
 *
 * ONE store for the page, not one per caller: the sidebar, a header's "Pin to
 * sidebar", a row's ⋯ menu, ⌘K and ⌘⇧P all read and write the same pins, so
 * pinning in one place shows in the others at once. An agent's pin arrives as
 * a Done receipt, which announces a change (`SETUP_CHANGED_EVENT`); the store
 * re-reads on it, and on an Undo of it.
 *
 * Object pins carry their live title and link (`objects`), read by the server
 * as this person each time. They are never cached locally: the cache is per
 * browser and pins are per workspace, so a cached title could be another
 * workspace's.
 */

const PINS_KEY = 'vocion:nav:pins';
const DISMISSED_KEY = 'vocion:nav:dismissed';

type NavPrefsState = { pins: string[]; dismissed: string[]; objects: ResolvedPin[] };

const EMPTY: NavPrefsState = { pins: [], dismissed: [], objects: [] };

let state: NavPrefsState = EMPTY;
let started = false;
// Bumped by every change this page makes, so a read that left before it
// cannot land after it and put the old list back.
let edits = 0;
const listeners = new Set<() => void>();

function readList(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(list));
  } catch { /* private mode */ }
}

function edit(next: Partial<NavPrefsState>) {
  edits += 1;
  setState(next);
}

function setState(next: Partial<NavPrefsState>) {
  state = { ...state, ...next };
  if (next.pins) {
    writeList(PINS_KEY, next.pins);
  }
  if (next.dismissed) {
    writeList(DISMISSED_KEY, next.dismissed);
  }
  listeners.forEach(l => l());
}

/** Re-read the prefs from the server (the truth). Offline, the local copy stands. */
async function refreshNavPrefs(): Promise<void> {
  const at = edits;
  try {
    const p = await client.nav.getPrefs();
    if (at !== edits) {
      return;
    }
    setState({ pins: p.pins, dismissed: p.dismissed, objects: p.objects });
  } catch { /* offline: the local copy stands */ }
}

function start() {
  if (started || typeof window === 'undefined') {
    return;
  }
  started = true;
  setState({ pins: readList(PINS_KEY), dismissed: readList(DISMISSED_KEY) });
  void refreshNavPrefs();
  window.addEventListener(SETUP_CHANGED_EVENT, () => void refreshNavPrefs());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;
const serverSnapshot = () => EMPTY;

function persistPins(next: string[]) {
  edit({ pins: next, objects: state.objects.filter(o => next.includes(o.key)) });
  void client.nav.setPins({ pins: next }).catch(() => { /* retried on next change */ });
}

/**
 * Pin a target. Shows at once when its title is known (a header knows it);
 * the server's answer then settles the row, or takes it back with its reason.
 * @param target - What to pin.
 * @param known - Its title and link, when the caller already has them.
 * @param known.title
 * @param known.href
 */
export async function pinTarget(target: PinTarget, known?: { title: string; href: string }): Promise<{ ok: boolean; error?: string }> {
  const key = pinKey(target);
  const before = state;
  edit({
    pins: addPin(state.pins, key),
    objects: known && target.kind !== 'page' && !state.objects.some(o => o.key === key) ? [...state.objects, { ...target, key, ...known }] : state.objects,
  });
  try {
    const res = await client.nav.pin({ target });
    edit({ pins: res.pins, objects: res.objects });
    return { ok: true };
  } catch (error) {
    edit({ pins: before.pins, objects: before.objects });
    return { ok: false, error: error instanceof Error ? error.message : 'Could not pin it.' };
  }
}

/**
 * Pin whatever the page at this path is about (⌘⇧P, "Pin this" in ⌘K).
 * @param path - The current pathname.
 */
export async function pinPath(path: string): Promise<{ ok: boolean; error?: string; title?: string }> {
  try {
    const res = await client.nav.pin({ path });
    edit({ pins: res.pins, objects: res.objects });
    return { ok: true, title: res.pin?.title };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not pin it.' };
  }
}

/**
 * Unpin by stored key: gone from the sidebar at once, the server settles it.
 * @param key - The stored pin.
 */
export async function unpinKey(key: string): Promise<void> {
  const before = state;
  edit({ pins: removePin(state.pins, key), objects: state.objects.filter(o => o.key !== key) });
  try {
    const res = await client.nav.unpin({ key });
    edit({ pins: res.pins, objects: res.objects });
  } catch {
    edit({ pins: before.pins, objects: before.objects });
  }
}

export function useNavPrefs() {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(start, []);

  const togglePin = useCallback((url: string) => persistPins(togglePinPure(state.pins, url)), []);
  /**
   * Move a pin to a place among the ones the person SEES (`visible`), so a
   * hidden pin (a deleted target) never shifts the drop.
   */
  const movePin = useCallback((key: string, toIndex: number, visible?: readonly string[]) => {
    persistPins(movePinWithin(state.pins, visible ?? state.pins, key, toIndex));
  }, []);

  const dismiss = useCallback((id: string) => {
    if (!state.dismissed.includes(id)) {
      edit({ dismissed: [...state.dismissed, id] });
    }
    void client.nav.dismiss({ id }).catch(() => {});
  }, []);

  return {
    pins: current.pins,
    dismissed: current.dismissed,
    objects: current.objects,
    togglePin,
    movePin,
    dismiss,
    isPinned: (key: string) => current.pins.includes(key),
  };
}

/**
 * Whether one target is pinned, and the two verbs on it — for a header
 * button, a row's ⋯ menu and the palette.
 * @param target - The thing, or null when the page is about nothing pinnable.
 */
export function usePin(target: PinTarget | null) {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(start, []);
  const key = target ? pinKey(target) : null;
  return {
    pinned: key !== null && current.pins.includes(key),
    key,
  };
}
