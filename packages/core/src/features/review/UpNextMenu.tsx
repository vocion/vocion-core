'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export type UpNextEntry = { id: number; title: string; typeLabel: string };

/**
 * "Next: New MQL ready to enroll › · 212 more" — one line instead of a rail.
 * The popover lists the next ten with their type and lets the person skip to
 * any of them; the queue itself is worked one item at a time (`j` / `k`).
 *
 * Chris, 2026-09-15: "I probably don't need to persistently see all 'up next'."
 * @param props
 * @param props.next
 * @param props.remaining
 * @param props.onSkipTo
 * @param props.onLoadMore
 */
export function UpNextMenu(props: {
  next: readonly UpNextEntry[];
  /** Items in the queue beyond the current one (the real number, not the loaded window). */
  remaining: number;
  onSkipTo: (id: number) => void;
  onLoadMore?: () => void;
}) {
  const t = useTranslations('Review');
  const { next, remaining, onSkipTo, onLoadMore } = props;
  const first = next[0];
  if (!first) {
    return null;
  }
  const more = Math.max(remaining - 1, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="up-next"
          className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground transition hover:bg-[var(--surface-hover,var(--muted))] hover:text-foreground"
        >
          <span className="shrink-0">{t('next_label')}</span>
          <span className="min-w-0 truncate text-foreground">{first.title}</span>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          {more > 0 && <span className="shrink-0 tabular-nums">{`· ${t('more', { count: more })}`}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-1.5">
        <DropdownMenuLabel className="text-[11px] font-medium tracking-normal text-muted-foreground normal-case">{t('up_next')}</DropdownMenuLabel>
        {next.slice(0, 10).map((e, i) => (
          <DropdownMenuItem key={e.id} onSelect={() => onSkipTo(e.id)} className="items-start gap-3 rounded-md px-2 py-2">
            <span className="w-4 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{e.title}</span>
              <span className="mt-1 inline-block rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{e.typeLabel}</span>
            </span>
            <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
              {t('skip_to')}
              {' ›'}
            </span>
          </DropdownMenuItem>
        ))}
        {remaining > next.length && onLoadMore && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLoadMore} className="justify-center text-[12px] text-muted-foreground">
              {t('load_more')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
