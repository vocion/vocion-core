'use client';

import type { EvalTrendPoint } from './evalTrend';
import { useState } from 'react';
import { buildSeries, versionBoundaries } from './evalTrend';

const WIDTH = 720;

/**
 * A point taking keyboard focus: read it out and ring it.
 * @param point - The run the person has tabbed to.
 * @param setHover - Shows the point's detail line above the chart.
 * @param setFocusedRunId - Draws the ring on that point's dot.
 */
function onPointFocus(
  point: EvalTrendPoint,
  setHover: (point: EvalTrendPoint | null) => void,
  setFocusedRunId: (runId: number | null) => void,
): void {
  setHover(point);
  setFocusedRunId(point.runId);
}

/**
 * Focus leaving a point: clear both the detail line and the ring.
 * @param setHover - Shows the point's detail line above the chart.
 * @param setFocusedRunId - Draws the ring on that point's dot.
 */
function onPointBlur(
  setHover: (point: EvalTrendPoint | null) => void,
  setFocusedRunId: (runId: number | null) => void,
): void {
  setHover(null);
  setFocusedRunId(null);
}
const PAD = { top: 14, right: 10, bottom: 22, left: 34 };

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
 * @param props.failures - Runs that errored before they were scored. Marked
 *   along the bottom edge, never plotted as a zero: nothing was scored, and a
 *   zero would claim the agent failed every case.
 * @param props.passThreshold - The dataset's pass bar, 0–1, drawn as a dashed line.
 */
