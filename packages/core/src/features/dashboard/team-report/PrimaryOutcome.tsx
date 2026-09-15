import type { MeasureReading } from '@/services/team-report';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { measureValue, pct, windowAdjective } from './format';
import { LineageSheet } from './LineageSheet';
import { ProvenanceChip } from './ProvenanceChip';

/**
 * The primary outcome, big — the visual centre of gravity of a team section
 * (spec §5): "8 / 10 qualified referrals · 80% of weekly target · ↑3 vs
 * prior week", with its provenance chip. Clicking the figure opens the
 * outcome lineage sheet.
 * @param props
 * @param props.teamSlug
 * @param props.reading
 * @param props.now
 */
export function PrimaryOutcome({ teamSlug, reading, now = new Date() }: { teamSlug: string; reading: MeasureReading; now?: Date }) {
  const m = reading.measure;
  const value = reading.value === null ? '—' : measureValue(reading.value, m.unit);
  const target = measureValue(m.target, m.unit);
  const attainment = reading.attainment === null ? null : pct(reading.attainment);
  const Trend = reading.trend === 'up' ? ArrowUpRight : reading.trend === 'down' ? ArrowDownRight : ArrowRight;
  const trendTone = reading.improving === null ? 'text-muted-foreground' : reading.improving ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400';
  const delta = reading.delta === null ? null : `${reading.delta > 0 ? '+' : reading.delta < 0 ? '−' : ''}${measureValue(Math.abs(reading.delta), m.unit)}`;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <LineageSheet teamSlug={teamSlug} measureKey={m.key} label={m.label}>
          <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums sm:text-4xl">
            {value}
            <span className="text-muted-foreground/70"> / </span>
            <span className="text-2xl text-muted-foreground sm:text-3xl">{target}</span>
          </span>
        </LineageSheet>
        <span className="text-base font-medium text-foreground/90">{m.label.toLowerCase()}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums">
        {attainment !== null
          ? (
              <span className={reading.met ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-foreground/80'}>
                {attainment}
                {' of '}
                {windowAdjective(m.window)}
                {' target'}
                {reading.met ? ' · on target' : ''}
              </span>
            )
          : <span className="text-muted-foreground">{reading.unavailableReason ?? 'No reading yet'}</span>}
        {delta !== null && (
          <span className={`inline-flex items-center gap-0.5 ${trendTone}`} title={`vs the prior ${windowAdjective(m.window)} window`}>
            <Trend className="size-3.5" aria-hidden />
            {delta}
            <span className="text-muted-foreground"> vs prior</span>
          </span>
        )}
        <ProvenanceChip reading={reading} now={now} />
      </div>
    </div>
  );
}
