'use client';

import { useState } from 'react';

/** One finished run, as the trend line needs it. */
export type EvalTrendPoint = {
  runId: number;
  provider: string;
  /** ISO timestamp — the x position. */
  startedAt: string;
  /** 0–1. Runs without a pass rate are not plotted. */
  passRate: number;
  datasetVersion: number | null;
};

export type Series = {
  provider: string;
  label: string;
  color: string;
  points: EvalTrendPoint[];
};

/**
 * Colours are assigned by position in the provider list, not by id, so a
 * third provider is a new entry here and nothing else.
 */
const SERIES_COLORS = ['var(--brand-pass, #10b981)', 'var(--brand-teal, #14b8a6)', 'var(--brand-accent, #f59e0b)', '#8b5cf6'];

const WIDTH = 720;
const PAD = { top: 14, right: 10, bottom: 22, left: 34 };

/**
 * Group the points into one line per provider, in the order the providers
 * were given so colours stay put between renders.
 * @param points - Every plottable run.
 * @param providers - Who grades this dataset, in display order.
 */
export function buildSeries(points: EvalTrendPoint[], providers: Array<{ id: string; label: string }>): Series[] {
  const series: Series[] = [];
  for (const provider of providers) {
    const mine = points
      .filter(point => point.provider === provider.id)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    if (mine.length === 0) {
      continue;
    }
    series.push({
      provider: provider.id,
      label: provider.label,
      color: SERIES_COLORS[series.length % SERIES_COLORS.length]!,
      points: mine,
    });
  }
  return series;
}

/**
 * Where the dataset changed underneath the numbers.
 *
 * A pass rate before an edit to the cases and one after it are measurements of
 * two different tests. Drawing the boundary is what stops the line being read
 * as the agent improving when the questions simply got easier.
 * @param points - Every plottable run, any provider.
 */
export function versionBoundaries(points: EvalTrendPoint[]): Array<{ at: number; version: number }> {
  const ordered = [...points].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const boundaries: Array<{ at: number; version: number }> = [];
  let previous: number | null = null;
  for (const point of ordered) {
    const version = point.datasetVersion;
    if (version === null) {
      continue;
    }
    if (previous !== null && version !== previous) {
      boundaries.push({ at: Date.parse(point.startedAt), version });
    }
    previous = version;
  }
  return boundaries;
}

/**
 * Pass rate over time, one line per grader.
 *
 * Dependency-free SVG, in the same spirit as `features/adoption/TrendChart` —
 * if charting here grows past this, swap in a library and keep the props.
 *
 * The x axis is real time rather than run order, so a gap between runs looks
 * like a gap. Two providers scoring the same execution land on the same x,
 * which is the point: their disagreement is visible as vertical distance.
 * @param props - Props.
 * @param props.points - Finished runs that have a pass rate.
 * @param props.providers - Who grades this dataset, in display order.
 * @param props.height - Chart height in viewBox units.
 */
export function EvalTrendChart(props: {
  points: EvalTrendPoint[];
  providers: Array<{ id: string; label: string }>;
  height?: number;
}) {
  const [hover, setHover] = useState<EvalTrendPoint | null>(null);
  const height = props.height ?? 170;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const series = buildSeries(props.points, props.providers);
  if (series.length === 0) {
    return null;
  }

  const times = props.points.map(point => Date.parse(point.startedAt));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const span = maxTime - minTime;

  // A single run, or several inside one second, would divide by zero; park
  // them in the middle rather than at the left edge.
  const x = (at: number) => (span === 0 ? PAD.left + innerW / 2 : PAD.left + ((at - minTime) / span) * innerW);
  const y = (passRate: number) => PAD.top + innerH - passRate * innerH;

  const boundaries = versionBoundaries(props.points);

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        {series.map(line => (
          <span key={line.provider} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: line.color }} />
            {line.label}
          </span>
        ))}
        {boundaries.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0 border-l border-dashed border-current opacity-60" />
            dataset edited
          </span>
        )}
        {hover && (
          <span className="ml-auto tabular-nums">
            {`#${hover.runId} · ${new Date(hover.startedAt).toLocaleString()} · ${Math.round(hover.passRate * 100)}% pass`}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-label="Pass rate over time, one line per grader"
      >
        {[0, 0.5, 1].map((fraction) => {
          const gridY = PAD.top + innerH - fraction * innerH;
          return (
            <g key={fraction}>
              <line x1={PAD.left} y1={gridY} x2={WIDTH - PAD.right} y2={gridY} stroke="currentColor" strokeOpacity="0.08" />
              <text x={PAD.left - 6} y={gridY + 3} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.45">
                {`${Math.round(fraction * 100)}%`}
              </text>
            </g>
          );
        })}

        {boundaries.map(boundary => (
          <g key={`v${boundary.version}-${boundary.at}`}>
            <line
              x1={x(boundary.at)}
              y1={PAD.top}
              x2={x(boundary.at)}
              y2={PAD.top + innerH}
              stroke="currentColor"
              strokeOpacity="0.35"
              strokeDasharray="2 3"
            >
              <title>{`Dataset changed to v${boundary.version} — scores before and after are measuring different cases`}</title>
            </line>
            <text x={x(boundary.at) + 3} y={PAD.top + 8} fontSize="9" fill="currentColor" fillOpacity="0.5">
              {`v${boundary.version}`}
            </text>
          </g>
        ))}

        {series.map(line => (
          <g key={line.provider}>
            <path
              d={line.points.map((point, index) =>
                `${index === 0 ? 'M' : 'L'} ${x(Date.parse(point.startedAt))} ${y(point.passRate)}`).join(' ')}
              fill="none"
              style={{ stroke: line.color }}
              strokeWidth="1.5"
            />
            {line.points.map(point => (
              <circle
                key={point.runId}
                cx={x(Date.parse(point.startedAt))}
                cy={y(point.passRate)}
                r="3.5"
                style={{ fill: line.color }}
                onMouseEnter={() => setHover(point)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${line.label} · #${point.runId} · ${Math.round(point.passRate * 100)}% pass`}</title>
              </circle>
            ))}
          </g>
        ))}

        <text x={PAD.left} y={height - 6} fontSize="9" fill="currentColor" fillOpacity="0.45">
          {new Date(minTime).toLocaleDateString()}
        </text>
        <text x={WIDTH - PAD.right} y={height - 6} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.45">
          {new Date(maxTime).toLocaleDateString()}
        </text>
      </svg>
    </div>
  );
}
