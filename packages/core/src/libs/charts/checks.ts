/**
 * Chart checks — few and hard, many and advisory.
 *
 * Good charts come from the model choosing the right form, the prompt saying
 * how, and the library laying it out well (`layout.ts`), not from a wall of
 * refusals (Chris, 2026-10-24: "make sure all these chart checks aren't super
 * static … good charting should be driven by model choice, prompting, and
 * libraries. Not over checking"). So:
 *
 * - **Refusals** are only for data that cannot be drawn honestly at all: a
 *   value that is not a number, a stack that does not sum to the total it
 *   states, two units on one axis, a waterfall that is not one series of
 *   steps. Nothing about taste or layout refuses a chart.
 * - **Signals** are what a careful analyst would mention: periods and
 *   scenarios on one axis, running totals as bars, no format, an unmarked
 *   forecast, a title that only names the axes. They ride back to the model
 *   with the rendered chart's review (`review.ts`), and the model decides.
 *
 * What the layout used to be refused for (labels that collide, bars too thin,
 * too many series) it now handles itself: horizontal bars, wrapped names,
 * thinned periods, "Other". Each rule reads the spec's structure, never its words.
 */

import type { ChartSpec } from './spec';
import { textWidth } from './layout';
import { axisKindOf } from './periods';
import { stackModeOf } from './spec';

export type ChartIssue = { rule: string; message: string };
export type ChartChecks = { refusals: ChartIssue[]; signals: ChartIssue[] };

/** Words a title may share with the axes and still say nothing beyond them. */
const STRUCTURAL = new Set(['by', 'per', 'over', 'time', 'chart', 'vs', 'versus', 'and', 'of', 'the', 'a', 'in', 'for', 'to', 'monthly', 'month', 'months', 'quarterly', 'quarter', 'quarters', 'weekly', 'week', 'weeks', 'yearly', 'annual', 'year', 'years', 'daily', 'day', 'days', 'trend', 'total', 'totals', 'breakdown', 'ytd', 'mtd', 'qtd']);

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9%$]+/).filter(Boolean);
}

function strictlyRising(v: Array<number | null>): boolean {
  const xs = v.filter((n): n is number => n !== null);
  return xs.length >= 4 && xs.every((n, i) => i === 0 || n > xs[i - 1]!);
}

/**
 * Check a chart spec. Run it on a spec that passed `chartSpecSchema`.
 * @param spec - The chart.
 */
export function checkChart(spec: ChartSpec): ChartChecks {
  const refusals: ChartIssue[] = [];
  const signals: ChartIssue[] = [];
  const mode = stackModeOf(spec);
  const axis = axisKindOf(spec.x);

  // ---- refusals: data that cannot be drawn honestly
  const nonFinite = [
    ...spec.series.flatMap(s => s.values.flatMap((v, i) => (v !== null && !Number.isFinite(v) ? [`${s.name} at ${spec.x[i]}`] : []))),
    ...(spec.totals ?? []).flatMap((v, i) => (v !== null && !Number.isFinite(v) ? [`total at ${spec.x[i]}`] : [])),
    ...(spec.targets ?? []).flatMap(t => (Number.isFinite(t.value) ? [] : [`target ${t.label}`])),
  ];
  if (nonFinite.length) {
    refusals.push({ rule: 'non-finite', message: `These values are not numbers: ${nonFinite.slice(0, 4).join(', ')}. Use a number, or null for a gap.` });
  }
  if (spec.totals && mode === 'stack') {
    const off = spec.x.flatMap((label, i) => {
      const stated = spec.totals![i];
      if (stated === null || stated === undefined) {
        return [];
      }
      const sum = spec.series.reduce((a, s) => a + (s.values[i] ?? 0), 0);
      return Math.abs(sum - stated) > Math.max(0.5, Math.abs(stated) * 0.005) ? [`${label} (${sum} vs ${stated})`] : [];
    });
    if (off.length) {
      refusals.push({ rule: 'stack-total', message: `The stacked series do not sum to the stated totals at ${off.slice(0, 4).join(', ')}. Fix the series or the totals.` });
    }
  }
  if (spec.series.some(s => s.axis === 'right')) {
    refusals.push({ rule: 'mixed-units', message: 'A series on a second axis puts two units on one chart, and the scales invent the comparison. Chart them as two charts that share x.' });
  }
  if (spec.type === 'waterfall' && spec.series.length !== 1) {
    refusals.push({ rule: 'waterfall-series', message: 'A waterfall is one series of steps: the start, each change, and the end (named in `waterfallTotals`).' });
  }

  // ---- signals: what an analyst would point out; the model decides
  if (axis.kind === 'mixed') {
    signals.push({ rule: 'mixed-axis', message: `x mixes periods (${axis.periods.slice(0, 4).join(', ')}) with other categories (${axis.others.slice(0, 3).join(', ')}). A scenario or forecast usually reads better as its own series (forecast: true, or forecastFrom) or its own small chart.` });
  }
  if (spec.type === 'bar' && spec.aggregation === 'cumulative') {
    signals.push({ rule: 'cumulative-bars', message: 'Bars of a running total make every period look bigger than the last. Each period\'s own amount as bars, or the running total as a line, usually says it better.' });
  } else if (spec.type === 'bar' && axis.kind === 'periods' && spec.aggregation === undefined && spec.series.some(s => strictlyRising(s.values))) {
    signals.push({ rule: 'running-total', message: 'These bars rise every period, as a running total does. If they are cumulative, a line reads better; if they are each period\'s amount, say aggregation "period".' });
  }
  if (!spec.format && !spec.unit && mode !== 'percent') {
    signals.push({ rule: 'no-format', message: 'The values have no format, so they draw as bare numbers. Say currency (with its code), percent, number, or a unit.' });
  }
  if (mode !== 'none' && spec.series.some(s => s.values.some(v => v !== null && v < 0))) {
    signals.push({ rule: 'stack-negative', message: 'A stack hides its negative values. Losses read better as their own grouped series, or as a waterfall.' });
  }
  if (spec.asOf && axis.kind === 'periods' && spec.forecastFrom === undefined && !spec.series.some(s => s.forecast)) {
    signals.push({ rule: 'forecast-unmarked', message: `The chart is as of ${spec.asOf}. If any period is after that, mark it with forecastFrom or forecast: true.` });
  }
  if (!spec.title) {
    signals.push({ rule: 'no-title', message: 'No title. A title that states the finding ("Revenue is on pace for $5.1M") tells the reader what to see.' });
  } else {
    const own = new Set([...spec.series.flatMap(s => words(s.name)), ...spec.x.flatMap(words), ...words(spec.unit ?? ''), ...words(spec.source ?? '')]);
    const extra = words(spec.title).filter(w => !own.has(w) && !STRUCTURAL.has(w) && !/^\d{4}$/.test(w));
    if (extra.length === 0 && !/\d/.test(spec.title.replace(/\b\d{4}\b/g, ''))) {
      signals.push({ rule: 'title-restates-axes', message: `"${spec.title}" names the axes. The finding (the change, the pace, the outlier) usually makes a better title.` });
    }
    if (textWidth(spec.title, 13) > 390 * 1.6) {
      signals.push({ rule: 'long-title', message: 'The title runs past two lines on a phone; the detail could move to the subtitle.' });
    }
  }
  return { refusals, signals };
}

/**
 * Refusals as the model reads them: what to fix before it can render.
 * @param c - The checks.
 */
export function refusalText(c: ChartChecks): string {
  return ['The chart cannot be drawn honestly yet:', ...c.refusals.map(e => `- [${e.rule}] ${e.message}`)].join('\n');
}
