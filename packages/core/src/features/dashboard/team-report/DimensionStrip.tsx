import type { MeasureReading } from '@/services/team-report';
import type { TeamReportTeam } from '@/services/TeamReportService';
import { windowPhrase } from '@/services/team-report';
import { durationMs, measureValue, pct, usd } from './format';
import { ProvenanceChip } from './ProvenanceChip';

/**
 * The four-dimension strip under the primary outcome (spec §1, §6):
 * Quality · Velocity · Economics · Human load. Each cell shows the team's
 * DECLARED measure of that dimension when it authored one (with provenance),
 * else the figure Vocion derives — quality rate from decisions, median
 * turnaround from finished work, cost per outcome from spend, decision
 * latency from the queue. A cell never shows a zero it cannot stand behind.
 * @param props
 * @param props.team
 * @param props.now
 */
export function DimensionStrip({ team, now = new Date() }: { team: TeamReportTeam; now?: Date }) {
  const hl = team.humanLoad;
  const primaryUnit = team.primary?.measure.unit;
  const perUnit = team.primary ? (primaryUnit && primaryUnit !== '$' && primaryUnit !== '%' ? primaryUnit.replace(/s$/, '') : team.primary.measure.label.toLowerCase().replace(/s$/, '')) : 'outcome';
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 lg:grid-cols-4">
      <Cell
        label="Quality"
        declared={team.quality.measure}
        now={now}
        value={team.quality.rate === null ? null : pct(team.quality.rate)}
        note={team.quality.rate === null ? 'Nothing decided yet' : `accepted without edit · ${team.quality.decided} decided`}
      />
      <Cell
        label="Velocity"
        declared={team.velocity.measure}
        now={now}
        value={team.velocity.medianMs === null ? null : durationMs(team.velocity.medianMs)}
        note={team.velocity.medianMs === null ? 'No finished work in the window' : 'median turnaround'}
      />
      <Cell
        label="Economics"
        declared={team.economics.measure}
        now={now}
        value={team.economics.costPerOutcomeCents === null ? usd(team.economics.cents) : `${usd(team.economics.costPerOutcomeCents)}/${perUnit}`}
        note={team.economics.costPerOutcomeCents === null
          ? (team.primary ? (team.primary.value && team.primary.value > 0 ? 'operating cost · no spend recorded against this outcome' : 'operating cost · no outcome to divide by yet') : 'operating cost')
          : `${usd(team.economics.primaryWindowCents ?? team.economics.cents)} operating cost ${windowPhrase(team.primary!.measure.window)}${team.economics.budget.variance !== null ? ` · ${team.economics.budget.variance > 0 ? '+' : ''}${Math.round(team.economics.budget.variance * 100)}% vs budget` : ''}`}
      />
      <Cell
        label="Human load"
        declared={null}
        now={now}
        value={hl.interventions === 0 ? '0' : durationMs(hl.decisionLatencyMs)}
        note={hl.interventions === 0
          ? (hl.workItems === 0 ? 'No work in the window' : 'no interventions')
          : `decision latency · ${hl.interventions} intervention${hl.interventions === 1 ? '' : 's'}${hl.interventionRate !== null ? ` · ${pct(hl.interventionRate)} needed a person` : ''}`}
      />
    </dl>
  );
}

function Cell({ label, declared, value, note, now }: { label: string; declared: MeasureReading | null; value: string | null; note: string; now: Date }) {
  if (declared) {
    const m = declared.measure;
    return (
      <div className="min-w-0">
        <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
        <dd className="mt-0.5 text-lg leading-tight font-semibold tabular-nums">
          {declared.value === null ? '—' : measureValue(declared.value, m.unit)}
          <span className="text-sm font-normal text-muted-foreground">
            {' · target '}
            {m.direction === 'lower' ? '≤' : '≥'}
            {measureValue(m.target, m.unit)}
          </span>
        </dd>
        <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className={declared.met ? 'text-emerald-700 dark:text-emerald-400' : ''}>
            {m.label}
            {declared.met ? ' · on target' : ''}
          </span>
          <ProvenanceChip reading={declared} now={now} />
        </dd>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={`mt-0.5 text-lg leading-tight font-semibold tabular-nums ${value === null ? 'text-muted-foreground' : ''}`}>{value ?? '—'}</dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}
