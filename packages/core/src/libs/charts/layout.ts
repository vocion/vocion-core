/**
 * Chart layout: a spec at a width becomes a scene — plain shapes with
 * coordinates, paints by role and palette slot, the legend, the data table.
 * Pure, so the same geometry draws as React (the chat card, the artifact
 * pane) and as an SVG string (a document's chart block, a deck slide):
 * one engine, two serializers (`ChartView.tsx`, `svg.ts`).
 *
 * Layout is done AT the width it will be drawn at, not scaled after: a phone
 * gets fewer, shorter x labels ("J F M" or every third month), never smaller
 * text or labels on top of each other. On a category axis, where every bar
 * needs its label, a label that cannot fit even shortened is reported
 * (`collision`) for the lint to refuse.
 */

import type { ValueFormat } from './format';
import type { ChartSeries, ChartSpec, StackMode } from './spec';
import { formatValue, niceDomain, valueFormatOf } from './format';
import { axisKindOf, monthOf } from './periods';
import { forecastIndexOf, isForecastAt, stackModeOf } from './spec';

/** What a shape is painted with: a palette slot (a series), or a role the theme colors. */
export type Paint = { slot: number } | 'grid' | 'baseline' | 'text' | 'muted' | 'target' | 'marker' | 'trend' | 'surface';

export type Mark
  = | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number; paint: Paint; opacity?: number; hatch?: number; title?: string }
    | { kind: 'path'; d: string; stroke?: Paint; fill?: Paint; opacity?: number; width?: number; dash?: string; title?: string }
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; paint: Paint; width: number; dash?: string }
    | { kind: 'circle'; cx: number; cy: number; r: number; paint: Paint; title?: string }
    | { kind: 'text'; x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end'; size: number; paint: Paint; weight?: number; middle?: boolean };

export type LegendItem = { label: string; slot: number | null; style: 'solid' | 'hatch' | 'dash' | 'line' };

export type ChartScene = {
  width: number;
  height: number;
  marks: Mark[];
  legend: LegendItem[];
  /** Palette slots whose hatch pattern the drawing must define. */
  hatchSlots: number[];
  title: string | null;
  subtitle: string | null;
  /** One line for screen readers: what the chart shows. */
  desc: string;
  /** The data, as a table: the accessible fallback and what a reader can copy. */
  table: { head: string[]; rows: string[][] };
  caption: string | null;
  /** x labels that could not be drawn without overlapping, even shortened (category axes only). */
  collision: string[];
  /** The narrowest bar drawn, px. */
  minBarWidth: number;
};

export type LayoutOptions = {
  /** The width the chart is drawn at, px. */
  width: number;
  /** Height; by default proportional to the width, between 200 and 360. */
  height?: number;
  /** Text size, px (11 on screen; a deck passes ~22). */
  fontSize?: number;
};

/** Average glyph width as a share of the font size, for a sans UI face. */
const GLYPH = 0.58;

export function textWidth(text: string, size: number): number {
  return text.length * size * GLYPH;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The forms a label can shrink to, longest first: as written, then for a
 * month its three letters, then its initial.
 * @param label - One x label.
 */
function labelForms(label: string): string[] {
  const forms = [label];
  const m = monthOf(label);
  if (m !== null) {
    forms.push(MONTH_SHORT[m]!, MONTH_SHORT[m]![0]!);
  }
  return [...new Set(forms)];
}

/**
 * Which x labels to draw, and as what, so none overlaps. A period axis may
 * skip labels (every 2nd, 3rd…) and shorten months; a category axis keeps
 * every label and truncates, reporting the ones that still do not fit.
 * @param labels - The x labels.
 * @param slot - The space one label has, px.
 * @param size - Font size.
 * @param periods - Whether the axis is a sequence of periods.
 */
export function placeXLabels(labels: readonly string[], slot: number, size: number, periods: boolean): { drawn: Array<{ i: number; text: string }>; collision: string[] } {
  const gap = size * 0.8;
  if (periods) {
    // Shortest form that lets every label show, else the step that fits the full-ish form.
    const formSets = labels.map(labelForms);
    const depth = Math.max(...formSets.map(f => f.length));
    for (let d = 0; d < depth; d++) {
      const texts = formSets.map(f => f[Math.min(d, f.length - 1)]!);
      const widest = Math.max(...texts.map(t => textWidth(t, size)));
      if (widest + gap <= slot) {
        return { drawn: texts.map((text, i) => ({ i, text })), collision: [] };
      }
    }
    const texts = formSets.map(f => f[Math.min(1, f.length - 1)]!);
    const widest = Math.max(...texts.map(t => textWidth(t, size)));
    const step = Math.max(1, Math.ceil((widest + gap) / Math.max(1, slot)));
    // Anchor on the last label, so the latest period is always named.
    const last = labels.length - 1;
    return { drawn: texts.flatMap((text, i) => ((last - i) % step === 0 ? [{ i, text }] : [])), collision: [] };
  }
  const room = slot - gap;
  const collision: string[] = [];
  const drawn = labels.map((label, i) => {
    if (textWidth(label, size) <= room) {
      return { i, text: label };
    }
    const keep = Math.floor(room / (size * GLYPH)) - 1;
    if (keep < 4) {
      collision.push(label);
      return { i, text: label.slice(0, Math.max(1, keep)) };
    }
    return { i, text: `${label.slice(0, keep).trimEnd()}…` };
  });
  return { drawn, collision };
}

/**
 * The least-squares line through the values that are present, as its value
 * at every x. Null with fewer than two points to fit.
 * @param values - One per x; nulls are skipped.
 */
export function trendLine(values: Array<number | null>): number[] | null {
  const pts = values.flatMap((v, i) => (v === null ? [] : [[i, v] as const]));
  if (pts.length < 2) {
    return null;
  }
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, v]) => a + v, 0) / pts.length;
  const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  const slope = pts.reduce((a, [x, v]) => a + (x - mx) * (v - my), 0) / sxx;
  return values.map((_, i) => my + slope * (i - mx));
}

