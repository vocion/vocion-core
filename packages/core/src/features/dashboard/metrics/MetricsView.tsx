import type { MetricSummary, PeriodMetric } from '@/services/metrics/periodMetrics';
import type { Period, PeriodUnit } from '@/services/metrics/periods';
import { ChartCardView } from '@/libs/cards/firstParty/chart';
import { summarize } from '@/services/metrics/periodMetrics';
import { MetricsFrame } from './MetricsFrame';

const GROUPS = [
  { key: 'outcome', heading: 'What moved in the business' },
  { key: 'work', heading: 'Activity' },
] as const;

/** The words that change with the unit. */
const WORDS: Record<PeriodUnit, { current: string; previous: string; usual: string; plural: string; table: string; tableHead: string; note: string }> = {
  week: { current: 'this week so far', previous: 'Last week', usual: 'Usual week', plural: 'weeks', table: 'Week by week', tableHead: 'Week of', note: 'Weeks run Monday to Sunday. This week is counted through' },
  month: { current: 'this month so far', previous: 'Last month', usual: 'Usual month', plural: 'months', table: 'Month by month', tableHead: 'Month', note: 'Months are calendar months. This month is counted through' },
};

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

function MetricCard({ f, unit }: { f: PeriodMetric; unit: PeriodUnit }) {
  const s: MetricSummary = summarize(f.points);
  const fmt = (v: number | null) => figure(v, f.metric.format);
  const w = WORDS[unit];
  return (
    <section className="min-w-0 border-t border-border/70 pt-4">
      <h3 className="text-sm font-semibold">{f.metric.label}</h3>
      {f.metric.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{f.metric.description}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <div className="font-mono text-3xl font-semibold tabular-nums">{fmt(s.current)}</div>
          <div className="text-[11px] text-muted-foreground">{w.current}</div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <Fact label={w.previous} value={fmt(s.previous)} />
          <Fact label={w.usual} value={fmt(s.usual)} />
          <Fact label={`${f.points.length} ${w.plural}`} value={fmt(s.total)} />
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
                  x: f.points.map(p => (p.period.partial ? `${p.period.label} (to date)` : p.period.label)),
                  series: [{ name: f.metric.label, values: f.points.map(p => p.value) }],
                  unit: f.metric.format === 'money' ? '$' : undefined,
                  trend: true,
                  partialLast: f.points.at(-1)?.period.partial,
                }}
              />
            </div>
          )}
    </section>
  );
}

function PeriodTable({ periods, figures, unit }: { periods: Period[]; figures: PeriodMetric[]; unit: PeriodUnit }) {
  return (
    <div className="mt-10 overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-4 text-xs font-medium text-muted-foreground">{WORDS[unit].tableHead}</th>
            {figures.map(f => <th key={f.metric.key} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{f.metric.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...periods].reverse().map((p) => {
            const i = periods.indexOf(p);
            return (
              <tr key={p.start} className="border-b border-border/50">
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  {p.label}
                  {p.partial && <span className="text-muted-foreground"> (to date)</span>}
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
 * A plugin's Metrics page: what moved in the business and the activity behind
 * it, by week or by month. Outcomes first, then the activity, then every
 * period as numbers.
 * @param props - The page.
 * @param props.slug - The page's slug, for the toggle's links.
 * @param props.unit - Weeks or months.
 * @param props.periods - The periods read, oldest first.
 * @param props.figures - Each declared figure, read for every period.
 * @param props.timezone - The zone the periods are judged in.
 * @param props.now - The clock the current period was cut at.
 */
export function MetricsView({ slug, unit, periods, figures, timezone, now }: { slug: string; unit: PeriodUnit; periods: Period[]; figures: PeriodMetric[]; timezone: string; now: Date }) {
  const stamp = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(d);
  // The oldest sync behind any HubSpot figure: the whole page is only as current as that.
  const synced = figures
    .filter(f => f.provenance === 'verified' && f.unavailable === null)
    .map(f => f.freshness?.asOf)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const note = `${WORDS[unit].note} ${stamp(now)}.${synced ? ` HubSpot figures are from the copy synced ${stamp(synced)}.` : ''}`;
  return (
    <MetricsFrame slug={slug} unit={unit} note={note}>
      {GROUPS.map((g) => {
        const inGroup = figures.filter(f => f.metric.group === g.key);
        return inGroup.length === 0
          ? null
          : (
              <div key={g.key} className="mb-10">
                <h2 className="mb-2 text-base font-semibold">{g.heading}</h2>
                <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
                  {inGroup.map(f => <MetricCard key={f.metric.key} f={f} unit={unit} />)}
                </div>
              </div>
            );
      })}
      <h2 className="text-base font-semibold">{WORDS[unit].table}</h2>
      <PeriodTable periods={periods} figures={figures} unit={unit} />
    </MetricsFrame>
  );
}
