/**
 * THE SAVINGS DASHBOARD — what the workspace's automations saved, as a
 * `dashboard` artifact (`libs/dashboards/`): the conclusion for the last
 * weeks, the trend week by week, each automation's share, and the decisions
 * its expert made with the rules those answers became. Built from the one
 * savings read (`savingsReads.ts`), so it says what the batch and automation
 * pages say; filed or refreshed by `routine_report` (`dashboard: true`), a new
 * version of the same artifact each time.
 *
 * A dashboard is dated and keeps its recipe (`refresh.method`), so any agent
 * can rebuild it. With no baseline on any automation the saving is left out
 * and the dashboard is runs, cost and decisions alone.
 */

import type { DashboardBlock, DashboardSection, DashboardSpec, DashboardStat } from '@/libs/dashboards/spec';
import type { Savings } from '@/libs/routines/savings';
import type { Author } from '@/services/ArtifactService';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { DASHBOARD_FOLDER, dashboardSpecSchema } from '@/libs/dashboards/spec';
import { db } from '@/libs/DB';
import { dayLabel, dollars, hasSaving, savingSentence, tokensLabel } from '@/libs/routines/savings';
import { routineSchema, routineVersionSchema } from '@/models/Schema';
import { namesOf } from './routineReads';
import { routineSavings } from './savingsReads';

/** The title it is filed under, and found again by. */
export const SAVINGS_DASHBOARD_TITLE = 'What the automations saved';

const hours = (minutes: number | null) => (minutes === null ? null : Math.round((minutes / 60) * 10) / 10);

function figures(s: Savings, period: string): DashboardStat[] {
  const out: DashboardStat[] = [];
  if (hasSaving(s)) {
    out.push({ label: 'Time saved', value: hours(s.savedMinutes), format: 'number', unit: 'hours', note: period });
    if (s.savedCents !== null && s.rate) {
      out.push({ label: 'Worth', value: Math.round(s.savedCents / 100), format: 'currency', compact: false, note: `at $${Math.round(s.rate.cents / 100)} an hour` });
    }
  }
  out.push(
    { label: 'Run cost', value: s.costCents / 100, format: 'currency', compact: false, note: `${tokensLabel(s.tokens)} tokens` },
    { label: 'Runs', value: s.runs, format: 'number', note: `${s.done} finished` },
  );
  if (s.decisions > 0) {
    out.push({ label: 'Decisions', value: s.decisions, format: 'number', note: 'the expert answered' });
  }
  return out;
}

/**
 * The dashboard as of now.
 * @param orgId - The workspace.
 * @param opts - The clock and how many weeks the trend covers.
 * @param opts.now - The clock.
 * @param opts.weeks - Weeks in the trend (default 8).
 */
