import type { KpiReading } from '@/services/TeamReportService';
import { CheckCircle2 } from 'lucide-react';
import { compact, pct } from './format';

/**
 * One KPI as the manifesto's measurement row: label, then baseline → current
 * → target, then a thin meter on a lighter track of the same hue (the track
 * is a step of the fill's ramp so state reads across the whole bar). A met
 * target gets an icon AND the word — status never rides color alone.
 * @param props
 * @param props.kpi - The reading.
 */
export function KpiMeter({ kpi }: { kpi: KpiReading }) {
  const windowNote = kpi.window && kpi.window !== 'all' ? ` · ${kpi.window}` : '';
  const unit = kpi.unit ? ` ${kpi.unit}` : '';
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-foreground/80">
          {kpi.label}
          <span className="text-muted-foreground">{windowNote}</span>
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{pct(kpi.progress)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-primary/15" role="meter" aria-valuemin={kpi.baseline ?? 0} aria-valuemax={kpi.target} aria-valuenow={kpi.value} aria-label={kpi.label}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(kpi.progress * 100)}%` }} />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
        <span className="text-muted-foreground">
          {kpi.baseline !== undefined ? `baseline ${compact(kpi.baseline)}` : 'from 0'}
        </span>
        <span>
          <span className="font-semibold text-foreground">{compact(kpi.value)}</span>
          <span className="text-muted-foreground">
            {' → '}
            {compact(kpi.target)}
            {unit}
          </span>
        </span>
      </div>
      {kpi.met && (
        <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3" aria-hidden />
          Target met
        </div>
      )}
    </div>
  );
}
