/**
 * chart Card — line / bar / area from `render_chart`, as inline SVG.
 *
 * Follows the dataviz method: one y axis, categorical hues in FIXED order
 * (never cycled — the spec caps series at 8), thin 2px lines, 4px-rounded
 * bar tops anchored to the baseline, a 2px surface gap between adjacent bars,
 * recessive grid, text in text tokens (never the series color), a legend for
 * ≥ 2 series and none for one. Dark mode is a selected step per hue via the
 * `--viz-n` custom properties set on the wrapper, not an automatic flip.
 * Reference palette: dataviz `references/palette.md` (pre-validated, both
 * modes). No chart library.
 */

import type { ChartSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { cn } from '@/utils/Helpers';
import { chartSpecSchema } from '../specs';

export const CHART_SLUG = 'chart';

/** Light / dark categorical steps — slot n → `--viz-n`. */
const VIZ_VARS = [
  '[--viz-1:#2a78d6] dark:[--viz-1:#3987e5]',
  '[--viz-2:#eb6834] dark:[--viz-2:#d95926]',
  '[--viz-3:#1baf7a] dark:[--viz-3:#199e70]',
  '[--viz-4:#eda100] dark:[--viz-4:#c98500]',
  '[--viz-5:#e87ba4] dark:[--viz-5:#d55181]',
  '[--viz-6:#008300] dark:[--viz-6:#008300]',
  '[--viz-7:#4a3aa7] dark:[--viz-7:#9085e9]',
  '[--viz-8:#e34948] dark:[--viz-8:#e66767]',
].join(' ');

const seriesColor = (i: number) => `var(--viz-${i + 1})`;

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) {
    return [0];
  }
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

function fmt(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const n = abs >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : abs >= 1_000 ? `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(v * 100) / 100}`;
  if (!unit) {
    return n;
  }
  return unit === '$' ? `$${n}` : unit === '%' ? `${n}%` : `${n} ${unit}`;
}

export function ChartCardView({ data, surface }: { data: ChartSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const w = 640;
  const h = dense ? 220 : 320;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const n = data.x.length;
  const stacked = Boolean(data.stacked) && data.type !== 'line';

  // y domain: 0 → max (stacked sums when stacked). Negative values clamp at 0 for v1.
  const totals = data.x.map((_, i) => data.series.reduce((acc, s) => acc + Math.max(0, s.values[i] ?? 0), 0));
  const maxRaw = stacked ? Math.max(...totals) : Math.max(...data.series.flatMap(s => s.values.map(v => v ?? 0)));
  const ticks = niceTicks(maxRaw);
  const max = ticks[ticks.length - 1] || 1;
  const y = (v: number) => pad.top + plotH - (Math.max(0, v) / max) * plotH;
  const band = plotW / Math.max(1, n);
  const xCenter = (i: number) => pad.left + band * i + band / 2;
  const xLine = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1));

  // Label thinning: at most ~8 x labels.
  const every = Math.max(1, Math.ceil(n / 8));

  const legend = data.series.length > 1;

  return (
    <figure className={cn('min-w-0', VIZ_VARS)}>
      {data.title && <figcaption className={cn('mb-1 font-medium text-foreground', dense ? 'text-xs' : 'text-sm')}>{data.title}</figcaption>}
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={data.title ?? `${data.type} chart`}>
        {/* grid + y ticks (recessive) */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground" fontSize={10}>{fmt(t, data.unit)}</text>
          </g>
        ))}
        {/* x labels */}
        {data.x.map((label, i) => (i % every === 0
          ? <text key={label + i} x={data.type === 'bar' ? xCenter(i) : xLine(i)} y={h - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>{label}</text>
          : null))}
        {/* marks */}
        {data.type === 'bar' && data.x.map((_, i) => {
          const gap = 2;
          const groupW = Math.max(4, band - 10);
          if (stacked) {
            let acc = 0;
            return data.series.map((s, si) => {
              const v = Math.max(0, s.values[i] ?? 0);
              const y0 = y(acc);
              const y1 = y(acc + v);
              acc += v;
              const isTop = si === data.series.length - 1;
              return v > 0
                ? <rect key={s.name} x={xCenter(i) - groupW / 2} y={y1} width={groupW} height={Math.max(0, y0 - y1 - gap)} rx={isTop ? 4 : 0} fill={seriesColor(si)}><title>{`${data.x[i]} · ${s.name}: ${fmt(v, data.unit)}`}</title></rect>
                : null;
            });
          }
          const bw = Math.max(3, (groupW - gap * (data.series.length - 1)) / data.series.length);
          return data.series.map((s, si) => {
            const v = Math.max(0, s.values[i] ?? 0);
            const x0 = xCenter(i) - groupW / 2 + si * (bw + gap);
            return <rect key={s.name} x={x0} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx={4} fill={seriesColor(si)}><title>{`${data.x[i]} · ${s.name}: ${fmt(v, data.unit)}`}</title></rect>;
          });
        })}
        {data.type !== 'bar' && (() => {
          const acc = Array.from({ length: n }, () => 0);
          return data.series.map((s, si) => {
            const pts = s.values.map((v, i) => {
              const base = stacked ? acc[i]! : 0;
              const top = base + Math.max(0, v ?? 0);
              const p = { x: xLine(i), yTop: y(top), yBase: y(base), missing: v === null };
              if (stacked) {
                acc[i] = top;
              }
              return p;
            });
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.yTop.toFixed(1)}`).join(' ');
            const area = data.type === 'area'
              ? `${d} ${[...pts].reverse().map(p => `L${p.x.toFixed(1)} ${p.yBase.toFixed(1)}`).join(' ')} Z`
              : null;
            return (
              <g key={s.name}>
                {area && <path d={area} fill={seriesColor(si)} fillOpacity={0.18} />}
                <path d={d} fill="none" stroke={seriesColor(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (p.missing
                  ? null
                  : <circle key={i} cx={p.x} cy={p.yTop} r={n > 40 ? 0 : 3} fill={seriesColor(si)} className="stroke-background" strokeWidth={2}><title>{`${data.x[i]} · ${s.name}: ${fmt(s.values[i] ?? 0, data.unit)}`}</title></circle>))}
              </g>
            );
          });
        })()}
        {/* baseline */}
        <line x1={pad.left} x2={w - pad.right} y1={y(0)} y2={y(0)} className="stroke-foreground/30" strokeWidth={1} />
      </svg>
      {legend && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {data.series.map((s, i) => (
            <li key={s.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: seriesColor(i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export const chartCard = defineCard({
  slug: CHART_SLUG,
  name: 'Chart',
  description: 'Renders a line, bar, or area chart (up to eight series on one y axis) as inline SVG. Use for change over time or magnitude across categories — pipeline by month, runs per agent, cost per week. Not for a single headline number (say it in text).',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: chartSpecSchema,
  Renderer: ({ data, surface }) => <ChartCardView data={data} surface={surface} />,
});