export async function savingsDashboardSpec(orgId: string, opts: { now?: number; weeks?: number } = {}): Promise<DashboardSpec> {
  const now = opts.now ?? Date.now();
  const weeks = opts.weeks ?? 8;
  const report = await routineSavings(orgId, { now, weeks });
  const routines = await db.select({ id: routineSchema.id, name: routineSchema.name, expertUserId: routineSchema.expertUserId }).from(routineSchema).where(eq(routineSchema.orgId, orgId));
  const learned = routines.length === 0
    ? []
    : await db.select().from(routineVersionSchema).where(and(inArray(routineVersionSchema.routineId, routines.map(r => r.id)), gt(routineVersionSchema.n, 1))).orderBy(desc(routineVersionSchema.createdAt)).limit(12);
  const names = await namesOf([...routines.map(r => r.expertUserId), ...learned.map(v => v.approvedBy)]);
  const experts = [...new Set(routines.map(r => (r.expertUserId ? names.get(r.expertUserId) : null)).filter((x): x is string => Boolean(x)))];
  const expert = experts.length === 1 ? experts[0]! : 'The experts';
  const period = `last ${weeks} weeks`;
  const s = report.recent;

  const lead = [
    savingSentence(s, `in the last ${weeks} weeks`) ?? `${s.runs} runs in the last ${weeks} weeks, for ${dollars(s.costCents)}.`,
    hasSaving(report.month) ? savingSentence(report.month, 'this month') : null,
    s.decisions > 0 ? `${expert} made ${s.decisions} ${s.decisions === 1 ? 'decision' : 'decisions'} the automations stopped for${learned.length > 0 ? `, and ${learned.length} ${learned.length === 1 ? 'answer became a rule' : 'answers became rules'} in a new version` : ''}.` : null,
  ].filter(Boolean).join(' ');

  const trend: DashboardBlock[] = [];
  const x = report.weeks.map(w => w.label);
  if (report.weeks.some(w => hasSaving(w.savings))) {
    trend.push({ type: 'chart', chart: { title: 'Hours saved each week', type: 'bar', x, series: [{ name: 'Hours saved', values: report.weeks.map(w => hours(w.savings.savedMinutes) ?? 0) }], format: 'number', unit: 'hours', partialLast: true } });
  }
  trend.push({ type: 'chart', chart: { title: 'What the runs cost each week', type: 'bar', x, series: [{ name: 'Run cost', values: report.weeks.map(w => w.savings.costCents / 100) }], format: 'currency', partialLast: true } });

  const anySaving = report.byRoutine.some(r => hasSaving(r.recent));
  const anyValue = report.byRoutine.some(r => r.recent.savedCents !== null);
  const byAutomation: DashboardBlock = {
    type: 'table',
    table: {
      columns: [
        { key: 'name', label: 'Automation', type: 'link', hrefKey: 'href' },
        { key: 'runs', label: 'Runs', type: 'number' },
        ...(anySaving ? [{ key: 'saved', label: 'Hours saved', type: 'number' as const }] : []),
        ...(anyValue ? [{ key: 'worth', label: 'Worth', type: 'currency' as const }] : []),
        { key: 'cost', label: 'Run cost', type: 'currency' },
        { key: 'decisions', label: 'Decisions', type: 'number' },
      ],
      rows: report.byRoutine.filter(r => r.recent.runs > 0).map(r => ({
        name: r.name,
        href: `/dashboard/automations/${r.id}`,
        runs: r.recent.runs,
        ...(anySaving ? { saved: hours(r.recent.savedMinutes) } : {}),
        ...(anyValue ? { worth: r.recent.savedCents === null ? null : r.recent.savedCents / 100 } : {}),
        cost: r.recent.costCents / 100,
        decisions: r.recent.decisions,
      })),
    },
  };

  const sections: DashboardSection[] = [
    { title: `The ${period}`, blocks: [{ type: 'stats', items: figures(s, period) }] },
    { title: 'Week by week', blocks: trend },
  ];
  if (byAutomation.type === 'table' && byAutomation.table.rows.length > 0) {
    sections.push({ title: 'By automation', blocks: [byAutomation] });
  }
  if (learned.length > 0) {
    const routineName = new Map(routines.map(r => [r.id, r.name]));
    sections.push({
      title: 'What the answers taught',
      note: `Answers ${expert === 'The experts' ? 'the experts' : expert} wanted applied next time, each a new version approved before it ran.`,
      blocks: [{
        type: 'table',
        table: {
          columns: [
            { key: 'automation', label: 'Automation', type: 'link', hrefKey: 'href' },
            { key: 'change', label: 'What changed' },
            { key: 'status', label: 'Status', type: 'badge' },
          ],
          rows: learned.map(v => ({
            automation: `${routineName.get(v.routineId) ?? 'Automation'}, v${v.n}`,
            href: `/dashboard/automations/${v.routineId}`,
            change: v.change ?? 'A new version',
            status: v.status === 'approved' ? 'Approved' : v.status === 'draft' ? 'Waiting for approval' : 'Replaced',
          })),
        },
      }],
    });
  }

  return dashboardSpecSchema.parse({
    title: SAVINGS_DASHBOARD_TITLE,
    summary: lead,
    sources: [
      report.sampleBefore ? `Sample history before ${dayLabel(report.sampleBefore)}` : null,
      'From each automation’s runs, its by-hand baseline, the time people spent on its decisions and the spend ledger',
    ].filter(Boolean).join(' · '),
    // The day as the workspace reads it, not UTC's.
    asOf: new Intl.DateTimeFormat('en-CA', { timeZone: report.timeZone }).format(new Date(now)),
    tabs: [{ label: 'Savings', sections }],
    refresh: {
      cadence: 'weekly',
      method: [
        'Rebuild with `routine_report` and `dashboard: true`: it re-reads every run and files a new version of this dashboard.',
        '',
        '- **Time saved**: for each finished run, its automation’s by-hand baseline (minutes per run, on the approved version), less the time people spent answering that run’s decisions.',
        '- **Worth**: time saved at the workspace’s hourly rate (`defaults.hourlyRate`).',
        '- **Run cost** and **tokens**: every model call each run made, from the spend ledger.',
        '- **Decisions**: each time the expert answered a run (an escalation or a held step).',
        '- Weeks start on Monday in the workspace’s time zone; the last week is still running.',
      ].join('\n'),
    },
  });
}

/**
 * File the savings dashboard, or refresh the one already filed as a new version.
 * @param orgId - The workspace.
 * @param author - Who builds it.
 * @param opts - The clock, the weeks, and an artifact to refresh.
 * @param opts.now - The clock.
 * @param opts.weeks - Weeks in the trend.
 * @param opts.conversationId - The conversation it was asked from, when one.
 */
export async function fileSavingsDashboard(orgId: string, author: Author, opts: { now?: number; weeks?: number; conversationId?: number | null } = {}): Promise<{ artifactId: number; spec: DashboardSpec; created: boolean }> {
  const spec = await savingsDashboardSpec(orgId, opts);
  const { createArtifact, listArtifacts, updateArtifact } = await import('@/services/ArtifactService');
  const existing = (await listArtifacts({ orgId, kinds: ['dashboard'], folder: DASHBOARD_FOLDER, visibility: 'all', limit: 100 }))
    .find(a => a.title === SAVINGS_DASHBOARD_TITLE);
  if (existing) {
    await updateArtifact({ orgId, id: existing.id, spec, author, changeSummary: `Refreshed as of ${spec.asOf}` });
    return { artifactId: existing.id, spec, created: false };
  }
  const { artifact } = await createArtifact({ orgId, conversationId: opts.conversationId ?? null, kind: 'dashboard', title: SAVINGS_DASHBOARD_TITLE, spec, folder: DASHBOARD_FOLDER, author, changeSummary: 'What the automations saved' });
  return { artifactId: artifact.id, spec, created: true };
}
