'use client';

import { useCallback, useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';
import { movePin as movePinPure, togglePin as togglePinPure } from './navPins';

/**
 * Per-user sidebar prefs with a localStorage fast path and the
 * `user_nav_pref` row as the truth: read local on mount so the first paint
 * has the pins, then reconcile with the server and write back on change.
 */

const PINS_KEY = 'vocion:nav:pins';
const DISMISSED_KEY = 'vocion:nav:dismissed';

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

export function useNavPrefs() {
  const [pins, setPins] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    // Fast path, then truth. The set calls are the intended SSR-safe restore
    // (the server render has no storage), not a cascading update.
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- SSR-safe restore
    setPins(readList(PINS_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- SSR-safe restore
    setDismissed(readList(DISMISSED_KEY));
    let cancelled = false;
    client.nav.getPrefs()
      .then((p) => {
        if (cancelled) {
          return;
        }
        setPins(p.pins);
        setDismissed(p.dismissed);
        writeList(PINS_KEY, p.pins);
        writeList(DISMISSED_KEY, p.dismissed);
      })
      .catch(() => { /* offline: the local copy stands */ });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistPins = useCallback((next: string[]) => {
    setPins(next);
    writeList(PINS_KEY, next);
    void client.nav.setPins({ pins: next }).catch(() => { /* retried on next change */ });
  }, []);

  const togglePin = useCallback((url: string) => persistPins(togglePinPure(pins, url)), [pins, persistPins]);
  const movePin = useCallback((url: string, toIndex: number) => persistPins(movePinPure(pins, url, toIndex)), [pins, persistPins]);

  const dismiss = useCallback((id: string) => {
    const next = dismissed.includes(id) ? dismissed : [...dismissed, id];
    setDismissed(next);
    writeList(DISMISSED_KEY, next);
    void client.nav.dismiss({ id }).catch(() => {});
  }, [dismissed]);

  return { pins, dismissed, togglePin, movePin, dismiss, isPinned: (url: string) => pins.includes(url) };
}
