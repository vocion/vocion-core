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
 *
 * These helpers live apart from the hook, in a module with no client
 * directive, so a server component can parse a list's URL too. A function
 * exported from a client module is a client reference on the server, and
 * calling one throws: the bulk actions page did exactly that and crashed
 * on every load.
 */

export type SortDirection = 'asc' | 'desc';

export type ListState = {
  tab: string;
  q: string;
  sort: string;
  dir: SortDirection;
  chips: string[];
  /**
   * Extra single-value filters a list declares (`facets` on the config). A
   * ledger filters on three independent dimensions — classification, human
   * disposition, reason — and collapsing them into the chip row would be
   * exactly the "three different kinds of thing in one control" the Discovery
   * Ledger v2 spec is about. Empty string means "all".
   */
  facets: Record<string, string>;
};

export type ListStateConfig = {
  /** The state a clean URL means. `facets` default to '' (all) when omitted. */
  defaults: Omit<ListState, 'facets'> & { facets?: Record<string, string> };
  /** Accepted tab keys; an unknown tab in the URL falls back to the default. */
  tabs?: readonly string[];
  /** Accepted sort keys; an unknown sort falls back to the default. */
  sorts?: readonly string[];
  /** Accepted chip keys; unknown chips are dropped. */
  chips?: readonly string[];
  /**
   * Single-value filters this list owns, as `{ name: accepted values }`. Each
   * lives in the URL under its own name (prefixed like the rest); a value not
   * in the list falls back to the default, so a stale link still opens.
   */
  facets?: Record<string, readonly string[]>;
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

  const facets: Record<string, string> = {};
  for (const [name, accepted] of Object.entries(config.facets ?? {})) {
    const def = config.defaults.facets?.[name] ?? '';
    const raw = params.get(config.prefix ? `${config.prefix}.${name}` : name);
    facets[name] = raw && accepted.includes(raw) ? raw : def;
  }

  return {
    tab: tab && (!config.tabs || config.tabs.includes(tab)) ? tab : defaults.tab,
    q: params.get(key(config, 'q')) ?? defaults.q,
    sort: sort && (!config.sorts || config.sorts.includes(sort)) ? sort : defaults.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : defaults.dir,
    chips: config.chips ? chips.filter(c => config.chips!.includes(c)) : chips,
    facets,
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
export function applyListState(
  search: string,
  state: Omit<ListState, 'facets'> & { facets?: Record<string, string> },
  config: ListStateConfig,
): string {
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

  for (const name of Object.keys(config.facets ?? {})) {
    const param = config.prefix ? `${config.prefix}.${name}` : name;
    const value = state.facets?.[name] ?? '';
    if (value === (config.defaults.facets?.[name] ?? '')) {
      params.delete(param);
    } else {
      params.set(param, value);
    }
  }

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
