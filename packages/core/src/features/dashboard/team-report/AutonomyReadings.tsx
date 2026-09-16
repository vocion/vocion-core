import type { AutonomyReading } from '@/services/TeamReportService';
import { Link } from '@/libs/I18nNavigation';
import { RUNG_LABEL, RUNG_SHORT, rungAutomates } from '@/services/autonomy/rungs';
import { pct } from './format';

/**
 * The Autonomy column: one quiet line per action kind — rung, kind, and how
 * often the person agreed with the recommendation (n, 30d). No boxes; the
 * rung that automates is the only thing drawn in colour, because that is the
 * one a reader needs to notice. Links to the ladder page.
 * @param props
 * @param props.readings - The contract's autonomy readings, highest rung first.
 * @param props.compact - One line and a "+n" in a table cell; every line in the grid.
 */
export function AutonomyReadings({ readings, compact = false }: { readings: AutonomyReading[]; compact?: boolean }) {
  if (readings.length === 0) {
    return <span className="text-xs text-muted-foreground" title="Nothing of this agent's has been decided in the last 30 days">—</span>;
  }
  const shown = compact ? readings.slice(0, 1) : readings;
  const more = readings.length - shown.length;
  return (
    <span className="flex flex-col gap-0.5 text-xs tabular-nums">
      {shown.map(r => (
        <span key={r.actionId} className="flex items-baseline gap-1.5 whitespace-nowrap" title={`${RUNG_LABEL[r.rung]} · ${r.riskTier} risk · ${r.n} decided recommendation${r.n === 1 ? '' : 's'} in 30d`}>
          <span className={rungAutomates(r.rung) ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-foreground/80'}>{compact ? RUNG_SHORT[r.rung] : RUNG_LABEL[r.rung]}</span>
          <span className="font-mono text-muted-foreground">{r.actionId}</span>
          <span className="text-muted-foreground">
            {r.agreementRate === null ? 'no agreement yet' : `agrees ${pct(r.agreementRate)}`}
            {` · n=${r.n}`}
          </span>
        </span>
      ))}
      {more > 0 && (
        <Link href="/dashboard/autonomy" className="text-muted-foreground hover:text-primary">{`+${more} more kind${more === 1 ? '' : 's'}`}</Link>
      )}
    </span>
  );
}
