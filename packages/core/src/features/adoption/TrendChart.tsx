'use client';

import { useId, useState } from 'react';

export type TrendSeriesPoint = { day: string } & Record<string, number | string>;

/**
 * Dependency-free SVG trend chart: one filled area series + one line
 * series over daily buckets, with a hover readout. Deliberately small —
 * if charting needs grow past this, swap in a chart library and keep
 * the props.
 */
export function TrendChart(props: {
  data: TrendSeriesPoint[];
  /** Key of the area series (e.g. interactions). */
  areaKey: string;
  areaLabel: string;
  /** Key of the line series (e.g. active users). */
  lineKey: string;
  lineLabel: string;
  height?: number;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const { data, areaKey, lineKey } = props;
  const height = props.height ?? 160;
  const width = 720; // viewBox units; scales to container width
  const pad = { top: 12, right: 8, bottom: 20, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (data.length === 0) {
    return <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No activity yet</div>;
  }

  const areaVals = data.map(d => Number(d[areaKey] ?? 0));
  const lineVals = data.map(d => Number(d[lineKey] ?? 0));
  const maxArea = Math.max(1, ...areaVals);
  const maxLine = Math.max(1, ...lineVals);

  const x = (i: number) => pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yArea = (v: number) => pad.top + innerH - (v / maxArea) * innerH;
  const yLine = (v: number) => pad.top + innerH - (v / maxLine) * innerH;

  const areaPath = `M ${x(0)} ${yArea(areaVals[0]!)} ${areaVals.map((v, i) => `L ${x(i)} ${yArea(v)}`).join(' ')} L ${x(data.length - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z`;
  const linePath = `M ${x(0)} ${yLine(lineVals[0]!)} ${lineVals.map((v, i) => `L ${x(i)} ${yLine(v)}`).join(' ')}`;

  // ~6 x-axis labels regardless of window length.
  const labelEvery = Math.max(1, Math.round(data.length / 6));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - pad.left) / innerW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };

  const hovered = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--brand-teal,theme(colors.teal.500))] opacity-30" />
          {props.areaLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded bg-[var(--brand-pass,theme(colors.emerald.500))]" />
          {props.lineLabel}
        </span>
        {hovered && (
          <span className="ml-auto tabular-nums">
            {hovered.day}
            {' · '}
            {props.areaLabel.toLowerCase()}
            {' '}
            {String(hovered[areaKey] ?? 0)}
            {' · '}
            {props.lineLabel.toLowerCase()}
            {' '}
            {String(hovered[lineKey] ?? 0)}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${props.areaLabel} and ${props.lineLabel} over time`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {/* style, not attributes: SVG presentation attributes can't resolve CSS var() */}
            <stop offset="0%" style={{ stopColor: 'var(--brand-teal, #14b8a6)' }} stopOpacity="0.35" />
            <stop offset="100%" style={{ stopColor: 'var(--brand-teal, #14b8a6)' }} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* horizontal gridlines + y labels (area scale) */}
        {[0, 0.5, 1].map((f) => {
          const yy = pad.top + innerH - f * innerH;
          return (
            <g key={f}>
              <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} stroke="currentColor" strokeOpacity="0.08" />
              <text x={pad.left - 6} y={yy + 3} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.45">
                {Math.round(f * maxArea)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" style={{ stroke: 'var(--brand-pass, #10b981)' }} strokeWidth="1.5" />
        {/* x labels */}
        {data.map((d, i) => (i % labelEvery === 0
          ? (
              <text key={d.day} x={x(i)} y={height - 5} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.45">
                {String(d.day).slice(5)}
              </text>
            )
          : null))}
        {/* hover cursor */}
        {hover != null && (
          <g>
            <line x1={x(hover)} y1={pad.top} x2={x(hover)} y2={pad.top + innerH} stroke="currentColor" strokeOpacity="0.25" />
            <circle cx={x(hover)} cy={yLine(lineVals[hover]!)} r="3" style={{ fill: 'var(--brand-pass, #10b981)' }} />
            <circle cx={x(hover)} cy={yArea(areaVals[hover]!)} r="3" style={{ fill: 'var(--brand-teal, #14b8a6)' }} />
          </g>
        )}
      </svg>
    </div>
  );
}
