/**
 * Chart layout: a spec at a width becomes a scene — plain shapes with
 * coordinates, paints by role and palette slot, the legend, the data table.
 * Pure, so the same geometry draws as React (the chat card, the artifact
 * pane) and as an SVG string (a document's chart block, a deck slide):
 * one engine, two serializers (`ChartView.tsx`, `svg.ts`).
 *
 * Layout is done AT the width it will be drawn at, and it is where good
 * charts come from (Chris, 2026-10-24: "good charting should be driven by
 * model choice, prompting, and libraries. Not over checking"). The decisions
 * a careful analyst makes by hand are made here, from the data and the width:
 *
 * - A bar chart whose category names cannot be read under their bars turns
 *   horizontal: names down the side, in full, wrapped to two lines.
 * - Category labels wrap before they are shortened; a period axis shows
 *   fewer, shorter months ("Jan", then every second) rather than smaller text.
 * - A waterfall whose last steps would draw as hairlines at the scale of its
 *   first ones (a P&L from $5M revenue to $46K net income) is drawn as the
 *   summary bridge plus a rescaled detail of those steps, so both read.
 * - Values sit on their bars when they fit; a line with a few series is
 *   labelled at its end instead of in a legend; a legend only names what the
 *   marks cannot (series colors, forecast).
 * - More series than the palette can tell apart keep the largest and fold
 *   the rest into "Other".
 *
 * What it decided is reported in `facts`, which the chart review hands the
 * model (`review.ts`): the model judges the drawing, the code does the drawing.
 */

import type { ValueFormat } from './format';
import type { ChartSeries, ChartSpec, StackMode } from './spec';
import { formatValue, niceDomain, valueFormatOf } from './format';
import { axisKindOf, monthOf } from './periods';
import { forecastIndexOf, isForecastAt, MAX_SERIES, stackModeOf } from './spec';

/** What a shape is painted with: a palette slot (a series), or a role the theme colors. */
export type Paint = { slot: number } | 'grid' | 'baseline' | 'text' | 'muted' | 'target' | 'marker' | 'trend' | 'surface';

export type Mark
  = | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number; paint: Paint; opacity?: number; hatch?: number; title?: string }
    | { kind: 'path'; d: string; stroke?: Paint; fill?: Paint; opacity?: number; width?: number; dash?: string; title?: string }
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; paint: Paint; width: number; dash?: string }
    | { kind: 'circle'; cx: number; cy: number; r: number; paint: Paint; title?: string }
    | { kind: 'text'; x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end'; size: number; paint: Paint; weight?: number; middle?: boolean };

export type LegendItem = { label: string; slot: number | null; style: 'solid' | 'hatch' | 'dash' | 'line' };

export type Orientation = 'vertical' | 'horizontal';

/** What the layout decided, for the review (`review.ts`) and the tests. */
export type LayoutFacts = {
  orientation: Orientation;
  /** Turned horizontal by the layout because the category names did not fit under vertical bars. */
  autoHorizontal: boolean;
  /** Series folded into "Other" (past the palette's eight slots). */
  folded: string[];
  /** Category labels drawn on two lines. */
  wrapped: string[];
  /** Labels cut short with an ellipsis to fit. */
  shortened: string[];
  /** Period labels left out to fit (every second, third…). */
  skipped: number;
  /** The narrowest bar drawn, px (0 when there are no bars). */
  minBar: number;
  /** Values drawn as slivers under the legibility minimum with no value label beside them. */
  illegible: Array<{ label: string; value: string; px: number }>;
  /** A waterfall drawn as its summary plus a rescaled detail of its last steps. */
  split: { from: string; to: string; steps: number } | null;
  /** Bars carry their own value labels. */
  directLabels: boolean;
};

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
  facts: LayoutFacts;
};

export type LayoutOptions = {
  /** The width the chart is drawn at, px. */
  width: number;
  /** Height; by default proportional to the width (vertical) or to the rows (horizontal). */
  height?: number;
  /** Text size, px (11 on screen; a deck passes ~22). */
  fontSize?: number;
};

/** Average glyph width as a share of the font size, for a sans UI face. */
const GLYPH = 0.58;
/** A bar narrower than this reads as a line, px. */
const MIN_BAR_PX = 6;
/** A value drawn shorter than this, with no label beside it, cannot be read, px. */
const SLIVER_PX = 3;
/** A waterfall step this short at the summary's scale belongs in the detail, px. */
const TINY_STEP_PX = 6;

export function textWidth(text: string, size: number): number {
  return text.length * size * GLYPH;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The forms a period label can shrink to, longest first: as written, then for
 * a month its three letters, then its initial.
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
 * Which period labels to draw, and as what, so none overlaps: the shortest
 * month form that lets every label show, else every second (third…) label,
 * anchored on the last so the latest period is always named.
 * @param labels - The x labels (periods).
 * @param slot - The space one label has, px.
 * @param size - Font size.
 */
export function placeXLabels(labels: readonly string[], slot: number, size: number): { drawn: Array<{ i: number; text: string }> } {
  const gap = size * 0.8;
  const formSets = labels.map(labelForms);
  const depth = Math.max(...formSets.map(f => f.length));
  for (let d = 0; d < depth; d++) {
    const texts = formSets.map(f => f[Math.min(d, f.length - 1)]!);
    const widest = Math.max(...texts.map(t => textWidth(t, size)));
    if (widest + gap <= slot) {
      return { drawn: texts.map((text, i) => ({ i, text })) };
    }
  }
  const texts = formSets.map(f => f[Math.min(1, f.length - 1)]!);
  const widest = Math.max(...texts.map(t => textWidth(t, size)));
  const step = Math.max(1, Math.ceil((widest + gap) / Math.max(1, slot)));
  const last = labels.length - 1;
  return { drawn: texts.flatMap((text, i) => ((last - i) % step === 0 ? [{ i, text }] : [])) };
}

/**
 * A label broken into at most `lines` lines of at most `max` px, on word
 * boundaries; null when it cannot be (a word longer than the line, or more
 * lines than allowed).
 * @param label - The text.
 * @param max - The widest a line may be, px.
 * @param size - Font size.
 * @param lines - The most lines.
 */
export function wrapLabel(label: string, max: number, size: number, lines = 2): string[] | null {
  if (textWidth(label, size) <= max) {
    return [label];
  }
  const words = label.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size) <= max) {
      cur = next;
      continue;
    }
    if (!cur || textWidth(w, size) > max) {
      return null;
    }
    out.push(cur);
    cur = w;
  }
  if (cur) {
    out.push(cur);
  }
  return out.length <= lines ? out : null;
}

