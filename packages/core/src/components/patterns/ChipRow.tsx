'use client';

import { ChevronDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/Helpers';
import { arrangeChips, fitChips } from './chipFit';

export type Chip = {
  key: string;
  label: string;
  count?: number;
  active: boolean;
  onToggle: () => void;
  /** Always first and always shown — the "All" chip. */
  pinned?: boolean;
  title?: string;
};

const GAP = 6;

/**
 * One line of filter chips, never two. As many chips as fit are shown; the
 * rest fold into a "+N more" menu where each is still a checkbox that
 * toggles the same filter. The row measures itself — a hidden clone of every
 * chip plus the control gives the real widths, `fitChips` decides how many
 * fit, and a ResizeObserver re-decides on every width change — so nothing
 * hard-codes a count. Pinned chips ("All") come first, active chips next,
 * so a chip you have turned on is never the one that hides.
 *
 * Chris, 2026-09-15: "can you fit the chips into one line? with… some UX to
 * view more?"
 * @param props
 * @param props.chips - In display order; `arrangeChips` reorders for the rule above.
 * @param props.size - `md` for the kind chips, `sm` for the action-kind / agent chips.
 * @param props.label - The row's accessible name and the menu's heading.
 * @param props.className
 */
export function ChipRow({ chips, size = 'md', label, className }: { chips: Chip[]; size?: 'md' | 'sm'; label: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number>(chips.length);
  const ordered = arrangeChips(chips);
  const signature = ordered.map(c => `${c.key}:${c.active ? 1 : 0}:${c.count ?? ''}`).join('|');

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) {
      return;
    }
    const compute = () => {
      const nodes = Array.from(measure.children) as HTMLElement[];
      const more = nodes.pop();
      const widths = nodes.map(n => n.offsetWidth);
      setVisible(fitChips(widths, container.clientWidth, more?.offsetWidth ?? 0, GAP));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [signature]);

  const shown = ordered.slice(0, visible);
  const hidden = ordered.slice(visible);
  const hiddenActive = hidden.filter(c => c.active).length;

  const chipClass = (active: boolean) => size === 'md'
    ? cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        active ? 'bg-[var(--action,var(--foreground))] text-[var(--action-foreground,var(--background))]' : 'text-foreground/80 hover:bg-[var(--surface-hover,var(--muted))]',
      )
    : cn(
        'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        active ? 'border-foreground/70 bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
      );

  const renderChip = (c: Chip, interactive: boolean) => (
    <button
      key={c.key}
      type="button"
      aria-pressed={interactive ? c.active : undefined}
      tabIndex={interactive ? undefined : -1}
      onClick={interactive ? c.onToggle : undefined}
      title={c.title}
      className={chipClass(c.active)}
    >
      {c.label}
      {c.count !== undefined && (
        <>
          <span aria-hidden className={size === 'md' ? 'opacity-50' : 'hidden'}>·</span>
          <span className={cn('tabular-nums', size === 'md' ? 'opacity-70' : 'opacity-70')}>{c.count}</span>
        </>
      )}
    </button>
  );

  const moreLabel = (n: number) => `+${n} more`;
  const moreClass = cn(chipClass(false), hiddenActive > 0 && 'font-medium text-foreground');

  return (
    <div ref={containerRef} role="group" aria-label={label} className={cn('relative flex min-w-0 items-center overflow-hidden', className)} style={{ gap: GAP }}>
      {/* The measuring clone: every chip plus the control, laid out once, invisible, never interactive. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex items-center whitespace-nowrap" style={{ gap: GAP }}>
        {ordered.map(c => renderChip(c, false))}
        <span className={moreClass}>
          {moreLabel(Math.max(hidden.length, 10))}
          <ChevronDown className="size-3.5" aria-hidden />
        </span>
      </div>

      {shown.map(c => renderChip(c, true))}

      {hidden.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={moreClass} data-testid="chips-more" aria-label={`${moreLabel(hidden.length)}${hiddenActive > 0 ? `, ${hiddenActive} selected` : ''}`}>
              {moreLabel(hidden.length)}
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto p-1.5">
            <DropdownMenuLabel className="text-[11px] font-medium tracking-normal text-muted-foreground normal-case">{label}</DropdownMenuLabel>
            {hidden.map(c => (
              <DropdownMenuCheckboxItem key={c.key} checked={c.active} onCheckedChange={() => c.onToggle()} onSelect={e => e.preventDefault()} className="gap-2 rounded-md">
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
