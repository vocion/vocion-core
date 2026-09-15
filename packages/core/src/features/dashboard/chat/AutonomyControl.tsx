'use client';

import type { AutonomyCopy } from './autonomyOptions';
import type { ConversationAutonomy } from './types';
import { Check, ShieldCheck, Zap } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/Helpers';
import { autonomyHint, autonomyLabel, autonomyOptions, isRaisedAutonomy } from './autonomyOptions';

/**
 * The conversation's autonomy rung, as one quiet header chip.
 *
 * It was two segmented buttons inside the composer until 2026-09-15 (Chris:
 * "clean up this UI, buttons, hierarchy, sizing"). A rung is a setting for
 * the whole conversation, not an action on the next message, so it belongs
 * beside the conversation's name — and the composer is left with one primary
 * action (Manifesto §4 *simple beats flexible*, §11 *make the important
 * things obvious*).
 *
 * The chip states the current rung at a glance and opens a collision-aware
 * popover with both options, each carrying the one line that says what
 * choosing it means. `compact` drops the label to the icon alone — what a
 * 320px rail has room for — and the tooltip still names the rung, so the
 * mode is never more than a hover away.
 */

export type AutonomyControlProps = {
  value: ConversationAutonomy;
  onChange: (next: ConversationAutonomy) => void;
  /** Copy from the caller, which owns the i18n provider. */
  copy: AutonomyCopy;
  /** Icon only — a narrow rail. The tooltip still carries the label. */
  compact?: boolean;
  /** Accessible name for the trigger (e.g. "Autonomy"). */
  label: string;
};

export function AutonomyControl({ value, onChange, copy, compact = false, label }: AutonomyControlProps) {
  const [open, setOpen] = useState(false);
  const raised = isRaisedAutonomy(value);
  const Icon = raised ? Zap : ShieldCheck;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverPrimitive.Trigger
            data-testid="autonomy-chip"
            aria-label={`${label}: ${autonomyLabel(value, copy)}`}
            className={cn(
              // 32px tall, the same hit target as the header's icon buttons;
              // a hairline only when the rung is raised, so the default rung
              // adds no box to the header.
              'flex h-8 max-w-[10.5rem] shrink-0 items-center gap-1.5 rounded-full text-[12px] font-medium transition-colors',
              'hover:bg-surface-hover data-[state=open]:bg-surface-hover',
              compact ? 'w-8 justify-center' : 'px-2.5',
              raised ? 'text-brand-amber-deep' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {!compact && <span className="truncate">{autonomyLabel(value, copy)}</span>}
          </PopoverPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>
          {autonomyHint(value, copy)}
        </TooltipContent>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="bottom"
          sideOffset={6}
          // The rail hugs the viewport's right edge and the sheet its left,
          // so both ends need the collision margin Radix only applies when
          // it is told how much room to keep.
          collisionPadding={8}
          className="z-50 w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-1 shadow-(--shadow-pop) outline-none"
        >
          <div role="radiogroup" aria-label={label}>
            {autonomyOptions(copy).map((o) => {
              const selected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <Check className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-foreground' : 'text-transparent')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-foreground">{o.label}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
