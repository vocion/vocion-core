'use client';

import type { ReactNode } from 'react';
import type { SortDirection } from './listUrlState';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/utils/Helpers';
import { flipDirection, toggleChip } from './listUrlState';

/**
 * ListToolbar — the one row above every list: tabs with counts on the left,
 * find / sort / direction on the right, and, when a list filters by a
 * category rather than a lane, a row of chips (multi-select, ink when on)
 * underneath. Every part is optional and controlled; pair it with
 * `useListUrlState` so the state lives in the URL.
 *
 * Tabs are for lanes (mutually exclusive, the page opens on one); chips are
 * for categories (several at once). A list has one or the other, rarely both.
 * Tabs are buttons with `aria-pressed` rather than ARIA tabs: they filter one
 * list in place, they do not switch panels, and a test can name them
 * "Review 2" by role button.
 */

export type ToolbarTab = { key: string; label: string; count?: number };
export type ToolbarSort = { key: string; label: string };
export type ToolbarChip = { key: string; label: string; count?: number; title?: string };

const CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none';
const CHIP_ON = 'bg-action text-action-foreground';
const CHIP_OFF = 'text-foreground/80 hover:bg-surface-hover';

/**
 * A category chip with its count: "drop · 12". `aria-pressed` carries the
 * state, so the count is in the accessible name and a test can read it.
 * @param props
 * @param props.on
 * @param props.label
 * @param props.count
 * @param props.title
 * @param props.onClick
 */
export function FilterChip(props: { on: boolean; label: string; count?: number; title?: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={props.on} title={props.title} onClick={props.onClick} className={cn(CHIP, props.on ? CHIP_ON : CHIP_OFF)}>
      {props.label}
      {props.count !== undefined && (
        <>
          <span aria-hidden className={props.on ? 'opacity-50' : 'text-muted-foreground/60'}>·</span>
          <span className={cn('tabular-nums', props.on ? 'opacity-70' : 'text-muted-foreground')}>{props.count}</span>
        </>
      )}
    </button>
  );
}

export function ListToolbar(props: {
  tabs?: {
    items: readonly ToolbarTab[];
    value: string;
    onChange: (key: string) => void;
    /** Accessible name for the tab list. */
    label?: string;
  };
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Accessible name; defaults to the placeholder. */
    label?: string;
  };
  sort?: {
    value: string;
    onChange: (key: string) => void;
    options: readonly ToolbarSort[];
    label?: string;
  };
  direction?: {
    value: SortDirection;
    onChange: (dir: SortDirection) => void;
  };
  chips?: {
    items: readonly ToolbarChip[];
    active: readonly string[];
    onChange: (next: string[]) => void;
    /** Leading "All · n" chip that clears the selection. Default on. */
    all?: boolean;
    allLabel?: string;
    label?: string;
  };
  /** Anything else on the right of the row — a reset control, a count. */
  trailing?: ReactNode;
  className?: string;
}) {
  const sortId = useId();
  const { tabs, search, sort, direction, chips } = props;
  const hasRight = search || sort || direction || props.trailing;

  return (
    <div data-pattern="list-toolbar" className={cn('flex flex-col', props.className)}>
      {(tabs || hasRight) && (
        <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-rule', !tabs && 'pb-2')}>
          {tabs && (
            <div role="group" aria-label={tabs.label ?? 'Lanes'} className="flex items-end gap-5 overflow-x-auto">
              {tabs.items.map((t) => {
                const on = tabs.value === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => tabs.onChange(t.key)}
                    className={cn(
                      'flex h-11 shrink-0 items-center gap-1.5 border-b-2 text-sm transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                      on ? 'border-brand-borderline font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                    {t.count !== undefined && <span className="text-xs text-muted-foreground/70 tabular-nums">{t.count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {hasRight && (
            <div className={cn('flex flex-wrap items-center gap-2', tabs && 'pb-2')}>
              {search && (
                <label className="relative block">
                  <span className="sr-only">{search.label ?? search.placeholder ?? 'Find'}</span>
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" aria-hidden />
                  <input
                    type="search"
                    value={search.value}
                    onChange={e => search.onChange(e.target.value)}
                    placeholder={search.placeholder}
                    className="h-8 w-56 rounded-md bg-surface-soft pr-2 pl-8 text-sm transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30"
                  />
                </label>
              )}
              {sort && (
                <>
                  <label htmlFor={sortId} className="text-xs text-muted-foreground">{sort.label ?? 'Sort'}</label>
                  <select
                    id={sortId}
                    value={sort.value}
                    onChange={e => sort.onChange(e.target.value)}
                    className="h-8 rounded-md bg-surface-soft px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  >
                    {sort.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </>
              )}
              {direction && (
                <button
                  type="button"
                  onClick={() => direction.onChange(flipDirection(direction.value))}
                  aria-label={direction.value === 'desc' ? 'Sort ascending' : 'Sort descending'}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
                >
                  {direction.value === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
                </button>
              )}
              {props.trailing}
            </div>
          )}
        </div>
      )}

      {chips && (
        <div role="group" aria-label={chips.label ?? 'Filter'} className="flex flex-wrap items-center gap-1.5 py-3">
          {chips.all !== false && (
            <FilterChip
              on={chips.active.length === 0}
              label={chips.allLabel ?? 'All'}
              count={chips.items.reduce((n, c) => n + (c.count ?? 0), 0)}
              onClick={() => chips.onChange([])}
            />
          )}
          {chips.items.map(c => (
            <FilterChip
              key={c.key}
              on={chips.active.includes(c.key)}
              label={c.label}
              count={c.count}
              title={c.title}
              onClick={() => chips.onChange(toggleChip(chips.active, c.key))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
