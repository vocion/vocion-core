/**
 * The chart spec — one typed payload for every chart Vocion draws: the chat
 * card, the chart artifact, a chart block inside a document, a deck slide.
 *
 * Grown from the original `chart` card spec (line / bar / area, up to eight
 * series), which stays valid as written: `stacked: true` still stacks, `unit`
 * still formats. What it adds is what an analyst needs to say a number
 * honestly — a stack mode (stacked or 100%), a waterfall, which periods are
 * forecast, a target line and a "today" marker, how a value is aggregated
 * (period or running total), the stated totals the stack must sum to, and
 * where the numbers came from and as of when.
 *
 * Free of React and of the DOM: the `render_chart` tool (server) validates
 * with it, the document engine expands chart blocks with it, and the card
 * renders from it. See docs/guides/charts.md.
 */

import { z } from 'zod';

export const CHART_TYPES = ['bar', 'line', 'area', 'waterfall'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** The most series a chart draws apart: the categorical palette has eight fixed slots. More are folded into "Other" at layout. */
export const MAX_SERIES = 8;

/** The most series a spec may carry; past {@link MAX_SERIES} the layout keeps the largest and folds the rest into "Other". */
export const MAX_INPUT_SERIES = 40;

export const chartSeriesSchema = z.object({
  name: z.string().min(1).max(80),
  /** One per x label, in order; null for a gap (never read as zero). */
  values: z.array(z.number().nullable()),
  /** The whole series is a forecast (pipeline, plan): drawn hatched and labelled so in the legend. */
  forecast: z.boolean().optional(),
  /** A second y axis. Accepted only so the check can refuse it by name: two units on one axis; split it into two charts. */
  axis: z.enum(['left', 'right']).optional(),
});
export type ChartSeries = z.infer<typeof chartSeriesSchema>;

export const chartSpecSchema = z.object({
  /** The finding, as a sentence ("On pace for $5.1M, carried by Q4 renewals") — not the axes restated. */
  title: z.string().max(200).optional(),
  subtitle: z.string().max(240).optional(),
  type: z.enum(CHART_TYPES),
  /** Category or period labels along x, in order. */
  x: z.array(z.string()).min(1).max(400),
  /** One per series. Past {@link MAX_SERIES} the layout draws the largest and folds the rest into "Other". */
  series: z.array(chartSeriesSchema).min(1).max(MAX_INPUT_SERIES),
  /** Legacy unit: "$", "%", or a noun ("deals"). `format` is the precise form. */
  unit: z.string().max(24).optional(),
  format: z.enum(['currency', 'percent', 'number']).optional(),
  /** ISO 4217 code for `format: currency`; USD when omitted. */
  currency: z.string().length(3).optional(),
  /** $4.3M rather than $4,297,436 on ticks and labels. Default true. */
  compact: z.boolean().optional(),
  /** Legacy: true is `stack: "stack"`. */
  stacked: z.boolean().optional(),
  /** none groups the series side by side; stack piles them; percent piles them to 100%. */
  stack: z.enum(['none', 'stack', 'percent']).optional(),
  /** What one value is: this period's amount, a running total, or a point-in-time balance. */
  aggregation: z.enum(['period', 'cumulative', 'snapshot']).optional(),
  /** The first x label that is forecast: it and every label after it are drawn as forecast. */
  forecastFrom: z.string().optional(),
  /** A quiet least-squares line through the first series. */
  trend: z.boolean().optional(),
  /** Legacy: the last x is a period still in progress, drawn lighter and left out of the trend. */
  partialLast: z.boolean().optional(),
  /** Horizontal reference lines, e.g. the plan or a target. */
  targets: z.array(z.object({ value: z.number(), label: z.string().min(1).max(40) })).max(3).optional(),
  /** A vertical marker at one x label, e.g. today. */
  marker: z.object({ x: z.string(), label: z.string().min(1).max(24) }).optional(),
  /** The total each x is stated to have (one per x, null to skip): a stack must sum to it. */
  totals: z.array(z.number().nullable()).optional(),
  /** Waterfall only: the x labels drawn as full bars from zero (the start, subtotals, the end). */
  waterfallTotals: z.array(z.string()).optional(),
  /** Waterfall only: start the bridge at this subtotal (one of `waterfallTotals`); the bars before it are left out. */
  waterfallStart: z.string().optional(),
  /** Bars along x (vertical), along y (horizontal), or chosen at layout from the labels and the width (auto, the default). */
  orientation: z.enum(['auto', 'vertical', 'horizontal']).optional(),
  /** Where the numbers came from, for the caption ("QuickBooks P&L, by month"). */
  source: z.string().max(160).optional(),
  /** The date the numbers are as of (ISO, YYYY-MM-DD). */
  asOf: z.string().max(10).optional(),
}).superRefine((spec, ctx) => {
  for (const [i, s] of spec.series.entries()) {
    if (s.values.length !== spec.x.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series', i, 'values'], message: `series "${s.name}" has ${s.values.length} values for ${spec.x.length} x labels` });
    }
  }
  if (spec.totals && spec.totals.length !== spec.x.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['totals'], message: `totals has ${spec.totals.length} values for ${spec.x.length} x labels` });
  }
  if (spec.forecastFrom !== undefined && !spec.x.includes(spec.forecastFrom)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['forecastFrom'], message: `forecastFrom "${spec.forecastFrom}" is not one of the x labels` });
  }
  if (spec.waterfallStart !== undefined && !spec.x.includes(spec.waterfallStart)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['waterfallStart'], message: `waterfallStart "${spec.waterfallStart}" is not one of the x labels` });
  }
  if (spec.marker && !spec.x.includes(spec.marker.x)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['marker', 'x'], message: `marker x "${spec.marker.x}" is not one of the x labels` });
  }
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export type StackMode = 'none' | 'stack' | 'percent';

/**
 * The stack mode a spec asks for, reading the legacy `stacked` flag. Lines never stack unless asked by `stack`.
 * @param spec
 */
export function stackModeOf(spec: ChartSpec): StackMode {
  if (spec.type === 'waterfall') {
    return 'none';
  }
  if (spec.stack) {
    return spec.stack;
  }
  return spec.stacked && spec.type !== 'line' ? 'stack' : 'none';
}

/**
 * The index of the first forecast x, or null. `partialLast` is not a forecast: it is an unfinished actual.
 * @param spec
 */
export function forecastIndexOf(spec: ChartSpec): number | null {
  if (spec.forecastFrom === undefined) {
    return null;
  }
  const i = spec.x.indexOf(spec.forecastFrom);
  return i < 0 ? null : i;
}

/**
 * Whether the value at (series, x) is drawn as forecast.
 * @param spec
 * @param series
 * @param i
 */
export function isForecastAt(spec: ChartSpec, series: ChartSeries, i: number): boolean {
  if (series.forecast) {
    return true;
  }
  const from = forecastIndexOf(spec);
  return from !== null && i >= from;
}
