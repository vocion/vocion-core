'use client';

import type { ComponentPropsWithRef } from 'react';
import type { ReviewType } from './reviewQueueModel';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/Helpers';
import { toggleType } from './reviewQueueModel';

/**
 * The queue filter as one row of chips: "All · 213" then each card type with
 * its count, the active ones filled in ink. Multi-select — several types work
 * as one queue. The raw action id lives in the chip's tooltip, nowhere else.
 *
 * Chris, 2026-09-15: "the content in the dropdown is great, the dropdown bar
 * as a UX isn't." Same state, same URL param, no dropdown.
 */

// `--action` / `--surface-hover` are the airy-shell tokens (PR #330); the
// fallbacks keep the chips right on main alone.
const CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none';
const CHIP_ON = 'bg-[var(--action,var(--foreground))] text-[var(--action-foreground,var(--background))]';
const CHIP_OFF = 'text-foreground/80 hover:bg-[var(--surface-hover,var(--muted))]';

type ChipProps = ComponentPropsWithRef<'button'> & { on: boolean; label: string; count: number };

// Spreads the rest so a Radix `asChild` trigger can attach its handlers.
function Chip({ on, label, count, className, ...rest }: ChipProps) {
  return (
    <button type="button" aria-pressed={on} {...rest} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF, className)}>
      {label}
      <span aria-hidden className={on ? 'opacity-50' : 'text-muted-foreground/60'}>·</span>
      <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-muted-foreground')}>{count}</span>
    </button>
  );
}

export function TypeChips(props: {
  types: readonly ReviewType[];
  active: readonly string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const t = useTranslations('Review');
  const { types, active, onChange } = props;
  const total = types.reduce((sum, ty) => sum + ty.count, 0);
  return (
    <TooltipProvider delayDuration={300}>
      <div role="group" aria-label="Filter by card type" data-testid="review-type-filter" className={cn('flex flex-wrap items-center gap-1.5', props.className)}>
        <Chip on={active.length === 0} label={t('all')} count={total} onClick={() => onChange([])} />
        {types.map(ty => (
          <Tooltip key={ty.actionId}>
            <TooltipTrigger asChild>
              <Chip on={active.includes(ty.actionId)} label={ty.label} count={ty.count} onClick={() => onChange(toggleType(active, ty.actionId))} />
            </TooltipTrigger>
            <TooltipContent side="bottom"><code className="font-mono text-[11px]">{ty.actionId}</code></TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
