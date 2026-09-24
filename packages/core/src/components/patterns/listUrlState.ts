'use client';

import type { ListState, ListStateConfig } from './listState';
import { useCallback, useSyncExternalStore } from 'react';
import { applyListState, parseListState } from './listState';

/**
 * Binds the pure list-state helpers in `./listState` to `window.location`.
 * The helpers are re-exported for existing client imports; a server
 * component takes them from `./listState` or the patterns index, never
 * from this client module.
 */
export { applyListState, flipDirection, type ListState, type ListStateConfig, parseListState, type SortDirection, toggleChip } from './listState';

// --- the hook -------------------------------------------------------------

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function readSearch(): string {
  return window.location.search;
}

/**
 * The list's state, read from and written to the URL. The server snapshot is
 * the defaults, so a page rendered on the server hydrates cleanly and then
 * picks up the URL on the client.
 * @param config - The list's accepted keys and defaults.
 * @returns `[state, update]` — `update` takes a partial and writes the URL.
 */
export function useListUrlState(config: ListStateConfig): [ListState, (patch: Partial<ListState>) => void] {
  const search = useSyncExternalStore(subscribe, readSearch, () => '');
  const state = parseListState(search, config);

  const update = useCallback((patch: Partial<ListState>) => {
    const current = parseListState(window.location.search, config);
    const next = applyListState(window.location.search, { ...current, ...patch }, config);
    if (next !== window.location.search) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
      listeners.forEach(l => l());
    }
  }, [config]);

  return [state, update];
}
