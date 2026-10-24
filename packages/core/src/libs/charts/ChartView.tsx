'use client';

/**
 * The chart scene drawn as React — the chat card and the artifact pane.
 *
 * Laid out at the width it is drawn at: the figure measures itself and
 * re-lays out when it resizes, so a phone gets fewer, shorter x labels
 * rather than the desktop chart scaled down to unreadable. Colors are the
 * `--viz-n` custom properties (light and dark steps of the same slot) and
 * the theme's tokens for everything that is not data. See `layout.ts` for
 * the geometry and `svg.ts` for the same scene as a string.
 */

import type { ChartScene, LegendItem, Mark, Paint } from './layout';
import type { ChartSpec } from './spec';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';
import { layoutChart } from './layout';
import { VIZ_LIGHT, VIZ_VARS } from './palette';

const slotColor = (slot: number) => `var(--viz-${(slot % VIZ_LIGHT.length) + 1})`;

const FILL: Record<Exclude<Paint, { slot: number }>, string> = {
  grid: 'fill-border',
  baseline: 'fill-foreground/30',
  text: 'fill-foreground',
  muted: 'fill-muted-foreground',
  target: 'fill-foreground/80',
  marker: 'fill-muted-foreground',
  trend: 'fill-foreground/45',
  surface: 'fill-muted/50',
};
const STROKE: Record<Exclude<Paint, { slot: number }>, string> = {
  grid: 'stroke-border',
  baseline: 'stroke-foreground/30',
  text: 'stroke-foreground',
  muted: 'stroke-muted-foreground',
  target: 'stroke-foreground/70',
  marker: 'stroke-muted-foreground/70',
  trend: 'stroke-foreground/45',
  surface: 'stroke-muted',
};

function fillOf(p: Paint): { className?: string; fill?: string } {
  return typeof p === 'object' ? { fill: slotColor(p.slot) } : { className: FILL[p] };
}
function strokeOf(p: Paint): { className?: string; stroke?: string } {
  return typeof p === 'object' ? { stroke: slotColor(p.slot) } : { className: STROKE[p] };
}

function MarkEl({ m, idp }: { m: Mark; idp: string }) {
  switch (m.kind) {
    case 'rect': {
      const f = fillOf(m.paint);
      return (
        <g>
          <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.rx} className={f.className} fill={f.fill} fillOpacity={m.opacity}>
            {m.title && <title>{m.title}</title>}
          </rect>
          {m.hatch !== undefined && <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.rx} fill={`url(#${idp}-hatch-${m.hatch})`} pointerEvents="none" />}
        </g>
      );
    }
    case 'path': {
      const s = m.stroke ? strokeOf(m.stroke) : {};
      const f = m.fill ? fillOf(m.fill) : {};
      return (
        <path d={m.d} className={cn(s.className, f.className)} stroke={s.stroke} fill={m.fill ? f.fill : 'none'} fillOpacity={m.fill ? m.opacity : undefined} strokeWidth={m.stroke ? (m.width ?? 2) : undefined} strokeDasharray={m.dash} strokeLinejoin="round" strokeLinecap="round">
          {m.title && <title>{m.title}</title>}
        </path>
      );
    }
    case 'line': {
      const s = strokeOf(m.paint);
      return <line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} className={s.className} stroke={s.stroke} strokeWidth={m.width} strokeDasharray={m.dash} />;
    }
    case 'circle':
      return (
        <circle cx={m.cx} cy={m.cy} r={m.r} fill={fillOf(m.paint).fill} className={cn(fillOf(m.paint).className, 'stroke-background')} strokeWidth={2}>
          {m.title && <title>{m.title}</title>}
        </circle>
      );
    case 'text':
      return <text x={m.x} y={m.y} textAnchor={m.anchor} dominantBaseline={m.middle ? 'middle' : undefined} fontSize={m.size} fontWeight={m.weight} className={fillOf(m.paint).className} fill={fillOf(m.paint).fill}>{m.text}</text>;
  }
}

function Swatch({ item }: { item: LegendItem }) {
  const c = item.slot === null ? 'var(--color-muted-foreground, #6b7280)' : slotColor(item.slot);
  if (item.style === 'hatch') {
    return <span aria-hidden className="inline-block size-2.5 rounded-sm opacity-85" style={{ background: `repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 5px)` }} />;
  }
  if (item.style === 'dash') {
    return <span aria-hidden className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: c }} />;
  }
  if (item.style === 'line') {
    return <span aria-hidden className="inline-block h-0.5 w-3.5" style={{ background: c }} />;
  }
  return <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c }} />;
}

/**
 * The scene's data as a table, for screen readers (and what a reader can copy).
 * @param root0
 * @param root0.scene
 */
function DataTable({ scene }: { scene: ChartScene }) {
  return (
    <table className="sr-only">
      <caption>{scene.title ?? 'Chart data'}</caption>
      <thead><tr>{scene.table.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
      <tbody>{scene.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
    </table>
  );
}

/**
 * The width of an element, followed as it resizes.
 * @param initial
 */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) {
        setWidth(prev => (Math.abs(prev - w) >= 2 ? w : prev));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * A chart, laid out at its own width.
 * @param props - The chart.
 * @param props.spec - A spec that passed `chartSpecSchema`.
 * @param props.dense - Chat and feed surfaces: a shorter chart, smaller title.
 * @param props.width - Lay out at this width instead of measuring (stories, tests).
 */
export function ChartView({ spec, dense = false, width: fixed }: { spec: ChartSpec; dense?: boolean; width?: number }) {
  const { ref, width: measured } = useWidth(fixed ?? 640);
  const width = fixed ?? measured;
  const height = dense ? Math.min(240, Math.max(180, width * 0.5)) : undefined;
  const scene = layoutChart(spec, { width, ...(height ? { height } : {}) });
  const idp = useId().replace(/[^\w-]/g, '');
  return (
    <figure ref={ref} className={cn('min-w-0', VIZ_VARS)} data-testid="chart">
      {scene.title && <figcaption className={cn('font-medium text-foreground', dense ? 'text-xs' : 'text-sm')}>{scene.title}</figcaption>}
      {scene.subtitle && <p className="text-[11px] text-muted-foreground">{scene.subtitle}</p>}
      <svg viewBox={`0 0 ${scene.width} ${scene.height}`} className="mt-1 h-auto w-full" role="img" aria-label={scene.title ?? scene.desc}>
        <desc>{scene.desc}</desc>
        {scene.hatchSlots.length > 0 && (
          <defs>
            {scene.hatchSlots.map(s => (
              <pattern key={s} id={`${idp}-hatch-${s}`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={6} stroke={slotColor(s)} strokeWidth={2.2} />
              </pattern>
            ))}
          </defs>
        )}
        {scene.marks.map((m, i) => <MarkEl key={i} m={m} idp={idp} />)}
      </svg>
      {scene.legend.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" data-testid="chart-legend">
          {scene.legend.map(item => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <Swatch item={item} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {scene.caption && <p className="mt-1 text-[10.5px] text-muted-foreground">{scene.caption}</p>}
      <DataTable scene={scene} />
    </figure>
  );
}