function n0(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Each series' values as drawn: percent stacks become shares of their column.
 * @param spec
 * @param mode
 */
function drawnValues(spec: ChartSpec, mode: StackMode): number[][] {
  if (mode !== 'percent') {
    return spec.series.map(s => s.values.map(n0));
  }
  const totals = spec.x.map((_, i) => spec.series.reduce((a, s) => a + Math.max(0, n0(s.values[i])), 0));
  return spec.series.map(s => s.values.map((v, i) => (totals[i]! > 0 ? (Math.max(0, n0(v)) / totals[i]!) * 100 : 0)));
}

/**
 * Waterfall segments: each x as a bar from `from` to `to`.
 * @param spec
 */
function waterfallSegments(spec: ChartSpec): Array<{ from: number; to: number; total: boolean }> {
  const totals = new Set(spec.waterfallTotals ?? []);
  const values = spec.series[0]!.values;
  let running = 0;
  return spec.x.map((label, i) => {
    const v = n0(values[i]);
    if (totals.has(label) || (i === 0 && !totals.size)) {
      running = v;
      return { from: 0, to: v, total: true };
    }
    const from = running;
    running += v;
    return { from, to: running, total: false };
  });
}

function titleOf(spec: ChartSpec, s: ChartSeries, i: number, value: number | null, f: ValueFormat): string {
  return `${spec.x[i]} · ${s.name}: ${value === null ? '—' : formatValue(value, f, false)}${isForecastAt(spec, s, i) ? ' (forecast)' : ''}`;
}

/**
 * Lay a chart out at a width.
 * @param spec - A spec that passed `chartSpecSchema`.
 * @param opts - The width (and optionally height and text size) to lay out at.
 */
export function layoutChart(spec: ChartSpec, opts: LayoutOptions): ChartScene {
  const size = opts.fontSize ?? 11;
  const width = Math.max(160, Math.round(opts.width));
  const height = Math.round(opts.height ?? Math.min(360, Math.max(200, width * 0.55)));
  const mode = stackModeOf(spec);
  const fmt: ValueFormat = mode === 'percent' ? { kind: 'percent' } : valueFormatOf(spec);
  const compact = spec.compact ?? true;
  const values = drawnValues(spec, mode);
  const n = spec.x.length;
  const isBarLike = spec.type === 'bar' || spec.type === 'waterfall';
  const forecastAt = forecastIndexOf(spec);
  const axis = axisKindOf(spec.x);

  // ---- y domain
  let lo = 0;
  let hi = 0;
  const segments = spec.type === 'waterfall' ? waterfallSegments(spec) : null;
  if (segments) {
    for (const s of segments) {
      lo = Math.min(lo, s.from, s.to);
      hi = Math.max(hi, s.from, s.to);
    }
  } else if (mode === 'none') {
    for (const row of values) {
      for (const v of row) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      hi = Math.max(hi, values.reduce((a, row) => a + Math.max(0, row[i]!), 0));
    }
  }
  for (const t of spec.targets ?? []) {
    hi = Math.max(hi, t.value);
    lo = Math.min(lo, t.value);
  }
  if (mode === 'percent') {
    hi = 100;
  }
  const ticks = niceDomain(lo, hi);
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]! || 1;

  // ---- frame
  const tickLabels = ticks.map(t => formatValue(t, fmt, compact));
  const left = Math.ceil(Math.max(...tickLabels.map(t => textWidth(t, size)))) + size;
  const markerRoom = spec.marker ? size * 1.6 : 0;
  const pad = { top: Math.round(size * 1.1 + markerRoom), right: Math.round(size * 0.9), bottom: Math.round(size * 2.4), left };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(60, height - pad.top - pad.bottom);
  const y = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const band = plotW / Math.max(1, n);
  const xCenter = (i: number) => pad.left + band * i + band / 2;
  const xPoint = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1));
  const at = isBarLike ? xCenter : xPoint;

  const marks: Mark[] = [];
  const hatch = new Set<number>();

  // grid + y ticks
  ticks.forEach((t, k) => {
    marks.push({ kind: 'line', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), paint: 'grid', width: 1 });
    marks.push({ kind: 'text', x: pad.left - size * 0.5, y: y(t), text: tickLabels[k]!, anchor: 'end', size: size * 0.92, paint: 'muted', middle: true });
  });

  // x labels
  const slot = isBarLike ? band : n > 1 ? plotW / (n - 1) : plotW;
  const placed = placeXLabels(spec.x, slot, size, axis.kind === 'periods');
  for (const { i, text } of placed.drawn) {
    marks.push({ kind: 'text', x: at(i), y: height - size * 0.9, text, anchor: 'middle', size, paint: 'muted' });
  }

  // forecast region: a quiet band behind the forecast columns
  if (forecastAt !== null) {
    const x0 = isBarLike ? pad.left + band * forecastAt : (xPoint(Math.max(0, forecastAt - 1)) + xPoint(forecastAt)) / 2;
    marks.push({ kind: 'rect', x: x0, y: pad.top, w: width - pad.right - x0, h: plotH, rx: 0, paint: 'surface', opacity: 1 });
  }

  let minBarWidth = Number.POSITIVE_INFINITY;
  const gap = Math.max(1, size * 0.18);

  if (segments) {
    const bw = Math.max(2, band * 0.62);
    minBarWidth = bw;
    segments.forEach((s, i) => {
      const top = y(Math.max(s.from, s.to));
      const bottom = y(Math.min(s.from, s.to));
      const up = s.to >= s.from;
      const slotN = s.total ? 0 : up ? 2 : 7;
      const v = s.total ? s.to : s.to - s.from;
      marks.push({ kind: 'rect', x: xCenter(i) - bw / 2, y: top, w: bw, h: Math.max(1, bottom - top), rx: 3, paint: { slot: slotN }, title: `${spec.x[i]}: ${formatValue(v, fmt, false)}` });
      if (i < n - 1) {
        // the connector: where this step ends, the next starts
        marks.push({ kind: 'line', x1: xCenter(i) + bw / 2, x2: xCenter(i + 1) - bw / 2, y1: y(s.to), y2: y(s.to), paint: 'muted', width: 1, dash: '2 2' });
      }
      const label = s.total ? formatValue(s.to, fmt, compact) : `${v >= 0 ? '+' : ''}${formatValue(v, fmt, compact)}`;
      if (textWidth(label, size * 0.92) <= band - gap) {
        marks.push({ kind: 'text', x: xCenter(i), y: top - size * 0.45, text: label, anchor: 'middle', size: size * 0.92, paint: 'text', weight: 600 });
      }
    });
  } else if (spec.type === 'bar') {
    const groupW = Math.max(2, band * (mode === 'none' && spec.series.length > 1 ? 0.8 : 0.62));
    if (mode === 'none') {
      const k = spec.series.length;
      const bw = Math.max(1, (groupW - gap * (k - 1)) / k);
      minBarWidth = bw;
      spec.series.forEach((s, si) => {
        values[si]!.forEach((v, i) => {
          if (s.values[i] === null) {
            return;
          }
          const fc = isForecastAt(spec, s, i);
          if (fc) {
            hatch.add(si);
          }
          const top = y(Math.max(0, v));
          const bottom = y(Math.min(0, v));
          marks.push({ kind: 'rect', x: xCenter(i) - groupW / 2 + si * (bw + gap), y: top, w: bw, h: Math.max(0, bottom - top), rx: Math.min(4, bw / 3), paint: { slot: si }, opacity: spec.partialLast && i === n - 1 ? 0.45 : fc ? 0.4 : 1, ...(fc ? { hatch: si } : {}), title: titleOf(spec, s, i, s.values[i]!, fmt) });
        });
      });
    } else {
      minBarWidth = groupW;
      for (let i = 0; i < n; i++) {
        let acc = 0;
        const visible = spec.series.map((_, si) => si).filter(si => values[si]![i]! > 0);
        for (const si of visible) {
          const s = spec.series[si]!;
          const v = values[si]![i]!;
          const y0 = y(acc);
          const y1 = y(acc + v);
          acc += v;
          const fc = isForecastAt(spec, s, i);
          if (fc) {
            hatch.add(si);
          }
          const isTop = si === visible[visible.length - 1];
          marks.push({ kind: 'rect', x: xCenter(i) - groupW / 2, y: y1, w: groupW, h: Math.max(0, y0 - y1 - (isTop ? 0 : gap)), rx: isTop ? Math.min(4, groupW / 3) : 0, paint: { slot: si }, opacity: spec.partialLast && i === n - 1 ? 0.45 : fc ? 0.4 : 1, ...(fc ? { hatch: si } : {}), title: titleOf(spec, s, i, mode === 'percent' ? v : s.values[i] ?? null, fmt) });
        }
        // The column's total over its stack, when it fits.
        if (mode === 'stack' && acc > 0 && n <= 16) {
          const label = formatValue(acc, fmt, compact);
          if (textWidth(label, size * 0.88) <= band - gap) {
            marks.push({ kind: 'text', x: xCenter(i), y: y(acc) - size * 0.45, text: label, anchor: 'middle', size: size * 0.88, paint: 'text', weight: 600 });
          }
        }
      }
    }
  } else {
    // line / area
    const acc = Array.from({ length: n }, () => 0);
    spec.series.forEach((s, si) => {
      const pts = values[si]!.map((v, i) => {
        const base = mode === 'none' ? 0 : acc[i]!;
        const top = base + (mode === 'none' ? v : Math.max(0, v));
        if (mode !== 'none') {
          acc[i] = top;
        }
        return { x: xPoint(i), yTop: y(top), yBase: y(base), missing: s.values[i] === null };
      });
      const firstFc = s.forecast ? 0 : forecastAt;
      const solidEnd = firstFc === null ? n - 1 : Math.max(0, firstFc - 1);
      const pathOf = (from: number, to: number) => pts.slice(from, to + 1).filter(p => !p.missing).map((p, k) => `${k === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.yTop.toFixed(1)}`).join(' ');
      if (spec.type === 'area') {
        const live = pts.filter(p => !p.missing);
        if (live.length > 1) {
          const d = `${live.map((p, k) => `${k === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.yTop.toFixed(1)}`).join(' ')} ${[...live].reverse().map(p => `L${p.x.toFixed(1)} ${p.yBase.toFixed(1)}`).join(' ')} Z`;
          marks.push({ kind: 'path', d, fill: { slot: si }, opacity: s.forecast ? 0.1 : 0.18 });
        }
      }
      if (firstFc === null || firstFc > 0) {
        marks.push({ kind: 'path', d: pathOf(0, solidEnd), stroke: { slot: si }, width: 2 });
      }
      if (firstFc !== null) {
        // The forecast continues from the last actual, dashed.
        marks.push({ kind: 'path', d: pathOf(Math.max(0, firstFc - 1), n - 1), stroke: { slot: si }, width: 2, dash: '5 4' });
      }
      if (n <= 40) {
        pts.forEach((p, i) => {
          if (!p.missing) {
            marks.push({ kind: 'circle', cx: p.x, cy: p.yTop, r: 3, paint: { slot: si }, title: titleOf(spec, s, i, s.values[i]!, fmt) });
          }
        });
      }
    });
  }

  // trend: a quiet dashed line through the first series' actuals
  if (spec.trend && spec.type !== 'waterfall') {
    const upto = forecastAt ?? (spec.partialLast ? n - 1 : n);
    const fitted = trendLine(spec.series[0]!.values.slice(0, upto));
    if (fitted) {
      const last = fitted.length - 1;
      marks.push({ kind: 'line', x1: at(0), y1: y(fitted[0]!), x2: at(last), y2: y(fitted[last]!), paint: 'trend', width: 1.5, dash: '4 4' });
    }
  }

  // targets
  for (const t of spec.targets ?? []) {
    marks.push({ kind: 'line', x1: pad.left, x2: width - pad.right, y1: y(t.value), y2: y(t.value), paint: 'target', width: 1.5, dash: '6 3' });
    marks.push({ kind: 'text', x: width - pad.right, y: y(t.value) - size * 0.45, text: `${t.label} ${formatValue(t.value, fmt, compact)}`, anchor: 'end', size: size * 0.88, paint: 'target', weight: 600 });
  }

  // marker ("Today")
  if (spec.marker) {
    const i = spec.x.indexOf(spec.marker.x);
    if (i >= 0) {
      const mx = at(i);
      marks.push({ kind: 'line', x1: mx, x2: mx, y1: pad.top - markerRoom * 0.4, y2: pad.top + plotH, paint: 'marker', width: 1, dash: '3 3' });
      const anchor = mx > width - textWidth(spec.marker.label, size) ? 'end' : mx < pad.left + textWidth(spec.marker.label, size) ? 'start' : 'middle';
      marks.push({ kind: 'text', x: mx, y: pad.top - markerRoom * 0.55, text: spec.marker.label, anchor, size: size * 0.9, paint: 'marker', weight: 600 });
    }
  }

  // baseline at zero
  marks.push({ kind: 'line', x1: pad.left, x2: width - pad.right, y1: y(Math.max(yMin, 0)), y2: y(Math.max(yMin, 0)), paint: 'baseline', width: 1 });

  // ---- legend, table, words
  const legend: LegendItem[] = [];
  if (spec.type !== 'waterfall' && spec.series.length > 1) {
    spec.series.forEach((s, si) => legend.push({ label: s.forecast ? `${s.name} (forecast)` : s.name, slot: si, style: s.forecast ? (isBarLike ? 'hatch' : 'dash') : isBarLike ? 'solid' : 'line' }));
  } else if (spec.series.length === 1 && spec.series[0]!.forecast) {
    legend.push({ label: `${spec.series[0]!.name} (forecast)`, slot: 0, style: isBarLike ? 'hatch' : 'dash' });
  }
  if (forecastAt !== null) {
    legend.push({ label: `Forecast from ${spec.x[forecastAt]}`, slot: null, style: isBarLike ? 'hatch' : 'dash' });
  }
  if (spec.type === 'waterfall') {
    legend.push({ label: 'Increase', slot: 2, style: 'solid' }, { label: 'Decrease', slot: 7, style: 'solid' }, { label: 'Total', slot: 0, style: 'solid' });
  }

  const head = ['', ...spec.series.map(s => s.name), ...(mode === 'stack' ? ['Total'] : [])];
  const rows = spec.x.map((label, i) => {
    const cells = spec.series.map(s => (s.values[i] === null ? '—' : formatValue(s.values[i]!, valueFormatOf(spec), false)));
    const total = spec.series.reduce((a, s) => a + n0(s.values[i]), 0);
    return [`${label}${forecastAt !== null && i >= forecastAt ? ' (forecast)' : ''}`, ...cells, ...(mode === 'stack' ? [formatValue(total, valueFormatOf(spec), false)] : [])];
  });

  const kindWord = spec.type === 'waterfall' ? 'Waterfall' : mode === 'percent' ? '100% stacked bar' : mode === 'stack' ? `Stacked ${spec.type}` : spec.type === 'bar' && spec.series.length > 1 ? 'Grouped bar' : spec.type[0]!.toUpperCase() + spec.type.slice(1);
  const desc = `${kindWord} chart of ${spec.series.map(s => s.name).join(', ')} across ${n} ${axis.kind === 'periods' ? 'periods' : 'categories'}, ${spec.x[0]} to ${spec.x[n - 1]}${forecastAt !== null ? `, forecast from ${spec.x[forecastAt]}` : ''}.`;
  const caption = [spec.source, spec.asOf ? `as of ${spec.asOf}` : null].filter(Boolean).join(' · ') || null;

  return {
    width,
    height,
    marks,
    legend,
    hatchSlots: [...hatch].sort((a, b) => a - b),
    title: spec.title ?? null,
    subtitle: spec.subtitle ?? null,
    desc,
    table: { head, rows },
    caption,
    collision: placed.collision,
    minBarWidth: Number.isFinite(minBarWidth) ? minBarWidth : 0,
  };
}

export type { ChartSpec };
