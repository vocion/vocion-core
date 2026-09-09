'use client';

import { useCallback, useEffect, useState } from 'react';

const PINNED_KEY = 'vocion:nav:pinned';

/**
 * Pinned sidebar items — a per-browser list of nav URLs the user chose to keep
 * at the top of the sidebar (the ElevenLabs "Pinned" pattern). Stored in
 * localStorage, restored after mount so SSR renders no pins and hydration
 * matches.
 * @returns The pinned URLs, a toggle, and a predicate.
 */
export function usePinnedNav() {
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- SSR-safe restore of a client-only value; hydration must render the default first
        setPinned(parsed.filter((u): u is string => typeof u === 'string'));
      }
    } catch { /* private mode / bad JSON — start unpinned */ }
  }, []);

  const togglePin = useCallback((url: string) => {
    setPinned((prev) => {
      const next = prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url];
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const isPinned = useCallback((url: string) => pinned.includes(url), [pinned]);

  return { pinned, togglePin, isPinned };
}
