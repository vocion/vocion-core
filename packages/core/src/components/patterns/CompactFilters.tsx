'use client';

import type { ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/utils/Helpers';

/**
 * CompactFilters — a list's whole header of controls as ONE row of chips, on a
 * phone.
 *
 * Chris, 2026-10-09, on the Review queue at 390px: *"Header too tall. I can't
 * read enough text on these rows to understand what they are. Global fix."*
 * Scope, lane, sort, search and every filter were each their own row; the
 * header took 60% of the screen before the first record. Here each of them is
 * one chip, so the header is the title, its line and this row:
 *
 * ```
 * [This workspace ▾] [Open 3 ▾] [⚙ 2] [Agent: deal-desk ×] [Kind: Inputs ×]
 * ```
 *
 * - a `menus` chip is a single-value choice — scope, lane — with its current
 *   value as the label and the alternatives one tap away;
 * - the filter button opens a bottom sheet holding search, every filter and
 *   sort (`sheet`), with a badge counting what is on;
 * - every filter that is on rides the same row as a removable chip (`active`),
 *   so what narrows the list is always visible and one tap undoes it.
 *
 * The row scrolls sideways rather than wrapping: a second row is the thing
 * this exists to remove. It renders below `sm` only; the desktop layout it
 * stands in for is the caller's, hidden below `sm` (`ListToolbar` does both).
 * See `docs/design/patterns.md` § The header on a phone.
 */

export type CompactMenu = {
  key: string;
  /** What the choice is about — "Scope", "Status". The menu's heading and part of the chip's name. */
  label: string;
  value: string;
  options: ReadonlyArray<{ key: string; label: string; count?: number }>;
  onChange: (key: string) => void;
};

export type CompactActiveFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

const CHIP = 'inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[13px] transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none';

export function CompactFilters(props: {
  menus?: readonly CompactMenu[];
  active?: readonly CompactActiveFilter[];
  /** The filter button's sheet: search, filters, sort. Omitted, there is no button. */
  sheet?: {
    /** The sheet's heading. Default "Filter and sort". */
    title?: string;
    children: ReactNode;
    /** Shown on the button: how many filters are on. */
    count?: number;
    /** Below the controls: "Clear all", say. */
    footer?: ReactNode;
  };
  /** Anything else at the end of the row — a page's one action, a reset. */
  trailing?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menus = props.menus ?? [];
  const active = props.active ?? [];
  const sheet = props.sheet;
  if (menus.length === 0 && active.length === 0 && !sheet && !props.trailing) {
    return null;
  }
  const count = sheet?.count ?? 0;

  return (
    <div
      data-pattern="compact-filters"
      role="group"
      aria-label="List controls"
      className={cn('-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden', props.className)}
    >
      {menus.map((m) => {
        const current = m.options.find(o => o.key === m.value) ?? m.options[0];
        return (
          <DropdownMenu key={m.key}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-compact-menu={m.key}
                aria-label={`${m.label}: ${current?.label ?? ''}${current?.count !== undefined ? ` ${current.count}` : ''}`}
                className={cn(CHIP, 'bg-surface-soft font-medium text-foreground')}
              >
                {current?.label}
                {current?.count !== undefined && <span className="text-muted-foreground tabular-nums">{current.count}</span>}
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{m.label}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={m.value} onValueChange={m.onChange}>
                {m.options.map(o => (
                  <DropdownMenuRadioItem key={o.key} value={o.key} className="gap-2">
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span>}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {sheet && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={count > 0 ? `Search, filter and sort, ${count} on` : 'Search, filter and sort'}
          data-testid="compact-filters-open"
          className={cn(CHIP, 'px-2.5', count > 0 ? 'bg-foreground text-background' : 'bg-surface-soft text-foreground')}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {count > 0 && <span className="text-[12px] font-semibold tabular-nums">{count}</span>}
        </button>
      )}

      {active.map(f => (
        <button
          key={f.key}
          type="button"
          onClick={f.onRemove}
          aria-label={`Remove filter: ${f.label}`}
          className={cn(CHIP, 'max-w-[14rem] gap-1.5 border border-foreground/25 pr-2 text-foreground')}
        >
          <span className="truncate">{f.label}</span>
          <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}

      {props.trailing}

      {sheet && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
            closeClassName="top-9"
            // No field takes focus on open: on a phone that raises the
            // keyboard and the typeahead's menu over the sheet.
            onOpenAutoFocus={e => e.preventDefault()}
          >
            <SheetGrabber onDismiss={() => setOpen(false)} />
            <div className="px-4 pb-3">
              <SheetTitle className="text-base">{sheet.title ?? 'Filter and sort'}</SheetTitle>
              <SheetDescription className="sr-only">Search this list, choose filters and the order.</SheetDescription>
            </div>
            <div data-testid="compact-filters-sheet" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-2">
              {sheet.children}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-rule px-4 pt-3">
              <div className="min-w-0">{sheet.footer}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 items-center rounded-full bg-[var(--action,var(--foreground))] px-5 text-sm font-medium text-[var(--action-foreground,var(--background))]"
              >
                Done
              </button>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/**
 * One labelled block inside the sheet — "Sort", "Kind" — so the sheet reads as
 * a short form rather than a pile of controls.
 * @param props
 * @param props.label
 * @param props.children
 */
export function CompactSection(props: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-medium text-muted-foreground">{props.label}</h3>
      {props.children}
    </section>
  );
}
