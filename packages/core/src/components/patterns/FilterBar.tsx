'use client';

import type { ReactNode } from 'react';
import type { TokenOption } from '@/components/ui/token-select';
import { SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import { TokenSelect } from '@/components/ui/token-select';
import { cn } from '@/utils/Helpers';

/**
 * FilterBar — **one** field for filtering and searching a list, with the full
 * grid one click behind it.
 *
 * ## Why this exists
 *
 * The review queue had four controls stacked above it: a search box, a row of
 * kind chips, a row of action-type chips that overflowed into "+3 more", and a
 * row of agent chips. Four dimensions, four treatments, and a person had to
 * know which row held the thing they wanted before they could look for it.
 *
 * Chris, 2026-09-16: *"a simplified type ahead combo box instead of many chip
 * filters… Find a way to make the combo box for pills/tags work with the open
 * ended search bar. Simple and smart."*
 *
 * So: you type. The same letters narrow every dimension at once AND search the
 * list's text, because you should not have to decide in advance which one you
 * meant. What you pick rides as a removable token in the same field. The
 * funnel opens the full grid — every dimension, every value, with counts — for
 * when you want to browse rather than search.
 *
 * ## Why the typeahead rather than chips
 *
 * `token-select.tsx` says it plainly, and it was right: *"A chip row is fine
 * for four values and unusable for forty."* The queue passed forty. Jamie built
 * the control for this and it shipped attached to nothing; this is it, wired
 * up. The chips are not deleted — they are the advanced panel, which is the
 * right place for browsing a dimension you cannot name yet.
 *
 * ## The contract
 *
 * `selected` values are opaque strings and the caller decides what they mean.
 * A list spanning several dimensions should namespace them (`type:hubspot.update`,
 * `agent:deal-desk`) and split them back out when writing the URL — the bar
 * neither knows nor cares, which is what lets one component serve every list.
 * @param props
 * @param props.label
 * @param props.placeholder
 * @param props.query
 * @param props.onQueryChange
 * @param props.options
 * @param props.selected
 * @param props.onSelectedChange
 * @param props.searching
 * @param props.advanced
 * @param props.advancedCount
 * @param props.trailing
 * @param props.className
 */
export function FilterBar(props: {
  /** Accessible name for the field. */
  label: string;
  placeholder?: string;
  /** Free text — the open-ended search, live. */
  query: string;
  onQueryChange: (next: string) => void;
  /** Every filter value, across every dimension. Give each a `group`. */
  options: TokenOption[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  /** What the text is searching, for the note in the list. */
  searching?: string;
  /** The full grid — chip rows, facets — revealed by the funnel. */
  advanced?: ReactNode;
  /** Shown on the funnel when filters are on but the panel is shut. */
  advancedCount?: number;
  /** Right of the funnel: sort, direction, a reset. */
  trailing?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = props.advancedCount ?? 0;

  return (
    <div data-pattern="filter-bar" className={cn('flex flex-col gap-2', props.className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <TokenSelect
            label={props.label}
            placeholder={props.placeholder ?? 'Filter or search…'}
            options={props.options}
            selected={props.selected}
            onChange={props.onSelectedChange}
            query={props.query}
            onQueryChange={props.onQueryChange}
            searchNote={props.searching
              ? q => `Searching ${props.searching} for “${q}”`
              : undefined}
          />
        </div>

        {props.advanced && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            data-testid="filter-advanced"
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition',
              'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
              open || count > 0
                ? 'bg-surface-soft font-medium text-foreground ring-1 ring-foreground/20'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            All filters
            {count > 0 && (
              <span className="rounded-full bg-foreground px-1.5 text-[10px] font-semibold text-background tabular-nums">
                {count}
              </span>
            )}
          </button>
        )}

        {props.trailing}
      </div>

      {/* Kept mounted so a person who opens it, filters, and closes it does not
          lose their place in a long dimension list. */}
      {props.advanced && (
        <div id={panelId} hidden={!open} className="rounded-md border border-rule bg-surface-soft/40 p-3">
          {props.advanced}
        </div>
      )}
    </div>
  );
}
