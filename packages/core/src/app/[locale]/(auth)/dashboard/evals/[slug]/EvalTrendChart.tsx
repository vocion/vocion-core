'use client';

import type { EvalTrendPoint } from './evalTrend';
import { useState } from 'react';
import { buildSeries, chartSeries, versionBoundaries } from './evalTrend';

const WIDTH = 880;

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
// Top padding clears the "100%" label's ascenders, which the SVG edge clipped
// at 14. Right padding leaves room for the threshold's label.
const PAD = { top: 24, right: 100, bottom: 22, left: 40 };

/**
 * The validated categorical palette, one entry per colour slot, as literal
 * class names so Tailwind keeps them: a light step and a dark step each, with
 * red left out because it means "errored" on this chart.
 */
const SERIES_SLOT_CLASSES: ReadonlyArray<{ stroke: string; fill: string; swatch: string }> = [
  { stroke: 'stroke-[#2a78d6] dark:stroke-[#3987e5]', fill: 'fill-[#2a78d6] dark:fill-[#3987e5]', swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  { stroke: 'stroke-[#eb6834] dark:stroke-[#d95926]', fill: 'fill-[#eb6834] dark:fill-[#d95926]', swatch: 'bg-[#eb6834] dark:bg-[#d95926]' },
  { stroke: 'stroke-[#1baf7a] dark:stroke-[#199e70]', fill: 'fill-[#1baf7a] dark:fill-[#199e70]', swatch: 'bg-[#1baf7a] dark:bg-[#199e70]' },
  { stroke: 'stroke-[#eda100] dark:stroke-[#c98500]', fill: 'fill-[#eda100] dark:fill-[#c98500]', swatch: 'bg-[#eda100] dark:bg-[#c98500]' },
  { stroke: 'stroke-[#e87ba4] dark:stroke-[#d55181]', fill: 'fill-[#e87ba4] dark:fill-[#d55181]', swatch: 'bg-[#e87ba4] dark:bg-[#d55181]' },
  { stroke: 'stroke-[#008300] dark:stroke-[#008300]', fill: 'fill-[#008300] dark:fill-[#008300]', swatch: 'bg-[#008300] dark:bg-[#008300]' },
  { stroke: 'stroke-[#4a3aa7] dark:stroke-[#9085e9]', fill: 'fill-[#4a3aa7] dark:fill-[#9085e9]', swatch: 'bg-[#4a3aa7] dark:bg-[#9085e9]' },
];

/**
 * The classes for one colour slot.
 * @param slot - The series' `colorSlot`.
 */
function slotClasses(slot: number): { stroke: string; fill: string; swatch: string } {
  return SERIES_SLOT_CLASSES[slot % SERIES_SLOT_CLASSES.length]!;
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
  const height = props.height ?? 200;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const series = chartSeries(buildSeries(props.points, props.providers));
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
        {/* Graders only, so the legend is one short row: markers are
            labelled where they are drawn, and explained once below. */}
        {series.map(line => (
          <span key={line.key} className="inline-flex items-center gap-1.5 text-xs text-foreground">
            <span className={`inline-block h-1 w-4 rounded ${slotClasses(line.colorSlot).swatch} ${line.dashed ? 'opacity-60' : ''}`} />
            {line.label}
          </span>
        ))}
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
              stroke="currentColor"
              strokeOpacity="0.45"
              strokeDasharray="4 4"
            >
              <title>{`Pass threshold: ${Math.round(props.passThreshold * 100)}%. Runs under this line fail the dataset's bar.`}</title>
            </line>
          )}
          {props.passThreshold !== undefined && (
            <text x={WIDTH - PAD.right + 6} y={y(props.passThreshold) + 4} fontSize="12" fill="currentColor" fillOpacity="0.6">
              {`${Math.round(props.passThreshold * 100)}% threshold`}
            </text>
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
                data-testid="eval-trend-line"
                data-series={line.key}
                d={line.points.map((point, index) =>
                  `${index === 0 ? 'M' : 'L'} ${x(Date.parse(point.startedAt))} ${y(point.passRate)}`).join(' ')}
                fill="none"
                className={slotClasses(line.colorSlot).stroke}
                strokeWidth={line.dashed ? 1.5 : 2}
                strokeDasharray={line.dashed ? '4 3' : undefined}
              />
              {line.points.map(point => (
                <circle
                  key={`dot-${point.runId}`}
                  cx={x(Date.parse(point.startedAt))}
                  cy={y(point.passRate)}
                  r={focusedRunId === point.runId ? 5 : 3.5}
                  className={slotClasses(line.colorSlot).fill}
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
                  className={slotClasses(line.colorSlot).fill}
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
      {(boundaries.length > 0 || failures.length > 0) && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {boundaries.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-0 border-l border-dashed border-current" />
              {`Dataset edited (now v${boundaries.at(-1)!.version}): scores either side measure different cases.`}
            </span>
          )}
          {failures.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="font-mono text-red-600 dark:text-red-400">×</span>
              {`Errored run, not scored (${failures.length}).`}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
