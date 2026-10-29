/**
 * What a dashboard is held to, and what its receipt tells the model.
 *
 * The same bar as everywhere else the chart engine draws: only data that
 * cannot be drawn honestly is refused (each chart's own refusals). The rest
 * are notes the model reads on the receipt and judges — a chart that came out
 * as slivers, a figure with no date or source anywhere on the page.
 */

import type { DashboardSpec } from './spec';
import { checkChart } from '@/libs/charts/checks';
import { layoutChart } from '@/libs/charts/layout';
import { factNotes } from '@/libs/charts/review';
import { dashboardBlocks } from './spec';

/** About the width one chart gets in a dashboard's grid. */
export const DASHBOARD_CHART_WIDTH = 520;

export type DashboardReview = { refusals: string[]; notes: string[]; counts: { tabs: number; figures: number; charts: number; tables: number } };

function where(tab: string, section: string | null, i: number, multiTab: boolean): string {
  return [multiTab ? `tab "${tab}"` : null, section ? `"${section}"` : null, `chart ${i}`].filter(Boolean).join(', ');
}

/**
 * Refusals (each chart's own) and notes for the model, with what was drawn.
 * @param spec - A dashboard that passed the schema.
 */
export function reviewDashboard(spec: DashboardSpec): DashboardReview {
  const refusals: string[] = [];
  const notes: string[] = [];
  const blocks = dashboardBlocks(spec);
  const multiTab = spec.tabs.length > 1;
  let charts = 0;
  let figures = 0;
  let tables = 0;
  for (const { tab, section, block } of blocks) {
    if (block.type === 'chart') {
      charts += 1;
      const label = where(tab, section, charts, multiTab);
      const checks = checkChart(block.chart);
      refusals.push(...checks.refusals.map(r => `${label} ("${block.chart.title ?? 'untitled'}"): ${r.message}`));
      if (!checks.refusals.length) {
        notes.push(...checks.signals.map(s => `${label}: ${s.message}`));
        notes.push(...factNotes(layoutChart(block.chart, { width: DASHBOARD_CHART_WIDTH }).facts, { brief: true }).map(n => `${label}: ${n}`));
      }
    } else if (block.type === 'stats') {
      figures += block.items.length;
      const unread = block.items.filter(s => s.value === null && !s.display).map(s => `"${s.label}"`);
      if (unread.length) {
        notes.push(`${unread.join(', ')} could not be read and show as unread; say why in the summary or drop the figure.`);
      }
    } else if (block.type === 'table') {
      tables += 1;
    }
  }
  if (!spec.sources) {
    const unsourced = blocks.some(({ block }) => (block.type === 'stats' && block.items.some(s => !s.source)) || (block.type === 'chart' && !block.chart.source));
    if (unsourced) {
      notes.push('Some figures name no source and the dashboard has no `sources` line: say where the numbers come from.');
    }
  }
  if (!spec.refresh) {
    notes.push('No `refresh.method`: write how to rebuild it (the reads, what each figure is), or the next refresh starts from nothing.');
  }
  return { refusals, notes, counts: { tabs: spec.tabs.length, figures, charts, tables } };
}

/**
 * "2 tabs, 7 figures, 4 charts, 1 table" — the receipt's summary.
 * @param counts - From {@link reviewDashboard}.
 */
export function countsLine(counts: DashboardReview['counts']): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  return [
    counts.tabs > 1 ? n(counts.tabs, 'tab') : null,
    counts.figures ? n(counts.figures, 'figure') : null,
    counts.charts ? n(counts.charts, 'chart') : null,
    counts.tables ? n(counts.tables, 'table') : null,
  ].filter(Boolean).join(', ');
}
