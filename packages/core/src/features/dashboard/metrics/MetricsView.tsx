import type { MetricSummary, WeeklyMetric } from '@/services/metrics/weeklyMetrics';
import type { Week } from '@/services/metrics/weeks';
import { ChartCardView } from '@/libs/cards/firstParty/chart';
import { summarize } from '@/services/metrics/weeklyMetrics';

const GROUPS = [
  { key: 'outcome', heading: 'What moved in the business' },
  { key: 'work', heading: 'What the agents did' },
] as const;

function figure(v: number | null, format: 'number' | 'money'): string {
  if (v === null) {
    return '—';
  }
  if (format === 'money') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(v);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function MetricCard({ f }: { f: WeeklyMetric }) {
  const s: MetricSummary = summarize(f.points);
  const fmt = (v: number | null) => figure(v, f.metric.format);
  return (
    <section className="min-w-0 border-t border-border/70 pt-4">
      <h3 className="text-sm font-semibold">{f.metric.label}</h3>
      {f.metric.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{f.metric.description}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <div className="font-mono text-3xl font-semibold tabular-nums">{fmt(s.thisWeek)}</div>
          <div className="text-[11px] text-muted-foreground">this week so far</div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <Fact label="Last week" value={fmt(s.lastWeek)} />
          <Fact label="Usual week" value={fmt(s.usual)} />
          <Fact label={`${f.points.length} weeks`} value={fmt(s.total)} />
        </dl>
      </div>
      {f.unavailable
        ? <p className="mt-3 text-[13px] text-muted-foreground">{f.unavailable.reason}</p>
        : (
            <div className="mt-3">
              <ChartCardView
                surface="page"
                data={{
                  type: 'bar',
                  x: f.points.map(p => (p.week.partial ? `${p.week.label} (to date)` : p.week.label)),
                  series: [{ name: f.metric.label, values: f.points.map(p => p.value) }],
                  unit: f.metric.format === 'money' ? '$' : undefined,
                  trend: true,
                  partialLast: f.points.at(-1)?.week.partial,
                }}
              />
            </div>
          )}
    </section>
  );
}

function WeekTable({ weeks, figures }: { weeks: Week[]; figures: WeeklyMetric[] }) {
  return (
    <div className="mt-10 overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-4 text-xs font-medium text-muted-foreground">Week of</th>
            {figures.map(f => <th key={f.metric.key} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{f.metric.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...weeks].reverse().map((w) => {
            const i = weeks.indexOf(w);
            return (
              <tr key={w.start} className="border-b border-border/50">
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  {w.label}
                  {w.partial && <span className="text-muted-foreground"> (to date)</span>}
                </td>
                {figures.map(f => <td key={f.metric.key} className="px-3 py-1.5 text-right font-mono tabular-nums">{figure(f.points[i]?.value ?? null, f.metric.format)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A plugin's Metrics page: what its agents moved, week by week. Outcomes
 * first, then the work that produced them, then every week as numbers.
 * @param props
 * @param props.weeks - The weeks read, oldest first.
 * @param props.figures - Each declared figure, read for every week.
 * @param props.timezone - The zone the weeks are judged in.
 * @param props.now - The clock the current week was cut at.
 */
export function MetricsView({ weeks, figures, timezone, now }: { weeks: Week[]; figures: WeeklyMetric[]; timezone: string; now: Date }) {
  const stamp = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(d);
  // The oldest sync behind any HubSpot figure: the whole page is only as current as that.
  const synced = figures
    .filter(f => f.provenance === 'verified' && f.unavailable === null)
    .map(f => f.freshness?.asOf)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return (
    <div>
      <p className="mb-6 text-[13px] text-muted-foreground">
        {`Weeks run Monday to Sunday. This week is counted through ${stamp(now)}.`}
        {synced && ` HubSpot figures are from the copy synced ${stamp(synced)}.`}
      </p>
      {GROUPS.map((g) => {
        const inGroup = figures.filter(f => f.metric.group === g.key);
        return inGroup.length === 0
          ? null
          : (
              <div key={g.key} className="mb-10">
                <h2 className="mb-2 text-base font-semibold">{g.heading}</h2>
                <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
                  {inGroup.map(f => <MetricCard key={f.metric.key} f={f} />)}
                </div>
              </div>
            );
      })}
      <h2 className="text-base font-semibold">Week by week</h2>
      <WeekTable weeks={weeks} figures={figures} />
    </div>
  );
}
