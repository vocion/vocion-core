'use client';

import type { OverviewMeasure } from '@/libs/workspace/productOverview';
import { Stat, StatRow } from '@/components/patterns';
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
    <StatRow data-testid="product-measures" className="border-y-0 py-0">
      {measures.map(m => (
        <Stat
          key={m.key}
          id={m.key}
          label={(
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{m.label}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{m.hint}</TooltipContent>
            </Tooltip>
          )}
          value={m.value}
          note={m.change && <span className={CHANGE[m.change.tone]} data-testid="product-measure-change">{m.change.line}</span>}
        />
      ))}
    </StatRow>
  );
}