export function EvalTrendChart(props: {
  points: EvalTrendPoint[];
  providers: Array<{ id: string; label: string }>;
  height?: number;
  failures?: Array<{ runId: number; startedAt: string }>;
  passThreshold?: number;
}) {
  const [hover, setHover] = useState<EvalTrendPoint | null>(null);
  // Separate from hover so a keyboard user gets a ring on the dot they are
  // on, which a mouse user does not need and should not see.
  const [focusedRunId, setFocusedRunId] = useState<number | null>(null);
  const height = props.height ?? 170;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const series = buildSeries(props.points, props.providers);
  if (series.length === 0) {
    return null;
  }

  const failures = props.failures ?? [];
  // Errored runs share the time axis, so a failure after the last scored run
  // still lands on the chart instead of past its right edge.
  const times = [...props.points, ...failures].map(point => Date.parse(point.startedAt));
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
          <span key={line.key} className="inline-flex items-center gap-1.5">
            <span
              className={line.dashed ? 'inline-block h-0.5 w-3 rounded opacity-60' : 'inline-block h-0.5 w-3 rounded'}
              style={{ backgroundColor: line.color }}
            />
            {line.label}
          </span>
        ))}
        {props.passThreshold !== undefined && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0 w-3 border-t border-dashed border-emerald-600 dark:border-emerald-400" />
            {`pass threshold (${Math.round(props.passThreshold * 100)}%)`}
          </span>
        )}
        {failures.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-300">
            <span aria-hidden className="font-mono leading-none">×</span>
            {`errored run${failures.length === 1 ? '' : 's'} (${failures.length}), not scored`}
          </span>
        )}
        {boundaries.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0 border-l border-dashed border-current opacity-60" />
            {`dataset edited (now v${boundaries[boundaries.length - 1]!.version}) — scores either side measure different cases`}
          </span>
        )}
        {hover && (
          <span className="ml-auto tabular-nums">
            {hover.evaluatorSlug
              ? `#${hover.runId} · ${new Date(hover.startedAt).toLocaleString()} · ${hover.evaluatorSlug} ${Math.round(hover.passRate * 100)}%`
              : `#${hover.runId} · ${new Date(hover.startedAt).toLocaleString()} · ${Math.round(hover.passRate * 100)}% pass`}
          </span>
        )}
      </div>
      {/*
        Drawn at its real size rather than scaled to the container. A `w-full`
        SVG shrinks its own text with it, so on a phone the axis labels came out
        around seven pixels — there is no font size that survives that, because
        the scaling is proportional. Fixed width and a scrolling parent keep
        every label at the size it was written, and a narrow screen scrolls the
        chart sideways instead of making it unreadable.
      */}
      <div className="overflow-x-auto">
        <svg
          width={WIDTH}
          height={height}
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="block"
          role="img"
          aria-label="Pass rate over time, one line per grader"
        >
          {[0, 0.5, 1].map((fraction) => {
            const gridY = PAD.top + innerH - fraction * innerH;
            return (
              <g key={fraction}>
                <line x1={PAD.left} y1={gridY} x2={WIDTH - PAD.right} y2={gridY} stroke="currentColor" strokeOpacity="0.08" />
                <text x={PAD.left - 6} y={gridY + 3} textAnchor="end" fontSize="13" fill="currentColor" fillOpacity="0.45">
                  {`${Math.round(fraction * 100)}%`}
                </text>
              </g>
            );
          })}

          {props.passThreshold !== undefined && (
            <line
              x1={PAD.left}
              y1={y(props.passThreshold)}
              x2={WIDTH - PAD.right}
              y2={y(props.passThreshold)}
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeOpacity="0.6"
              strokeDasharray="4 4"
            >
              <title>{`Pass threshold: ${Math.round(props.passThreshold * 100)}%. Runs under this line fail the dataset's bar.`}</title>
            </line>
          )}

          {failures.map(failure => (
            <text
              key={`failed-${failure.runId}`}
              x={x(Date.parse(failure.startedAt))}
              y={PAD.top + innerH + 4}
              textAnchor="middle"
              fontSize="14"
              className="fill-red-600 dark:fill-red-400"
              tabIndex={0}
              aria-label={`Run ${failure.runId} errored before it was scored`}
              data-testid="eval-trend-failure"
            >
              ×
              <title>{`#${failure.runId} · ${new Date(failure.startedAt).toLocaleString()} · errored before it was scored`}</title>
            </text>
          ))}

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
              <text x={x(boundary.at) + 3} y={PAD.top + 8} fontSize="13" fill="currentColor" fillOpacity="0.5">
                {`v${boundary.version}`}
              </text>
            </g>
          ))}

          {series.map(line => (
            <g key={line.key}>
              <path
                d={line.points.map((point, index) =>
                  `${index === 0 ? 'M' : 'L'} ${x(Date.parse(point.startedAt))} ${y(point.passRate)}`).join(' ')}
                fill="none"
                style={{ stroke: line.color }}
                strokeWidth={line.dashed ? 1 : 1.5}
                strokeDasharray={line.dashed ? '4 3' : undefined}
              />
              {line.points.map(point => (
                <circle
                  key={`dot-${point.runId}`}
                  cx={x(Date.parse(point.startedAt))}
                  cy={y(point.passRate)}
                  r={focusedRunId === point.runId ? 5 : 3.5}
                  style={{ fill: line.color }}
                  stroke={focusedRunId === point.runId ? 'currentColor' : 'none'}
                  strokeWidth="1.5"
                />
              ))}
              {line.points.map(point => (
                <circle
                  key={point.runId}
                  cx={x(Date.parse(point.startedAt))}
                  cy={y(point.passRate)}
                  // Big enough to hit with a thumb; the visible dot is smaller.
                  r="7"
                  fillOpacity="0.001"
                  style={{ fill: line.color }}
                  tabIndex={0}
                  aria-label={`${line.label}, run ${point.runId}, ${Math.round(point.passRate * 100)} percent pass`}
                  onMouseEnter={() => setHover(point)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => onPointFocus(point, setHover, setFocusedRunId)}
                  onBlur={() => onPointBlur(setHover, setFocusedRunId)}
                >
                  <title>{`${line.label} · #${point.runId} · ${Math.round(point.passRate * 100)}% pass`}</title>
                </circle>
              ))}
            </g>
          ))}

          <text x={PAD.left} y={height - 6} fontSize="13" fill="currentColor" fillOpacity="0.45">
            {new Date(minTime).toLocaleDateString()}
          </text>
          <text x={WIDTH - PAD.right} y={height - 6} textAnchor="end" fontSize="13" fill="currentColor" fillOpacity="0.45">
            {new Date(maxTime).toLocaleDateString()}
          </text>
        </svg>
      </div>
    </div>
  );
}
