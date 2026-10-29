/**
 * The dashboard spec — one page of figures, charts and tables a team opens
 * every day, kept current by an agent.
 *
 * Why a kind of its own: on 2026-10-29 the Executive group was running the
 * company from a dashboard built by hand in another tool (revenue, margin,
 * operating income, pipeline, initiatives ranked), refreshed by asking for it
 * again. Everything it showed Vocion already draws — a headline number is a
 * `Stat`, a chart is the chart engine's spec, a table is the table card's spec
 * — so a dashboard is those, arranged, with the three things that make it a
 * dashboard rather than a document: when its numbers are as of, where they
 * come from, and how to build it again (`refresh.method`), so any agent can
 * refresh it without being told twice.
 *
 * It is an artifact (principle 7): versions, share, the log and the pane come
 * free, and a refresh is one `update_artifact` — a new version, never a copy.
 * Pure: the tool validates with it, the card renders with it, the row stores
 * what passes it.
 */

import { z } from 'zod';
import { dataTableSpecSchema } from '@/libs/cards/tableSpec';
import { chartSpecSchema } from '@/libs/charts/spec';

/** The folder a dashboard is filed in unless the person names another; the Dashboards page reads it. */
export const DASHBOARD_FOLDER = 'dashboards';

/** The most charts one dashboard draws: past this it is two dashboards. */
export const MAX_DASHBOARD_CHARTS = 24;

export const dashboardStatSchema = z.object({
  /** What the number is, as a person says it: "Revenue", "Weighted pipeline". */
  label: z.string().min(1).max(60),
  /** The number. Null when it could not be read: the figure says so rather than showing zero. */
  value: z.number().nullable(),
  format: z.enum(['currency', 'percent', 'number']).optional(),
  /** ISO 4217 code for `format: currency`; USD when omitted. */
  currency: z.string().length(3).optional(),
  /** A noun unit when not currency or percent: "deals", "days". */
  unit: z.string().max(24).optional(),
  /** $454.3K rather than $454,312. Default true. */
  compact: z.boolean().optional(),
  /** The figure as written when it is not one number: "1 / 5", "Q3". Shown instead of `value`. */
  display: z.string().max(24).optional(),
  /** How it moved, as a change against a stated comparison. */
  delta: z.object({
    /** The change in `format` units: −14 with format percent is "14%" down. */
    value: z.number(),
    format: z.enum(['currency', 'percent', 'number']).optional(),
    /** What the change is against: "vs August", "vs last week". */
    against: z.string().min(1).max(40),
    /** Which way is good news. Colour follows it; `neither` leaves the move uncoloured. */
    better: z.enum(['up', 'down', 'neither']).default('up'),
  }).optional(),
  /** The target the figure is held to, shown under it: "target 60%". */
  target: z.object({ value: z.number(), label: z.string().max(40).optional() }).optional(),
  /** One quiet line for what the number covers: "Sep 2026, accrual". */
  note: z.string().max(140).optional(),
  /** Where this figure came from, when it differs from the dashboard's `sources`. */
  source: z.string().max(120).optional(),
  /** The record, report or page behind the number, one move away. */
  href: z.string().max(500).optional(),
});
export type DashboardStat = z.infer<typeof dashboardStatSchema>;

export const dashboardBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stats'), items: z.array(dashboardStatSchema).min(1).max(12) }),
  z.object({ type: z.literal('chart'), chart: chartSpecSchema }),
  z.object({ type: z.literal('table'), table: dataTableSpecSchema }),
  /** A short passage of markdown: a finding that needs a sentence, never methodology. */
  z.object({ type: z.literal('text'), md: z.string().min(1).max(4000) }),
]);
export type DashboardBlock = z.infer<typeof dashboardBlockSchema>;

export const dashboardSectionSchema = z.object({
  title: z.string().max(80).optional(),
  /** One line under the title: what the section covers. */
  note: z.string().max(300).optional(),
  blocks: z.array(dashboardBlockSchema).min(1).max(24),
});
export type DashboardSection = z.infer<typeof dashboardSectionSchema>;

export const dashboardTabSchema = z.object({
  label: z.string().min(1).max(32),
  sections: z.array(dashboardSectionSchema).min(1).max(12),
});
export type DashboardTab = z.infer<typeof dashboardTabSchema>;

export const DASHBOARD_CADENCES = ['daily', 'weekly', 'monthly', 'on-request'] as const;

export const dashboardSpecObject = z.object({
  title: z.string().min(1).max(120),
  /**
   * The lead: what the numbers say today, in two or three sentences, with
   * the figures that matter in bold. Rewritten on every refresh.
   */
  summary: z.string().max(1200).optional(),
  /** One line: where the numbers come from and how fresh each source is. */
  sources: z.string().max(400).optional(),
  /** When the numbers were read (ISO date or date-time). Every dashboard is dated. */
  asOf: z.string().min(10).max(40),
  /** One tab reads as a page with no tab bar; more split the page. */
  tabs: z.array(dashboardTabSchema).min(1).max(8),
  /**
   * How to build it again. `method` is the recipe a refresh follows — the
   * reads, the definition of each figure, the judgement calls — written by
   * the agent that built it, so the next agent (or a schedule) reproduces it
   * rather than reinventing it. One move away in the view, never the lead.
   */
  refresh: z.object({
    cadence: z.enum(DASHBOARD_CADENCES).default('on-request'),
    method: z.string().min(1).max(8000),
  }).optional(),
});

/**
 * The rules across blocks, shared by the spec and the card's schema (which
 * adds the row id the pane passes in).
 * @param spec - The parsed object.
 * @param ctx - Zod's refinement context.
 */
export function refineDashboard(spec: z.infer<typeof dashboardSpecObject>, ctx: z.RefinementCtx): void {
  const charts = spec.tabs.flatMap(t => t.sections.flatMap(s => s.blocks.filter(b => b.type === 'chart')));
  if (charts.length > MAX_DASHBOARD_CHARTS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tabs'], message: `${charts.length} charts; a dashboard draws at most ${MAX_DASHBOARD_CHARTS}. Split it into two dashboards.` });
  }
  const labels = spec.tabs.map(t => t.label.toLowerCase());
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tabs'], message: 'two tabs share a label' });
  }
}

export const dashboardSpecSchema = dashboardSpecObject.superRefine(refineDashboard);
export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;

/**
 * Every block in reading order, with where it sits — for checks and receipts.
 * @param spec - A dashboard that passed {@link dashboardSpecSchema}.
 */
export function dashboardBlocks(spec: DashboardSpec): Array<{ tab: string; section: string | null; block: DashboardBlock }> {
  return spec.tabs.flatMap(t => t.sections.flatMap(s => s.blocks.map(block => ({ tab: t.label, section: s.title ?? null, block }))));
}
