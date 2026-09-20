'use client';

import type { ModelPrefs, ModelStrength, ThinkingEffort } from '@/libs/llm/modelPrefs';
import { Brain, Check, Gauge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isDefaultModelPrefs, MODEL_STRENGTHS, THINKING_EFFORTS } from '@/libs/llm/modelPrefs';
import { cn } from '@/utils/Helpers';
import { COMPOSER_CONTROL } from './composerBar';

/**
 * Model strength and thinking effort for THIS conversation — a compact control
 * in the composer bar beside (+), on every surface (Chris, 2026-09-18: "why
 * don't I have tools when chatting to control reasoning level or model
 * strength?"). Persisted per thread like autonomy; the words are the person's
 * (fast / balanced / deep, off / low / medium / high), never a model id — the
 * turn's footer says which model actually answered.
 * @param props
 * @param props.value
 * @param props.onChange
 */
export function ModelControl({ value, onChange }: { value: ModelPrefs; onChange: (next: ModelPrefs) => void }) {
  const t = useTranslations('Chat');
  const [open, setOpen] = useState(false);
  const raised = !isDefaultModelPrefs(value);
  const summary = `${t(`model_${value.strength}`)} · ${t(`thinking_${value.effort}`)}`;

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
            {t('model_strength')}
          </div>
          <div role="radiogroup" aria-label={t('model_strength')}>
            {MODEL_STRENGTHS.map((s: ModelStrength) => row(t(`model_${s}`), t(`model_${s}_hint`), s === value.strength, () => onChange({ ...value, strength: s })))}
          </div>
          <div className="mt-1 flex items-center gap-1.5 border-t border-border/60 px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            <Brain className="size-3" aria-hidden />
            {t('thinking_effort')}
          </div>
          <div role="radiogroup" aria-label={t('thinking_effort')}>
            {THINKING_EFFORTS.map((e: ThinkingEffort) => row(t(`thinking_${e}`), t(`thinking_${e}_hint`), e === value.effort, () => onChange({ ...value, effort: e })))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
