'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Typeahead multi-select — a filter that stays usable as its options grow.
 *
 * A chip row is fine for four values and unusable for forty: it wraps into
 * paragraphs and every new registered type makes it worse. This is the same
 * information behind a search: type to narrow, Enter to take the top match,
 * selected values ride as removable tokens.
 *
 * Deliberately dependency-free. Radix has no combobox and cmdk is not in the
 * tree, and a filter is not worth a new package.
 */

export type TokenOption = {
  /** The stable value that travels in the URL or the query. */
  value: string;
  /** What a person reads. */
  label: string;
  /** Shown right-aligned in the list and on the token, when the caller has one. */
  count?: number;
  /**
   * Which DIMENSION this option belongs to — "Type", "Agent", "Kind".
   *
   * One field can then span several independent dimensions instead of one row
   * of chips per dimension: you type "hubspot" and the matching type appears,
   * you type a teammate and the matching agent appears, and neither needs its
   * own control. Options are shown under their group heading, in first-seen
   * order.
   */
  group?: string;
};

/**
 * @param props
 * @param props.options - Everything selectable, in the order to show it.
 * @param props.selected - Currently selected values.
 * @param props.onChange - Called with the next selection.
 * @param props.placeholder - Input placeholder while nothing is selected.
 * @param props.emptyLabel - What "nothing selected" means, e.g. "All types".
 * @param props.label - Accessible name for the control.
 * @param props.query
 * @param props.onQueryChange
 * @param props.searchNote
 */
export function TokenSelect({
  options,
  selected,
  onChange,
  placeholder = 'Type to filter…',
  emptyLabel,
  label,
  query: queryProp,
  onQueryChange,
  searchNote,
}: {
  options: TokenOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  label: string;
  /**
   * The typed text, CONTROLLED — pass it with `onQueryChange` and the same
   * letters that narrow the token list are also the list's free-text search.
   * That is the whole point of merging the two controls: one field, and you
   * do not have to know in advance whether what you are typing is a filter or
   * a search. Omit both and the text stays internal, narrowing only.
   */
  query?: string;
  onQueryChange?: (next: string) => void;
  /** Shown while there is text, to say the text is also searching. */
  searchNote?: (query: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [internalQuery, setInternalQuery] = useState('');
  const query = queryProp ?? internalQuery;
  const setQuery = (next: string) => {
    if (onQueryChange) {
      onQueryChange(next);
    } else {
      setInternalQuery(next);
    }
  };
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const byValue = useMemo(() => new Map(options.map(o => [o.value, o])), [options]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') {
      return options;
    }
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  // Options are shown under their dimension, in the order the dimensions first
  // appear — so a heading never repeats further down the list.
  const grouped = useMemo(() => {
    if (!matches.some(o => o.group)) {
      return matches;
    }
    const order: string[] = [];
    for (const o of matches) {
      const g = o.group ?? '';
      if (!order.includes(g)) {
        order.push(g);
      }
    }
    return order.flatMap(g => matches.filter(o => (o.group ?? '') === g));
  }, [matches]);

  // Clicking outside commits nothing and closes — a filter should never trap.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Clamped at render rather than reset from an effect: a narrowing query can
  // leave the stored index past the end of the list, and resetting it in an
  // effect costs a second render before the first row shows as highlighted.
  const activeIndex = grouped.length === 0 ? 0 : Math.min(active, grouped.length - 1);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
    setQuery('');
    input.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const n = grouped.length;
      setActive(n === 0 ? 0 : (e.key === 'ArrowDown' ? (activeIndex + 1) % n : (activeIndex - 1 + n) % n));
      return;
    }
    if (e.key === 'Enter') {
      const pick = grouped[activeIndex];
      if (open && pick) {
        e.preventDefault();
        toggle(pick.value);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      return;
    }
    // Backspace on an empty query removes the last token, as every tag input does.
    if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  };

  return (
    <div ref={wrap} className="relative w-full max-w-lg">
      <div
        className={`flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 transition ${
          open ? 'border-brand-amber' : 'border-border'
        }`}
      >
        {selected.map((value) => {
          const opt = byValue.get(value);
          return (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full bg-brand-amber-tint py-0.5 pr-1 pl-2 text-xs font-medium text-brand-amber-deep"
            >
              {opt?.label ?? value}
              {opt?.count !== undefined && <span className="font-mono text-[10px] opacity-70">{opt.count}</span>}
              <button
                type="button"
                onClick={() => toggle(value)}
                aria-label={`Remove ${opt?.label ?? value}`}
                className="rounded-full p-0.5 transition hover:bg-brand-amber/20"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          );
        })}

        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          value={query}
          placeholder={selected.length === 0 ? placeholder : ''}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground"
        />

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setQuery('');
            }}
            className="text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(o => !o);
            input.current?.focus();
          }}
          aria-label={open ? 'Close the list' : 'Show the list'}
          className="text-muted-foreground transition hover:text-foreground"
        >
          <ChevronDown className={`size-3.5 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable
          aria-label={label}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-background py-1 shadow-lg"
        >
          {emptyLabel && query.trim() === '' && (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange([]);
                  setQuery('');
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-muted ${
                  selected.length === 0 ? 'font-semibold' : ''
                }`}
              >
                <Check className={`size-3.5 shrink-0 ${selected.length === 0 ? '' : 'invisible'}`} aria-hidden />
                {emptyLabel}
              </button>
            </li>
          )}

          {/* The text is a FILTER and a SEARCH at once, and a person cannot
              be expected to guess that. Say it, in the list, while they type —
              so an empty match list reads as "still searching" rather than
              "nothing here". */}
          {searchNote && query.trim() !== '' && (
            <li className="border-b border-rule px-2.5 py-1.5 text-xs text-muted-foreground">
              {searchNote(query.trim())}
            </li>
          )}

          {grouped.length === 0 && !searchNote && (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">
              Nothing matches “
              {query.trim()}
              ”.
            </li>
          )}

          {grouped.map((opt, i) => {
            const on = selected.includes(opt.value);
            const heading = opt.group && opt.group !== matches[i - 1]?.group ? opt.group : null;
            return (
              <li key={opt.value} role="option" aria-selected={on}>
                {heading && (
                  <span className="mt-1 block px-2.5 pt-1 pb-0.5 text-[10px] font-semibold tracking-widest text-muted-foreground/70 uppercase">
                    {heading}
                  </span>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(opt.value)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
                    i === activeIndex ? 'bg-muted' : ''
                  }`}
                >
                  <Check className={`size-3.5 shrink-0 ${on ? 'text-brand-amber-deep' : 'invisible'}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {/* The slug, because it is what travels in the URL. */}
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{opt.value}</span>
                  {opt.count !== undefined && (
                    <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{opt.count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
