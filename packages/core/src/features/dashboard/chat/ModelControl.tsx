'use client';

import type { EffortChoice, ModelPrefs } from '@/libs/llm/modelPrefs';
import { Check, Gauge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EFFORT_CHOICES, isDefaultModelPrefs } from '@/libs/llm/modelPrefs';
import { cn } from '@/utils/Helpers';
import { COMPOSER_CONTROL } from './composerBar';

/**
 * How hard the next answer works — Auto, Quick, Standard or Deep — a compact
 * control in the composer bar beside (+), on every surface. One choice, not a
 * model and a thinking dial (founder, 2026-10-09: "so I can see quick or
 * deep"): the level sets the model, the thinking, whether teammates are asked
 * and how long the turn aims for (`services/agents/effort.ts`). Auto reads the
 * question and picks; the turn's line says which level it ran at. The words
 * are the person's, never a model id.
 * @param props
 * @param props.value
 * @param props.onChange
 */
export function ModelControl({ value, onChange }: { value: ModelPrefs; onChange: (next: ModelPrefs) => void }) {
  const t = useTranslations('Chat');
  const [open, setOpen] = useState(false);
  const raised = value.level !== 'auto' || !isDefaultModelPrefs(value);
  const summary = `${t('effort_label')} · ${t(`effort_${value.level}`)}`;
  // Picking a level supersedes a thread's older strength/thinking setting.
  const pick = (level: EffortChoice) => onChange({ strength: 'balanced', effort: 'off', level });

  const row = (label: string, hint: string, selected: boolean, onPick: () => void) => (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60', selected && 'bg-muted')}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
      {selected && <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />}
    </button>
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverPrimitive.Trigger
            data-testid="model-control"
            aria-label={`${t('model_control')}: ${summary}`}
            // The bar's one control size and hit target (`composerBar.ts`) —
            // the gauge is a sibling of (+) and send, not its own geometry.
            className={cn(
              COMPOSER_CONTROL,
              'hover:bg-surface-hover data-[state=open]:bg-surface-hover data-[state=open]:text-foreground',
              raised ? 'text-brand-amber-deep' : 'text-muted-foreground/70 hover:text-foreground',
            )}
          >
            <Gauge className="size-4" aria-hidden />
          </PopoverPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" collisionPadding={8}>{summary}</TooltipContent>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={e => e.preventDefault()}
          className="z-50 w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-1 text-sm shadow-(--shadow-pop) outline-none"
        >
          <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            <Gauge className="size-3" aria-hidden />
            {t('effort_label')}
          </div>
          <div role="radiogroup" aria-label={t('effort_label')}>
            {EFFORT_CHOICES.map((e: EffortChoice) => row(t(`effort_${e}`), t(`effort_${e}_hint`), e === value.level && (e !== 'auto' || isDefaultModelPrefs(value)), () => pick(e)))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