/**
 * A label cut to fit one line of `max` px, with an ellipsis.
 * @param label - The text.
 * @param max - Width, px.
 * @param size - Font size.
 */
function truncate(label: string, max: number, size: number): string {
  const keep = Math.max(1, Math.floor(max / (size * GLYPH)) - 1);
  return label.length <= keep ? label : `${label.slice(0, keep).trimEnd()}…`;
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
 * More series than the palette can tell apart: keep the largest
 * {@link MAX_SERIES} − 1 by total and fold the rest into one "Other" series.
 * @param spec - The chart.
 */
export function foldSeries(spec: ChartSpec): { spec: ChartSpec; folded: string[] } {
  if (spec.series.length <= MAX_SERIES) {
    return { spec, folded: [] };
  }
  const ranked = spec.series.map((s, i) => ({ s, i, total: s.values.reduce<number>((a, v) => a + Math.abs(n0(v)), 0) })).sort((a, b) => b.total - a.total);
  const keep = new Set(ranked.slice(0, MAX_SERIES - 1).map(r => r.i));
  const rest = spec.series.filter((_, i) => !keep.has(i));
  const other: ChartSeries = {
    name: `Other (${rest.length})`,
    values: spec.x.map((_, xi) => (rest.every(s => s.values[xi] === null) ? null : rest.reduce((a, s) => a + n0(s.values[xi]), 0))),
    ...(rest.every(s => s.forecast) ? { forecast: true } : {}),
  };
  return { spec: { ...spec, series: [...spec.series.filter((_, i) => keep.has(i)), other] }, folded: rest.map(s => s.name) };
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

type Segment = { from: number; to: number; total: boolean };

/**
 * Waterfall segments: each x as a bar from `from` to `to`.
 * @param spec
 */
export function waterfallSegments(spec: ChartSpec): Segment[] {
  const totals = new Set(spec.waterfallTotals ?? []);
  const values = spec.series[0]!.values;
  let running = 0;
  return spec.x.map((label, i) => {
    if (totals.has(label) || (i === 0 && !totals.size)) {
      // A total with no value is the running sum: the model names subtotals, the library adds them up.
      running = values[i] === null || values[i] === undefined ? running : n0(values[i]);
      return { from: 0, to: running, total: true };
    }
    const v = n0(values[i]);
    const from = running;
    running += v;
    return { from, to: running, total: false };
  });
}

/**
 * A waterfall that starts at one of its subtotals (`waterfallStart`): the
 * bars before it are left out and it is drawn as the bridge's first total.
 * @param spec
 */
function fromWaterfallStart(spec: ChartSpec): ChartSpec {
  if (spec.type !== 'waterfall' || spec.waterfallStart === undefined) {
    return spec;
  }
  const at = spec.x.indexOf(spec.waterfallStart);
  if (at <= 0) {
    return spec;
  }
  const segs = waterfallSegments(spec);
  const totals = new Set(spec.waterfallTotals ?? []);
  const x = spec.x.slice(at);
  return {
    ...spec,
    x,
    series: [{ ...spec.series[0]!, values: [segs[at]!.to, ...spec.series[0]!.values.slice(at + 1)] }],
    waterfallTotals: [spec.waterfallStart, ...x.slice(1).filter(l => totals.has(l))],
    waterfallStart: undefined,
  };
}

function titleOf(spec: ChartSpec, s: ChartSeries, i: number, value: number | null, f: ValueFormat): string {
  return `${spec.x[i]} · ${s.name}: ${value === null ? '—' : formatValue(value, f, false)}${isForecastAt(spec, s, i) ? ' (forecast)' : ''}`;
}

function emptyFacts(orientation: Orientation): LayoutFacts {
  return { orientation, autoHorizontal: false, folded: [], wrapped: [], shortened: [], skipped: 0, minBar: 0, illegible: [], split: null, directLabels: false };
}

/**
 * Vertical or horizontal: what the spec asks, else what the labels and the
 * width allow. Time reads left to right, so a period axis stays vertical;
 * bars over category names turn horizontal when a name cannot be drawn under
 * its bar on two lines, or the bars would be thinner than a finger's worth.
 * @param spec - The chart.
 * @param width - Drawing width, px.
 * @param size - Font size.
 */
export function orientationOf(spec: ChartSpec, width: number, size: number): { orientation: Orientation; auto: boolean } {
  const barLike = spec.type === 'bar' || spec.type === 'waterfall';
  if (!barLike || spec.orientation === 'vertical') {
    return { orientation: 'vertical', auto: false };
  }
  if (spec.orientation === 'horizontal') {
    return { orientation: 'horizontal', auto: false };
  }
  if (axisKindOf(spec.x).kind === 'periods') {
    return { orientation: 'vertical', auto: false };
  }
  const plotW = width - size * 6;
  const slot = plotW / Math.max(1, spec.x.length);
  const perBar = stackModeOf(spec) === 'none' && spec.type === 'bar' ? spec.series.length : 1;
  const bar = (slot * (perBar > 1 ? 0.8 : 0.62)) / perBar;
  const fits = spec.x.every(l => wrapLabel(l, slot - size * 0.8, size) !== null);
  return fits && bar >= MIN_BAR_PX ? { orientation: 'vertical', auto: false } : { orientation: 'horizontal', auto: true };
}

/**
 * Where a waterfall's last steps become slivers at its first steps' scale:
 * the index of the first such step, when two or more of them end the bridge
 * and at least two big bars come before them.
 * @param spec - A waterfall.
 * @param extent - The plot's length along the value axis, px.
 */
export function waterfallTail(spec: ChartSpec, extent: number): number | null {
  const segs = waterfallSegments(spec);
  const lo = Math.min(0, ...segs.flatMap(s => [s.from, s.to]));
  const hi = Math.max(0, ...segs.flatMap(s => [s.from, s.to]));
  const px = (v: number) => (Math.abs(v) / (hi - lo || 1)) * extent;
  const tiny = (s: Segment) => px(s.total ? s.to : s.to - s.from) < TINY_STEP_PX;
  let k = segs.length;
  while (k > 0 && tiny(segs[k - 1]!)) {
    k -= 1;
  }
  return segs.length - k >= 2 && k >= 2 ? k : null;
}

/**
 * Lay a chart out at a width.
 * @param input - A spec that passed `chartSpecSchema`.
 * @param opts - The width (and optionally height and text size) to lay out at.
 */
export function layoutChart(input: ChartSpec, opts: LayoutOptions): ChartScene {
  const size = opts.fontSize ?? 11;
  const width = Math.max(160, Math.round(opts.width));
  const { spec: folded, folded: foldedNames } = foldSeries(input);
  const spec = fromWaterfallStart(folded);
  const { orientation, auto } = orientationOf(spec, width, size);
  if (spec.type === 'waterfall') {
    const extent = orientation === 'horizontal' ? width * 0.5 : Math.min(360, Math.max(200, width * 0.55)) - size * 3.5;
    const k = waterfallTail(spec, extent);
    if (k !== null) {
      return splitWaterfall(spec, k, { ...opts, width, fontSize: size }, orientation, auto);
    }
  }
  const scene = orientation === 'horizontal' ? layoutHorizontal(spec, { ...opts, width, fontSize: size }) : layoutVertical(spec, { ...opts, width, fontSize: size });
  scene.facts.autoHorizontal = auto;
  scene.facts.folded = foldedNames;
  return scene;
}

/**
 * The summary bridge plus a rescaled detail of its last steps, one above the
 * other: both read, at a phone's width too.
 * @param spec - The waterfall.
 * @param k - The first step of the tail.
 * @param opts - Layout options (width and font size resolved).
 * @param orientation - As chosen for the whole chart.
 * @param auto - Whether the layout chose it.
 */
function splitWaterfall(spec: ChartSpec, k: number, opts: LayoutOptions & { fontSize: number }, orientation: Orientation, auto: boolean): ChartScene {
  const size = opts.fontSize;
  const segs = waterfallSegments(spec);
  const totals = new Set(spec.waterfallTotals ?? []);
  const n = spec.x.length;
  const last = spec.x[n - 1]!;
  const values = spec.series[0]!.values;
  // The detail opens on a subtotal: the first small bar when it is one, else
  // the last big bar when that is one, else the running sum after it.
  const opensOnTail = segs[k]!.total;
  const before = spec.x[k - 1]!;
  const start = opensOnTail ? spec.x[k]! : segs[k - 1]!.total ? before : `After ${before}`;
  const startValue = opensOnTail ? segs[k]!.to : segs[k - 1]!.to;
  const rest = opensOnTail ? k + 1 : k;
  const main: ChartSpec = {
    ...spec,
    x: [...spec.x.slice(0, k), last],
    series: [{ ...spec.series[0]!, values: [...values.slice(0, k), segs[n - 1]!.to] }],
    waterfallTotals: [...spec.x.slice(0, k).filter((l, i) => totals.has(l) || (i === 0 && !totals.size)), last],
    title: undefined,
    subtitle: undefined,
  };
  const detail: ChartSpec = {
    ...spec,
    x: [start, ...spec.x.slice(rest)],
    series: [{ ...spec.series[0]!, values: [startValue, ...values.slice(rest)] }],
    waterfallTotals: [start, ...spec.x.slice(rest).filter(l => totals.has(l))],
    title: undefined,
    subtitle: undefined,
    targets: undefined,
  };
  const layoutOne = (s: ChartSpec, height?: number) => (orientation === 'horizontal' ? layoutHorizontal(s, { ...opts, ...(height ? { height } : {}) }) : layoutVertical(s, { ...opts, ...(height ? { height } : {}) }));
  const top = layoutOne(main, opts.height ? Math.round(opts.height * 0.55) : undefined);
  const bottom = layoutOne(detail, opts.height ? Math.round(opts.height * 0.45) - size * 2 : undefined);
  const heading = Math.round(size * 2.2);
  const shift = (m: Mark): Mark => {
    const dy = top.height + heading;
    switch (m.kind) {
      case 'rect':
        return { ...m, y: m.y + dy };
      case 'line':
        return { ...m, y1: m.y1 + dy, y2: m.y2 + dy };
      case 'circle':
        return { ...m, cy: m.cy + dy };
      case 'text':
        return { ...m, y: m.y + dy };
      case 'path':
        return { ...m, d: m.d.replace(/([ML])([\d.-]+) ([\d.-]+)/g, (_, c: string, x: string, y: string) => `${c}${x} ${(Number(y) + dy).toFixed(1)}`) };
    }
  };
  const label = `Detail, rescaled: ${start} to ${last}`;
  const marks: Mark[] = [
    ...top.marks,
    { kind: 'text', x: size * 0.4, y: top.height + heading * 0.6, text: label, anchor: 'start', size: size * 0.95, paint: 'muted', weight: 600 },
    ...bottom.marks.map(shift),
  ];
  const whole = orientation === 'horizontal' ? layoutHorizontal(spec, opts) : layoutVertical(spec, opts);
  const bars = [top.facts.minBar, bottom.facts.minBar].filter(v => v > 0);
  return {
    width: top.width,
    height: top.height + heading + bottom.height,
    marks,
    legend: top.legend,
    hatchSlots: [...new Set([...top.hatchSlots, ...bottom.hatchSlots])].sort((a, b) => a - b),
    title: spec.title ?? null,
    subtitle: spec.subtitle ?? null,
    desc: `${whole.desc} Drawn as the summary bridge, then its last ${n - rest} steps rescaled (${start} to ${last}) so they read.`,
    table: whole.table,
    caption: whole.caption,
    facts: {
      ...top.facts,
      orientation,
      autoHorizontal: auto,
      wrapped: [...new Set([...top.facts.wrapped, ...bottom.facts.wrapped])],
      shortened: [...new Set([...top.facts.shortened, ...bottom.facts.shortened])],
      minBar: bars.length ? Math.min(...bars) : 0,
      // The summary's slivers are the detail's bars: only the detail's own count.
      illegible: bottom.facts.illegible,
      directLabels: top.facts.directLabels && bottom.facts.directLabels,
      split: { from: start, to: last, steps: n - rest },
    },
  };
}

/**
 * The y (vertical) or x (horizontal) domain of the values drawn.
 * @param spec
 * @param values
 * @param mode
 * @param segments
 */
function valueDomain(spec: ChartSpec, values: number[][], mode: StackMode, segments: Segment[] | null): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  const n = spec.x.length;
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
  return { lo, hi };
}

/**
 * The legend: only what the marks do not already say.
 * @param spec
 * @param opts
 * @param opts.barLike
 * @param opts.endLabelled
 * @param opts.directLabels
 */
function legendOf(spec: ChartSpec, opts: { barLike: boolean; endLabelled: boolean; directLabels: boolean }): LegendItem[] {
  const legend: LegendItem[] = [];
  const forecastAt = forecastIndexOf(spec);
  if (spec.type !== 'waterfall' && spec.series.length > 1 && !opts.endLabelled) {
    spec.series.forEach((s, si) => legend.push({ label: s.forecast ? `${s.name} (forecast)` : s.name, slot: si, style: s.forecast ? (opts.barLike ? 'hatch' : 'dash') : opts.barLike ? 'solid' : 'line' }));
  } else if (spec.series.length === 1 && spec.series[0]!.forecast && spec.type !== 'waterfall') {
    legend.push({ label: `${spec.series[0]!.name} (forecast)`, slot: 0, style: opts.barLike ? 'hatch' : 'dash' });
  } else if (opts.endLabelled) {
    spec.series.forEach((s, si) => {
      if (s.forecast) {
        legend.push({ label: `${s.name} (forecast)`, slot: si, style: 'dash' });
      }
    });
  }
  if (forecastAt !== null) {
    legend.push({ label: `Forecast from ${spec.x[forecastAt]}`, slot: null, style: opts.barLike ? 'hatch' : 'dash' });
  }
  if (spec.type === 'waterfall' && !opts.directLabels) {
    legend.push({ label: 'Increase', slot: 2, style: 'solid' }, { label: 'Decrease', slot: 7, style: 'solid' }, { label: 'Total', slot: 0, style: 'solid' });
  }
  return legend;
}

/**
 * The data as a table, and the one-line description.
 * @param spec
 * @param mode
 * @param orientation
 */
function wordsOf(spec: ChartSpec, mode: StackMode, orientation: Orientation): { table: ChartScene['table']; desc: string; caption: string | null } {
  const forecastAt = forecastIndexOf(spec);
  const axis = axisKindOf(spec.x);
  const n = spec.x.length;
  const head = ['', ...spec.series.map(s => s.name), ...(mode === 'stack' ? ['Total'] : [])];
  const rows = spec.x.map((label, i) => {
    const cells = spec.series.map(s => (s.values[i] === null ? '—' : formatValue(s.values[i]!, valueFormatOf(spec), false)));
    const total = spec.series.reduce((a, s) => a + n0(s.values[i]), 0);
    return [`${label}${forecastAt !== null && i >= forecastAt ? ' (forecast)' : ''}`, ...cells, ...(mode === 'stack' ? [formatValue(total, valueFormatOf(spec), false)] : [])];
  });
  const kindWord = spec.type === 'waterfall' ? 'Waterfall' : mode === 'percent' ? '100% stacked bar' : mode === 'stack' ? `Stacked ${spec.type}` : spec.type === 'bar' && spec.series.length > 1 ? 'Grouped bar' : spec.type[0]!.toUpperCase() + spec.type.slice(1);
  const desc = `${kindWord}${orientation === 'horizontal' ? ' (horizontal)' : ''} chart of ${spec.series.map(s => s.name).join(', ')} across ${n} ${axis.kind === 'periods' ? 'periods' : 'categories'}, ${spec.x[0]} to ${spec.x[n - 1]}${forecastAt !== null ? `, forecast from ${spec.x[forecastAt]}` : ''}.`;
  // A waterfall that is all forecast says so in words: hatching every bar would only muddy the colors.
  const allForecast = spec.type === 'waterfall' && spec.series[0]!.forecast ? `${spec.series[0]!.name} (forecast)` : null;
  const caption = [allForecast, spec.source, spec.asOf ? `as of ${spec.asOf}` : null].filter(Boolean).join(' · ') || null;
  return { table: { head, rows }, desc, caption };
}

/**
 * A waterfall step's label: totals as they are, steps signed.
 * @param s
 * @param fmt
 * @param compact
 */
function stepLabel(s: Segment, fmt: ValueFormat, compact: boolean): string {
  const v = s.total ? s.to : s.to - s.from;
  return s.total ? formatValue(v, fmt, compact) : `${v >= 0 ? '+' : ''}${formatValue(v, fmt, compact)}`;
}

/**
 * Bars, lines and areas along x: periods or short category names.
 * @param spec - The chart (folded, started).
 * @param opts - Layout options (width and font size resolved).
 */
function layoutVertical(spec: ChartSpec, opts: LayoutOptions): ChartScene {
  const size = opts.fontSize ?? 11;
  const width = Math.max(160, Math.round(opts.width));
  const mode = stackModeOf(spec);
  const fmt: ValueFormat = mode === 'percent' ? { kind: 'percent' } : valueFormatOf(spec);
  const compact = spec.compact ?? true;
  const values = drawnValues(spec, mode);
  const n = spec.x.length;
  const isBarLike = spec.type === 'bar' || spec.type === 'waterfall';
  const forecastAt = forecastIndexOf(spec);
  const axis = axisKindOf(spec.x);
  const facts = emptyFacts('vertical');
  const segments = spec.type === 'waterfall' ? waterfallSegments(spec) : null;
  const { lo, hi } = valueDomain(spec, values, mode, segments);
  const ticks = niceDomain(lo, hi);
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]! || 1;

  // Lines with a few series are named at their ends rather than in a legend.
  const lastShown = (s: ChartSeries) => {
    for (let i = n - 1; i >= 0; i--) {
      if (s.values[i] !== null) {
        return i;
      }
    }
    return -1;
  };
  const endNames = !isBarLike && spec.series.length >= 2 && spec.series.length <= 5 ? spec.series.map(s => s.name) : [];
  const endRoom = endNames.length ? Math.ceil(Math.max(...endNames.map(t => textWidth(t, size * 0.92)))) + size : 0;
  const endLabelled = endNames.length > 0 && endRoom <= width * 0.28;

  // ---- frame
  const tickLabels = ticks.map(t => formatValue(t, fmt, compact));
  const left = Math.ceil(Math.max(...tickLabels.map(t => textWidth(t, size)))) + size;
  const markerRoom = spec.marker ? size * 1.6 : 0;
  const right = endLabelled ? endRoom : Math.round(size * 0.9);
  const plotW0 = Math.max(40, width - left - right);
  const band0 = plotW0 / Math.max(1, n);
  // Category names: one line, else two, else cut short.
  const slot0 = isBarLike ? band0 : n > 1 ? plotW0 / (n - 1) : plotW0;
  const catLines = axis.kind === 'periods'
    ? null
    : spec.x.map((l) => {
        const w = wrapLabel(l, slot0 - size * 0.8, size);
        if (w) {
          if (w.length > 1) {
            facts.wrapped.push(l);
          }
          return w;
        }
        facts.shortened.push(l);
        return [truncate(l, slot0 - size * 0.8, size)];
      });
  const labelLines = catLines ? Math.max(...catLines.map(l => l.length)) : 1;
  const height = Math.round(opts.height ?? Math.min(360, Math.max(200, width * 0.55)) + (labelLines - 1) * size * 1.2);
  const pad = { top: Math.round(size * 1.6 + markerRoom), right, bottom: Math.round(size * 2.4 + (labelLines - 1) * size * 1.2), left };
  const plotW = plotW0;
  const plotH = Math.max(60, height - pad.top - pad.bottom);
  const y = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const band = plotW / Math.max(1, n);
  const xCenter = (i: number) => pad.left + band * i + band / 2;
  const xPoint = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1));
  const at = isBarLike ? xCenter : xPoint;

  const marks: Mark[] = [];
  const hatch = new Set<number>();

  ticks.forEach((t, k) => {
    marks.push({ kind: 'line', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), paint: 'grid', width: 1 });
    marks.push({ kind: 'text', x: pad.left - size * 0.5, y: y(t), text: tickLabels[k]!, anchor: 'end', size: size * 0.92, paint: 'muted', middle: true });
  });

  // x labels
  const xLabelY = height - pad.bottom + size * 1.5;
  if (catLines) {
    catLines.forEach((lines, i) => lines.forEach((text, li) => marks.push({ kind: 'text', x: at(i), y: xLabelY + li * size * 1.2, text, anchor: 'middle', size, paint: 'muted' })));
  } else {
    const slot = isBarLike ? band : n > 1 ? plotW / (n - 1) : plotW;
    const placed = placeXLabels(spec.x, slot, size);
    facts.skipped = n - placed.drawn.length;
    for (const { i, text } of placed.drawn) {
      marks.push({ kind: 'text', x: at(i), y: xLabelY, text, anchor: 'middle', size, paint: 'muted' });
    }
  }

  if (forecastAt !== null) {
    const x0 = isBarLike ? pad.left + band * forecastAt : (xPoint(Math.max(0, forecastAt - 1)) + xPoint(forecastAt)) / 2;
    marks.push({ kind: 'rect', x: x0, y: pad.top, w: width - pad.right - x0, h: plotH, rx: 0, paint: 'surface', opacity: 1 });
  }

  let minBar = Number.POSITIVE_INFINITY;
  const gap = Math.max(1, size * 0.18);
  const valueSize = size * 0.92;
  let labelled = 0;
  let labellable = 0;
  const sliver = (label: string, v: number, px: number, hasLabel: boolean) => {
    if (px < SLIVER_PX && v !== 0 && !hasLabel) {
      facts.illegible.push({ label, value: formatValue(v, fmt, compact), px: Math.round(px * 10) / 10 });
    }
  };

  if (segments) {
    const bw = Math.max(2, band * 0.62);
    minBar = bw;
    segments.forEach((s, i) => {
      const top = y(Math.max(s.from, s.to));
      const bottom = y(Math.min(s.from, s.to));
      const up = s.to >= s.from;
      const slotN = s.total ? 0 : up ? 2 : 7;
      const v = s.total ? s.to : s.to - s.from;
      marks.push({ kind: 'rect', x: xCenter(i) - bw / 2, y: top, w: bw, h: Math.max(1, bottom - top), rx: 3, paint: { slot: slotN }, title: `${spec.x[i]}: ${formatValue(v, fmt, false)}` });
      if (i < n - 1) {
        marks.push({ kind: 'line', x1: xCenter(i) + bw / 2, x2: xCenter(i + 1) - bw / 2, y1: y(s.to), y2: y(s.to), paint: 'muted', width: 1, dash: '2 2' });
      }
      const label = stepLabel(s, fmt, compact);
      labellable += 1;
      const fits = textWidth(label, valueSize) <= band - gap;
      if (fits) {
        labelled += 1;
        marks.push({ kind: 'text', x: xCenter(i), y: top - size * 0.45, text: label, anchor: 'middle', size: valueSize, paint: 'text', weight: 600 });
      }
      sliver(spec.x[i]!, v, bottom - top, fits);
    });
  } else if (spec.type === 'bar') {
    const groupW = Math.max(2, band * (mode === 'none' && spec.series.length > 1 ? 0.8 : 0.62));
    if (mode === 'none') {
      const k = spec.series.length;
      const bw = Math.max(1, (groupW - gap * (k - 1)) / k);
      minBar = bw;
      const direct = k <= 3 && n <= 24;
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
          const x0 = xCenter(i) - groupW / 2 + si * (bw + gap);
          marks.push({ kind: 'rect', x: x0, y: top, w: bw, h: Math.max(0, bottom - top), rx: Math.min(4, bw / 3), paint: { slot: si }, opacity: spec.partialLast && i === n - 1 ? 0.45 : fc ? 0.4 : 1, ...(fc ? { hatch: si } : {}), title: titleOf(spec, s, i, s.values[i]!, fmt) });
          let has = false;
          if (direct) {
            labellable += 1;
            const label = formatValue(v, fmt, compact);
            const room = k === 1 ? band - gap : bw + gap * 2;
            if (textWidth(label, valueSize * (k === 1 ? 1 : 0.88)) <= room) {
              labelled += 1;
              has = true;
              marks.push({ kind: 'text', x: x0 + bw / 2, y: v >= 0 ? top - size * 0.45 : bottom + size * 1.05, text: label, anchor: 'middle', size: valueSize * (k === 1 ? 1 : 0.88), paint: 'text', weight: 600 });
            }
          }
          sliver(`${spec.x[i]}${k > 1 ? ` · ${s.name}` : ''}`, s.values[i]!, bottom - top, has);
        });
      });
    } else {
      minBar = groupW;
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
        if (mode === 'stack' && acc > 0 && n <= 16) {
          labellable += 1;
          const label = formatValue(acc, fmt, compact);
          if (textWidth(label, size * 0.88) <= band - gap) {
            labelled += 1;
            marks.push({ kind: 'text', x: xCenter(i), y: y(acc) - size * 0.45, text: label, anchor: 'middle', size: size * 0.88, paint: 'text', weight: 600 });
          }
        }
      }
    }
  } else {
    // line / area
    const acc = Array.from({ length: n }, () => 0);
    const ends: Array<{ y: number; text: string; slot: number }> = [];
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
        marks.push({ kind: 'path', d: pathOf(Math.max(0, firstFc - 1), n - 1), stroke: { slot: si }, width: 2, dash: '5 4' });
      }
      if (n <= 40) {
        pts.forEach((p, i) => {
          if (!p.missing) {
            marks.push({ kind: 'circle', cx: p.x, cy: p.yTop, r: 3, paint: { slot: si }, title: titleOf(spec, s, i, s.values[i]!, fmt) });
          }
        });
      }
      const li = lastShown(s);
      if (endLabelled && li >= 0) {
        ends.push({ y: pts[li]!.yTop, text: s.name, slot: si });
      }
    });
    // Names at the line ends, nudged apart so none overlaps.
    if (endLabelled) {
      const step = size * 1.15;
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) {
        ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + step);
      }
      const over = ends.length ? ends[ends.length - 1]!.y - (pad.top + plotH) : 0;
      for (const e of ends) {
        marks.push({ kind: 'text', x: width - pad.right + size * 0.5, y: e.y - Math.max(0, over), text: e.text, anchor: 'start', size: size * 0.92, paint: { slot: e.slot }, weight: 600, middle: true });
      }
    }
  }

  if (spec.trend && spec.type !== 'waterfall') {
    const upto = forecastAt ?? (spec.partialLast ? n - 1 : n);
    const fitted = trendLine(spec.series[0]!.values.slice(0, upto));
    if (fitted) {
      const lastI = fitted.length - 1;
      marks.push({ kind: 'line', x1: at(0), y1: y(fitted[0]!), x2: at(lastI), y2: y(fitted[lastI]!), paint: 'trend', width: 1.5, dash: '4 4' });
    }
  }

  for (const t of spec.targets ?? []) {
    marks.push({ kind: 'line', x1: pad.left, x2: width - pad.right, y1: y(t.value), y2: y(t.value), paint: 'target', width: 1.5, dash: '6 3' });
    marks.push({ kind: 'text', x: width - pad.right, y: y(t.value) - size * 0.45, text: `${t.label} ${formatValue(t.value, fmt, compact)}`, anchor: 'end', size: size * 0.88, paint: 'target', weight: 600 });
  }

  if (spec.marker) {
    const i = spec.x.indexOf(spec.marker.x);
    if (i >= 0) {
      const mx = at(i);
      marks.push({ kind: 'line', x1: mx, x2: mx, y1: pad.top - markerRoom * 0.4, y2: pad.top + plotH, paint: 'marker', width: 1, dash: '3 3' });
      const anchor = mx > width - textWidth(spec.marker.label, size) ? 'end' : mx < pad.left + textWidth(spec.marker.label, size) ? 'start' : 'middle';
      marks.push({ kind: 'text', x: mx, y: pad.top - markerRoom * 0.55, text: spec.marker.label, anchor, size: size * 0.9, paint: 'marker', weight: 600 });
    }
  }

  marks.push({ kind: 'line', x1: pad.left, x2: width - pad.right, y1: y(Math.max(yMin, 0)), y2: y(Math.max(yMin, 0)), paint: 'baseline', width: 1 });

  facts.minBar = Number.isFinite(minBar) ? Math.round(minBar * 10) / 10 : 0;
  facts.directLabels = labellable > 0 && labelled === labellable;
  const words = wordsOf(spec, mode, 'vertical');
  return {
    width,
    height,
    marks,
    legend: legendOf(spec, { barLike: isBarLike, endLabelled, directLabels: facts.directLabels }),
    hatchSlots: [...hatch].sort((a, b) => a - b),
    title: spec.title ?? null,
    subtitle: spec.subtitle ?? null,
    desc: words.desc,
    table: words.table,
    caption: words.caption,
    facts,
  };
}

