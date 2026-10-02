'use client';

import type { OverviewMeasure } from '@/libs/workspace/productOverview';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const CHANGE: Record<'ok' | 'bad' | 'muted', string> = { ok: 'text-brand-pass', bad: 'text-brand-fail', muted: 'text-muted-foreground' };

/**
 * A product's figures in one compact row: what was counted, the number, and
 * which way it moved against the period before — coloured by whether that way
 * is good. What each one counts is its label's tooltip.
 * @param props - Props.
 * @param props.measures - From `productOverview.measuresOf`.
 */
export function ProductMeasures({ measures }: { measures: readonly OverviewMeasure[] }) {
  if (measures.length === 0) {
    return null;
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" data-testid="product-measures">
      {measures.map(m => (
        <div key={m.key} className="min-w-0" data-measure={m.key}>
          <dt className="text-[12px] text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{m.label}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{m.hint}</TooltipContent>
            </Tooltip>
          </dt>
          <dd className="text-[20px] leading-tight font-semibold tabular-nums">{m.value}</dd>
          {m.change && <dd className={`text-[12px] ${CHANGE[m.change.tone]}`} data-testid="product-measure-change">{m.change.line}</dd>}
        </div>
      ))}
    </dl>
  );
}
