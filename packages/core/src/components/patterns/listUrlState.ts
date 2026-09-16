'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * List state in the URL — tab, search, sort, direction, chip filters — so a
 * filtered list survives a reload, a back button and a shared link, and every
 * list page reads and writes the same five parameters.
 *
 * Pure helpers (`parseListState`, `applyListState`, `toggleChip`) do the work
 * and are unit-tested; `useListUrlState` binds them to `window.location`
 * through `history.replaceState`, which Next.js folds into its router, so no
 * page needs the app router mounted to filter a list (stories and the
 * browser tests render without one).
 *
 * Defaults are never written: a list at its default state has a clean URL.
 */

export type SortDirection = 'asc' | 'desc';

export type ListState = {
  tab: string;
  q: string;
  sort: string;
  dir: SortDirection;
  chips: string[];
};

export type ListStateConfig = {
  /** The state a clean URL means. */
  defaults: ListState;
  /** Accepted tab keys; an unknown tab in the URL falls back to the default. */
  tabs?: readonly string[];
  /** Accepted sort keys; an unknown sort falls back to the default. */
  sorts?: readonly string[];
  /** Accepted chip keys; unknown chips are dropped. */
  chips?: readonly string[];
  /**
   * Parameter prefix, for two lists on one page (`prefix: 'ledger'` reads
   * `ledger.tab`, `ledger.q`, …). Empty by default: `tab`, `q`, `sort`,
   * `dir`, `f`.
   */
  prefix?: string;
};

const KEYS = { tab: 'tab', q: 'q', sort: 'sort', dir: 'dir', chips: 'f' } as const;

function key(config: ListStateConfig, name: keyof typeof KEYS): string {
  return config.prefix ? `${config.prefix}.${KEYS[name]}` : KEYS[name];
}

/**
 * Read a list's state out of a search string. Unknown values fall back to the
 * defaults rather than erroring: a stale link still opens the list.
 * @param search - `location.search`, with or without the leading `?`.
 * @param config - The list's accepted keys and defaults.
 */
export function parseListState(search: string, config: ListStateConfig): ListState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const { defaults } = config;

  const tab = params.get(key(config, 'tab'));
  const sort = params.get(key(config, 'sort'));
  const dir = params.get(key(config, 'dir'));
  const chips = params.getAll(key(config, 'chips')).flatMap(v => v.split(',')).filter(Boolean);

  return {
    tab: tab && (!config.tabs || config.tabs.includes(tab)) ? tab : defaults.tab,
    q: params.get(key(config, 'q')) ?? defaults.q,
    sort: sort && (!config.sorts || config.sorts.includes(sort)) ? sort : defaults.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : defaults.dir,
    chips: config.chips ? chips.filter(c => config.chips!.includes(c)) : chips,
  };
}

/**
 * Write a list's state into a search string, leaving every parameter the list
 * does not own untouched (Storybook's `id`, a page's own params). Values equal
 * to the defaults are removed, so the clean state is the clean URL.
 * @param search - The current `location.search`.
 * @param state - The state to write.
 * @param config - The list's defaults and prefix.
 * @returns The new search string, `''` or `?…`.
 */
export function applyListState(search: string, state: ListState, config: ListStateConfig): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const { defaults } = config;

  const set = (name: keyof typeof KEYS, value: string, def: string) => {
    if (value === def || value === '') {
      params.delete(key(config, name));
    } else {
      params.set(key(config, name), value);
    }
  };
  set('tab', state.tab, defaults.tab);
  set('q', state.q, defaults.q);
  set('sort', state.sort, defaults.sort);
  set('dir', state.dir, defaults.dir);

  params.delete(key(config, 'chips'));
  const chips = [...state.chips].sort();
  if (chips.length > 0 && chips.join(',') !== [...defaults.chips].sort().join(',')) {
    params.set(key(config, 'chips'), chips.join(','));
  }

  const out = params.toString();
  return out ? `?${out}` : '';
}

/**
 * Multi-select chips: toggling a chip adds or removes it, preserving order.
 * @param active - The chips currently on.
 * @param chip - The chip clicked.
 */
export function toggleChip(active: readonly string[], chip: string): string[] {
  return active.includes(chip) ? active.filter(c => c !== chip) : [...active, chip];
}

/**
 * Flip a sort direction.
 * @param dir
 */
export function flipDirection(dir: SortDirection): SortDirection {
  return dir === 'asc' ? 'desc' : 'asc';
}

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