/**
 * Bars along y: names down the side in full (wrapped to two lines), values
 * along x, each bar's value at its end. For long names, many categories, a
 * phone — and a waterfall whose steps are named in words.
 * @param spec - The chart (folded, started): a bar or a waterfall.
 * @param opts - Layout options (width and font size resolved).
 */
function layoutHorizontal(spec: ChartSpec, opts: LayoutOptions): ChartScene {
  const size = opts.fontSize ?? 11;
  const width = Math.max(160, Math.round(opts.width));
  const mode = stackModeOf(spec);
  const fmt: ValueFormat = mode === 'percent' ? { kind: 'percent' } : valueFormatOf(spec);
  const compact = spec.compact ?? true;
  const values = drawnValues(spec, mode);
  const n = spec.x.length;
  const forecastAt = forecastIndexOf(spec);
  const facts = emptyFacts('horizontal');
  const segments = spec.type === 'waterfall' ? waterfallSegments(spec) : null;
  const { lo, hi } = valueDomain(spec, values, mode, segments);
  const ticks = niceDomain(lo, hi);
  const vMin = ticks[0]!;
  const vMax = ticks[ticks.length - 1]! || 1;
  const valueSize = size * 0.92;

  // Names: as wide as the longest needs, up to 42% of the width, two lines.
  const labelMax = Math.min(width * 0.42, Math.max(...spec.x.map(l => textWidth(l, size))) + 2);
  const lines = spec.x.map((l) => {
    const w = wrapLabel(l, labelMax, size);
    if (w) {
      if (w.length > 1) {
        facts.wrapped.push(l);
      }
      return w;
    }
    facts.shortened.push(l);
    const two = wrapLabel(l, labelMax, size, 99) ?? [l];
    return [two[0]!, truncate(two.slice(1).join(' '), labelMax, size)];
  });
  const labelW = Math.ceil(Math.max(...lines.flat().map(t => textWidth(t, size))));

  // Each bar's value at its end: room for the widest.
  const endLabels = segments
    ? segments.map(s => stepLabel(s, fmt, compact))
    : mode === 'stack'
      ? spec.x.map((_, i) => formatValue(values.reduce((a, row) => a + Math.max(0, row[i]!), 0), fmt, compact))
      : mode === 'none'
        ? spec.series.flatMap((_, si) => values[si]!.map(v => formatValue(v, fmt, compact)))
        : [];
  const endRoom = endLabels.length ? Math.ceil(Math.max(...endLabels.map(t => textWidth(t, valueSize)))) + size * 0.8 : size;
  const k = mode === 'none' && spec.type === 'bar' ? spec.series.length : 1;
  const lineCount = Math.max(...lines.map(l => l.length));
  let rowH = Math.max(size * 2.4, lineCount * size * 1.2 + size * 0.9, k * 10 + size * 0.8);
  const pad = { top: Math.round(size * 0.8), right: Math.round(endRoom), bottom: Math.round(size * 2.2), left: Math.round(labelW + size) };
  if (opts.height) {
    rowH = Math.max(size * 1.4, (opts.height - pad.top - pad.bottom) / Math.max(1, n));
  }
  const height = Math.round(opts.height ?? pad.top + rowH * n + pad.bottom);
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = rowH * n;
  const xv = (v: number) => pad.left + ((v - vMin) / (vMax - vMin || 1)) * plotW;
  const rowTop = (i: number) => pad.top + i * rowH;
  const rowMid = (i: number) => rowTop(i) + rowH / 2;

  const marks: Mark[] = [];
  const hatch = new Set<number>();

  // value ticks along the bottom, thinned so none overlaps
  const tickLabels = ticks.map(t => formatValue(t, fmt, compact));
  const tickRoom = plotW / Math.max(1, ticks.length - 1);
  const tickStep = Math.max(1, Math.ceil((Math.max(...tickLabels.map(t => textWidth(t, size * 0.92))) + size) / Math.max(1, tickRoom)));
  ticks.forEach((t, ti) => {
    marks.push({ kind: 'line', x1: xv(t), x2: xv(t), y1: pad.top, y2: pad.top + plotH, paint: 'grid', width: 1 });
    if ((ticks.length - 1 - ti) % tickStep === 0) {
      marks.push({ kind: 'text', x: xv(t), y: pad.top + plotH + size * 1.4, text: tickLabels[ti]!, anchor: 'middle', size: size * 0.92, paint: 'muted' });
    }
  });

  if (forecastAt !== null) {
    marks.push({ kind: 'rect', x: pad.left, y: rowTop(forecastAt), w: plotW, h: plotH - forecastAt * rowH, rx: 0, paint: 'surface', opacity: 1 });
  }

  // names
  lines.forEach((ls, i) => {
    const y0 = rowMid(i) - ((ls.length - 1) * size * 1.2) / 2;
    ls.forEach((text, li) => marks.push({ kind: 'text', x: pad.left - size * 0.6, y: y0 + li * size * 1.2, text, anchor: 'end', size, paint: 'muted', middle: true }));
  });

  const thick = Math.max(2, rowH * (k > 1 ? 0.78 : 0.6));
  let minBar = Number.POSITIVE_INFINITY;
  let labelled = 0;
  let labellable = 0;
  const gap = Math.max(1, size * 0.18);
  const endLabel = (text: string, xEnd: number, yMid: number, paint: Paint = 'text') => {
    labellable += 1;
    if (xEnd + size * 0.4 + textWidth(text, valueSize) <= width) {
      labelled += 1;
      marks.push({ kind: 'text', x: xEnd + size * 0.4, y: yMid, text, anchor: 'start', size: valueSize, paint, weight: 600, middle: true });
      return true;
    }
    return false;
  };
  const sliver = (label: string, v: number, px: number, hasLabel: boolean) => {
    if (px < SLIVER_PX && v !== 0 && !hasLabel) {
      facts.illegible.push({ label, value: formatValue(v, fmt, compact), px: Math.round(px * 10) / 10 });
    }
  };

  if (segments) {
    minBar = thick;
    segments.forEach((s, i) => {
      const a = xv(Math.min(s.from, s.to));
      const b = xv(Math.max(s.from, s.to));
      const up = s.to >= s.from;
      const v = s.total ? s.to : s.to - s.from;
      marks.push({ kind: 'rect', x: a, y: rowMid(i) - thick / 2, w: Math.max(1, b - a), h: thick, rx: 3, paint: { slot: s.total ? 0 : up ? 2 : 7 }, title: `${spec.x[i]}: ${formatValue(v, fmt, false)}` });
      if (i < n - 1) {
        marks.push({ kind: 'line', x1: xv(s.to), x2: xv(s.to), y1: rowMid(i) + thick / 2, y2: rowMid(i + 1) - thick / 2, paint: 'muted', width: 1, dash: '2 2' });
      }
      const has = endLabel(stepLabel(s, fmt, compact), b, rowMid(i));
      sliver(spec.x[i]!, v, b - a, has);
    });
  } else if (mode === 'none') {
    const bh = Math.max(1, (thick - gap * (k - 1)) / k);
    minBar = bh;
    spec.series.forEach((s, si) => {
      values[si]!.forEach((v, i) => {
        if (s.values[i] === null) {
          return;
        }
        const fc = isForecastAt(spec, s, i);
        if (fc) {
          hatch.add(si);
        }
        const a = xv(Math.min(0, v));
        const b = xv(Math.max(0, v));
        const y0 = rowMid(i) - thick / 2 + si * (bh + gap);
        marks.push({ kind: 'rect', x: a, y: y0, w: Math.max(0, b - a), h: bh, rx: Math.min(4, bh / 3), paint: { slot: si }, opacity: fc ? 0.4 : 1, ...(fc ? { hatch: si } : {}), title: titleOf(spec, s, i, s.values[i]!, fmt) });
        const has = bh >= valueSize * 0.9 ? endLabel(formatValue(v, fmt, compact), b, y0 + bh / 2) : false;
        sliver(`${spec.x[i]}${k > 1 ? ` · ${s.name}` : ''}`, s.values[i]!, b - a, has);
      });
    });
  } else {
    minBar = thick;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const visible = spec.series.map((_, si) => si).filter(si => values[si]![i]! > 0);
      for (const si of visible) {
        const s = spec.series[si]!;
        const v = values[si]![i]!;
        const a = xv(acc);
        const b = xv(acc + v);
        acc += v;
        const fc = isForecastAt(spec, s, i);
        if (fc) {
          hatch.add(si);
        }
        const isLast = si === visible[visible.length - 1];
        marks.push({ kind: 'rect', x: a, y: rowMid(i) - thick / 2, w: Math.max(0, b - a - (isLast ? 0 : gap)), h: thick, rx: isLast ? Math.min(4, thick / 3) : 0, paint: { slot: si }, opacity: fc ? 0.4 : 1, ...(fc ? { hatch: si } : {}), title: titleOf(spec, s, i, mode === 'percent' ? v : s.values[i] ?? null, fmt) });
      }
      if (mode === 'stack' && acc > 0) {
        endLabel(formatValue(acc, fmt, compact), xv(acc), rowMid(i));
      }
    }
  }

  for (const t of spec.targets ?? []) {
    marks.push({ kind: 'line', x1: xv(t.value), x2: xv(t.value), y1: pad.top, y2: pad.top + plotH, paint: 'target', width: 1.5, dash: '6 3' });
    marks.push({ kind: 'text', x: xv(t.value), y: pad.top + plotH + size * 1.4, text: t.label, anchor: 'middle', size: size * 0.88, paint: 'target', weight: 600 });
  }

  marks.push({ kind: 'line', x1: xv(Math.max(vMin, 0)), x2: xv(Math.max(vMin, 0)), y1: pad.top, y2: pad.top + plotH, paint: 'baseline', width: 1 });

  facts.minBar = Number.isFinite(minBar) ? Math.round(minBar * 10) / 10 : 0;
  facts.directLabels = labellable > 0 && labelled === labellable;
  const words = wordsOf(spec, mode, 'horizontal');
  return {
    width,
    height,
    marks,
    legend: legendOf(spec, { barLike: true, endLabelled: false, directLabels: facts.directLabels }),
    hatchSlots: [...hatch].sort((a, b) => a - b),
    title: spec.title ?? null,
    subtitle: spec.subtitle ?? null,
    desc: words.desc,
    table: words.table,
    caption: words.caption,
    facts,
  };
}

export type { ChartSpec };
