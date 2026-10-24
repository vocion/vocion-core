/**
 * Chart lint — the checks every chart passes before anyone sees it.
 *
 * 2026-10-23, the Finance Team's revenue chart: cumulative bars, with
 * "Jul, Aug, Sep, Oct 23*" and two year-end scenarios ("EOY: booked",
 * "+weighted") on one axis, labels on top of each other on a phone. Each of
 * those is a rule here, and an error stops `render_chart` and a document's
 * chart block until the agent fixes it; a warning rides on the receipt.
 *
 * Every rule reads the spec's own structure and its laid-out geometry —
 * label forms, counts, sums, widths. None reads intent into words.
 */

import type { ChartSpec } from './spec';
import { layoutChart, textWidth } from './layout';
import { axisKindOf } from './periods';
import { stackModeOf } from './spec';

export type LintIssue = { rule: string; message: string };
export type LintResult = { errors: LintIssue[]; warnings: LintIssue[] };

/** The widths a chart must read at: a phone and a desktop pane. */
export const LINT_WIDTHS = { phone: 360, desktop: 960 } as const;

/** The narrowest a bar may be drawn on a phone, px. */
const MIN_BAR_PX = 4;

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
 * Lint a chart spec. Run it on a spec that passed `chartSpecSchema`.
 * @param spec - The chart.
 */
export function lintChart(spec: ChartSpec): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const mode = stackModeOf(spec);
  const axis = axisKindOf(spec.x);

  // 1. One axis, one kind of thing.
  if (axis.kind === 'mixed') {
    errors.push({ rule: 'mixed-axis', message: `The x axis mixes periods (${axis.periods.slice(0, 4).join(', ')}) with other categories (${axis.others.slice(0, 3).join(', ')}). Keep x to periods: put a scenario or forecast in its own series (stacked, with \`forecast: true\` or \`forecastFrom\`), or chart the scenarios separately.` });
  }

  // 2. Bars are amounts per period; a running total is a line.
  if (spec.type === 'bar' && spec.aggregation === 'cumulative') {
    errors.push({ rule: 'cumulative-bars', message: 'Bars of a running total make every period look bigger than the last. Chart each period\'s own amount as bars (`aggregation: "period"`), or the running total as a line.' });
  } else if (spec.type === 'bar' && axis.kind === 'periods' && spec.aggregation === undefined && spec.series.some(s => strictlyRising(s.values))) {
    warnings.push({ rule: 'running-total', message: 'These bars rise every period, as a running total does. If they are cumulative, chart them as a line; if they are each period\'s amount, say `aggregation: "period"`.' });
  }

  // 3. Series and categories the width can carry.
  // More than MAX_SERIES never reaches here: the spec refuses it, with the same advice.
  if (spec.type === 'waterfall' && spec.series.length !== 1) {
    errors.push({ rule: 'waterfall-series', message: 'A waterfall is one series of steps: the start, each change, and the end (named in `waterfallTotals`).' });
  }
  if (spec.series.some(s => s.axis === 'right')) {
    errors.push({ rule: 'dual-axis', message: 'Two y axes on one chart invite a comparison the scales invent. Split it into two charts that share the x axis.' });
  }

  // 4. Every value has a unit.
  if (!spec.format && !spec.unit && mode !== 'percent') {
    errors.push({ rule: 'missing-format', message: 'Say what the numbers are: `format: "currency"` (with `currency`), `"percent"`, `"number"`, or a `unit` such as "deals".' });
  }

  // 5. Stated totals hold.
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
      errors.push({ rule: 'stack-total', message: `The stacked series do not sum to the stated totals at ${off.slice(0, 4).join(', ')}. Fix the series or the totals; a stack that does not add up is the number a reader checks first.` });
    }
  }
  if (mode !== 'none' && spec.series.some(s => s.values.some(v => v !== null && v < 0))) {
    warnings.push({ rule: 'stack-negative', message: 'A stack with negative values hides them. Chart losses as their own grouped series, or use a waterfall.' });
  }

  // 6. It reads at a phone's width and at a desktop's.
  for (const [where, width] of Object.entries(LINT_WIDTHS)) {
    const scene = layoutChart(spec, { width });
    if (scene.collision.length) {
      errors.push({ rule: 'label-collision', message: `At ${where} width (${width}px) these x labels cannot be drawn without overlapping: ${scene.collision.slice(0, 4).join(', ')}. Shorten them (an abbreviation, a code) or chart fewer categories.` });
    }
    if (where === 'phone' && (spec.type === 'bar' || spec.type === 'waterfall') && scene.minBarWidth > 0 && scene.minBarWidth < MIN_BAR_PX) {
      errors.push({ rule: 'too-many-categories', message: `${spec.x.length} categories × ${mode === 'none' ? spec.series.length : 1} bars are thinner than ${MIN_BAR_PX}px on a phone. Group them (weeks into months), keep the top ones and fold the rest into "Other", or use a line.` });
    }
  }

  // 7. Forecast is marked as forecast.
  if (spec.asOf && axis.kind === 'periods' && spec.forecastFrom === undefined && !spec.series.some(s => s.forecast)) {
    warnings.push({ rule: 'forecast-unmarked', message: `The chart is as of ${spec.asOf}. If any period is after that, mark it: \`forecastFrom\` (the first forecast x) or \`forecast: true\` on the forecast series.` });
  }

  // 8. The title says the finding.
  if (!spec.title) {
    warnings.push({ rule: 'no-title', message: 'Give the chart a title that states its finding ("Revenue is on pace for $5.1M").' });
  } else {
    const own = new Set([...spec.series.flatMap(s => words(s.name)), ...spec.x.flatMap(words), ...words(spec.unit ?? ''), ...words(spec.source ?? '')]);
    const extra = words(spec.title).filter(w => !own.has(w) && !STRUCTURAL.has(w) && !/^\d{4}$/.test(w));
    if (extra.length === 0 && !/\d/.test(spec.title.replace(/\b\d{4}\b/g, ''))) {
      warnings.push({ rule: 'title-restates-axes', message: `"${spec.title}" names the axes. Say what the reader should see: the change, the pace, the outlier ("Q4 renewals carry the year to $5.1M").` });
    }
  }
  if (spec.title && textWidth(spec.title, 13) > LINT_WIDTHS.phone * 1.6) {
    warnings.push({ rule: 'long-title', message: 'The title runs past two lines on a phone. Keep the finding; move the detail to `subtitle`.' });
  }

  return { errors, warnings };
}

/**
 * The lint as the agent reads it: what to fix, then what to consider.
 * @param r - A lint result.
 */
export function lintText(r: LintResult): string {
  const lines: string[] = [];
  if (r.errors.length) {
    lines.push('Fix before it can render:', ...r.errors.map(e => `- [${e.rule}] ${e.message}`));
  }
  if (r.warnings.length) {
    lines.push('Consider:', ...r.warnings.map(w => `- [${w.rule}] ${w.message}`));
  }
  return lines.join('\n');
}
