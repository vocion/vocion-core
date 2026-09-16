/**
 * Daily team report — the data half.
 *
 * `collectDailyTeamReport(orgId, window)` reads what the workforce did in a
 * window and what is waiting on a person, and returns a plain
 * `DailyTeamReportData` that `renderDailyTeamReport()` turns into mail.
 * `shapeDailyTeamReport()` is the pure aggregation over already-fetched rows
 * and is what the unit test exercises.
 *
 * Sources, in the order the report reads them:
 *   - `worker_run` — the only per-run token/cost record (ADR 0004). Grouped
 *     agent → team via `agent.team_slug`. `kind` (board / lead / worker /
 *     red-team …) is read DEFENSIVELY: the column lands in a sibling PR, so
 *     this query checks `information_schema` first and reports `kind` as
 *     `null` on a database that does not have it yet.
 *   - `agent_budget` — the current period's spend per agent, as the second
 *     opinion on cost (it covers in-app turns `worker_run` never sees).
 *   - the "needs you" counts: pending `action_run`, runs `awaiting_review` or
 *     `paused` (mission / workflow / worker), pending `learning_candidate`,
 *     and open rows of an `ask` table if one exists (same sibling-PR guard).
 *   - the latest workspace-rollup `briefing` (team_slug NULL).
 *
 * Performance — goal attainment per team, human load, cost per outcome,
 * what needs attention — comes from `TeamReportService.teamReport` over the
 * same window, so the mail and the page say the same thing
 * (docs/specs/team-report-v2.md). A failure there is logged and the mail
 * goes out without the section rather than not at all.
 */

import type { DailyTeamReportData, NeedsYou, PerformanceSummary, ReportWindow, WorkerRunRow } from './dailyTeamReportShape';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import {
  actionRunSchema,
  agentBudgetSchema,
  agentSchema,
  briefingSchema,
  learningCandidateSchema,
  missionRunSchema,
  projectSchema,
  teamSchema,
  userSchema,
  workerRunSchema,
  workflowRunSchema,
} from '@/models/Schema';
import { briefingHref, parseStoredDocument } from '@/services/briefings/store';
import { teamReport } from '@/services/TeamReportService';
import { DAILY_TEAM_REPORT_PUBLISHER, shapeDailyTeamReport } from './dailyTeamReportShape';

export { DAILY_TEAM_REPORT_PUBLISHER, shapeDailyTeamReport } from './dailyTeamReportShape';
export type { AgentRow, BudgetRow, DailyTeamReportData, MemberStats, NeedsYou, PerformanceSummary, ReportWindow, TeamPerformance, TeamRow, TeamStats, WorkerRunRow } from './dailyTeamReportShape';

/**
 * The performance summary, from the same read model as the page. The mail
 * is a daily, so the activity window is 24h; each measure reads its own
 * authored window regardless.
 * @param orgId - Project id.
 * @param until - The clock the report is read at.
 */
async function fetchPerformance(orgId: string, until: Date): Promise<PerformanceSummary | undefined> {
  try {
    const r = await teamReport(orgId, '24h', until);
    return {
      goal: r.goal,
      setupNeeded: r.setup.needed,
      teamsOnTarget: r.headline.teamsOnTarget,
      goalProgress: r.headline.goalProgress?.progress ?? null,
      humanReviewMs: r.headline.humanReviewMs,
      autoCompletedRate: r.headline.autoCompletedRate,
      needsAttention: r.headline.needsAttention,
      teams: r.teams.map(t => ({
        slug: t.slug,
        name: t.name,
        mission: t.mission,
        primary: t.primary
          ? {
              label: t.primary.measure.label,
              value: t.primary.value,
              target: t.primary.measure.target,
              unit: t.primary.measure.unit,
              attainment: t.primary.attainment,
              met: t.primary.met,
              provenance: t.primary.provenance,
              trend: t.primary.trend,
              delta: t.primary.delta,
              window: t.primary.measure.window,
            }
          : null,
        humanLoad: { interventions: t.humanLoad.interventions, reviewMs: t.humanLoad.decisionLatencyMs, interventionRate: t.humanLoad.interventionRate, autonomousCompletionRate: t.humanLoad.autonomousCompletionRate },
        cents: t.cents,
        costPerOutcomeCents: t.economics.costPerOutcomeCents,
        needsYou: t.needsYou.count,
      })),
    };
  } catch (err) {
    console.warn('[daily-team-report] could not read team performance; mailing without it', err);
    return undefined;
  }
}

/**
 * Does `table.column` exist? Cheap `information_schema` probe, one round trip.
 * @param table
 * @param column
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const res: any = await db.execute(sql`select 1 as ok from information_schema.columns where table_name = ${table} and column_name = ${column} limit 1`);
  const rows = (res.rows ?? res) as unknown[];
  return rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const res: any = await db.execute(sql`select 1 as ok from information_schema.tables where table_name = ${table} limit 1`);
  const rows = (res.rows ?? res) as unknown[];
  return rows.length > 0;
}

async function fetchWorkerRuns(orgId: string, window: ReportWindow): Promise<WorkerRunRow[]> {
  const hasKind = await columnExists('worker_run', 'kind');
  // Bind the window as UTC ISO text, not a JS Date: node-postgres serialises a
  // Date with the host's offset and `timestamp without time zone` drops it,
  // which shifted the window by the host's UTC offset (0 runs matched on a PDT
  // host against a UTC database). Drizzle's own query builder writes UTC text
  // on insert, so this is what the column actually holds.
  const res: any = await db.execute(sql`
    select agent_slug, status, ${hasKind ? sql`kind` : sql`null::text`} as kind, tokens, cents, created_at
    from worker_run
    where org_id = ${orgId}
      and created_at >= ${window.since.toISOString()}::timestamp
      and created_at < ${window.until.toISOString()}::timestamp
  `);
  const rows = (res.rows ?? res) as { agent_slug: string; status: string; kind: string | null; tokens: number | string; cents: number | string; created_at: Date | string }[];
  return rows.map(r => ({
    agentSlug: r.agent_slug,
    status: r.status,
    kind: r.kind,
    tokens: Number(r.tokens ?? 0),
    cents: Number(r.cents ?? 0),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/**
 * Everything waiting on a person, counted.
 * @param orgId - Project id.
 */
async function fetchNeedsYou(orgId: string): Promise<NeedsYou> {
  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const attention = ['awaiting_review', 'paused'];
  const [pendingActions, missionAttention, workflowAttention, workerAttention, pendingLearningCandidates] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)` }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending')))),
    db.select({ status: missionRunSchema.status, n: sql<number>`count(*)` }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.status, attention))).groupBy(missionRunSchema.status),
    db.select({ status: workflowRunSchema.status, n: sql<number>`count(*)` }).from(workflowRunSchema).where(and(eq(workflowRunSchema.orgId, orgId), inArray(workflowRunSchema.status, attention))).groupBy(workflowRunSchema.status),
    db.select({ status: workerRunSchema.status, n: sql<number>`count(*)` }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, attention))).groupBy(workerRunSchema.status),
    count(db.select({ n: sql<number>`count(*)` }).from(learningCandidateSchema).where(and(eq(learningCandidateSchema.orgId, orgId), eq(learningCandidateSchema.status, 'pending')))),
  ]);
  const sum = (status: string) => [...missionAttention, ...workflowAttention, ...workerAttention].filter(r => r.status === status).reduce((n, r) => n + Number(r.n), 0);
  const runsAwaitingReview = sum('awaiting_review');
  const runsPaused = sum('paused');

  let openAsks: number | null = null;
  if (await tableExists('ask')) {
    const res: any = await db.execute(sql`select count(*)::int as n from ask where org_id = ${orgId} and status = 'open'`);
    const rows = (res.rows ?? res) as { n: number }[];
    openAsks = Number(rows[0]?.n ?? 0);
  }

  return {
    pendingActions,
    runsAwaitingReview,
    runsPaused,
    pendingLearningCandidates,
    openAsks,
    total: pendingActions + runsAwaitingReview + runsPaused + pendingLearningCandidates + (openAsks ?? 0),
  };
}

/**
 * The briefing the mail carries. With a selector: the latest briefing for that
 * team and/or agent, marked `full`. Without one, or when nothing matches: the
 * latest workspace rollup (team_slug NULL), excerpted by the renderer. Either
 * way, never a previous copy of this very report.
 * @param orgId - Project id.
 * @param until - Upper bound on `created_at`.
 * @param selector - Team and/or agent slug to match.
 */
async function fetchBriefing(orgId: string, until: Date, selector?: BriefingSelector): Promise<DailyTeamReportData['rollup']> {
  const notOurs = sql`${briefingSchema.agentSlug} is distinct from ${DAILY_TEAM_REPORT_PUBLISHER}`;
  const cols = { id: briefingSchema.id, title: briefingSchema.title, content: briefingSchema.content, createdAt: briefingSchema.createdAt, document: briefingSchema.document };
  if (selector && (selector.teamSlug || selector.agentSlug)) {
    const [row] = await db
      .select(cols)
      .from(briefingSchema)
      .where(and(
        eq(briefingSchema.orgId, orgId),
        lt(briefingSchema.createdAt, until),
        notOurs,
        selector.teamSlug ? eq(briefingSchema.teamSlug, selector.teamSlug) : undefined,
        selector.agentSlug ? eq(briefingSchema.agentSlug, selector.agentSlug) : undefined,
      ))
      .orderBy(desc(briefingSchema.createdAt))
      .limit(1);
    if (row) {
      return { ...row, document: parseStoredDocument(row.document), href: briefingHref(row.id), full: true, label: selector.teamSlug ? `${selector.teamSlug} briefing` : `${selector.agentSlug} briefing` };
    }
  }
  const [row] = await db
    .select(cols)
    .from(briefingSchema)
    .where(and(eq(briefingSchema.orgId, orgId), isNull(briefingSchema.teamSlug), lt(briefingSchema.createdAt, until), notOurs))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(1);
  return row ? { ...row, document: parseStoredDocument(row.document), href: briefingHref(row.id), full: false, label: 'workspace briefing' } : null;
}

/** Which briefing the mail should carry instead of the workspace rollup. */
export type BriefingSelector = { teamSlug?: string; agentSlug?: string };

/**
 * Read everything the report needs for one org and one window.
 * @param orgId - Project id.
 * @param window - Defaults to the trailing 24 hours ending now.
 * @param opts - `briefing`: carry the latest briefing matching this team and/or
 * agent, in full, with its title as the subject — the revenue workspace mails
 * its `revops` "Revenue Briefing" this way. Falls back to the rollup when no
 * such briefing exists.
 * @param opts.briefing - Team and/or agent slug to match.
 */
export async function collectDailyTeamReport(orgId: string, window?: Partial<ReportWindow>, opts: { briefing?: BriefingSelector } = {}): Promise<DailyTeamReportData> {
  const until = window?.until ?? new Date();
  const since = window?.since ?? new Date(until.getTime() - 24 * 60 * 60 * 1000);
  const w: ReportWindow = { since, until };

  const [project] = await db
    .select({ id: projectSchema.id, name: projectSchema.name, slug: projectSchema.slug, accountableUserId: projectSchema.accountableUserId })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    throw new Error(`daily-team-report: no project with id "${orgId}"`);
  }
  let accountableEmail: string | null = null;
  if (project.accountableUserId) {
    const [u] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, project.accountableUserId)).limit(1);
    accountableEmail = u?.email ?? null;
  }

  const [agents, teams, budgets, runs, needsYou, rollupRows, performance] = await Promise.all([
    db.select({ slug: agentSchema.slug, name: agentSchema.name, teamSlug: agentSchema.teamSlug, active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.orgId, orgId)),
    db.select({ slug: teamSchema.slug, name: teamSchema.name, leadAgentSlug: teamSchema.leadAgentSlug }).from(teamSchema).where(eq(teamSchema.orgId, orgId)),
    db.select({ agentSlug: agentBudgetSchema.agentSlug, period: agentBudgetSchema.period, currentCents: agentBudgetSchema.currentCents, currentTokens: agentBudgetSchema.currentTokens, hardCentsLimit: agentBudgetSchema.hardCentsLimit })
      .from(agentBudgetSchema)
      .where(eq(agentBudgetSchema.orgId, orgId)),
    fetchWorkerRuns(orgId, w),
    fetchNeedsYou(orgId),
    fetchBriefing(orgId, until, opts.briefing),
    fetchPerformance(orgId, until),
  ]);
  const rollup = rollupRows;

  const shaped = shapeDailyTeamReport({
    runs,
    agents: agents.map(a => ({ slug: a.slug, name: a.name, teamSlug: a.teamSlug ?? null, active: String(a.active ?? 'true') !== 'false' })),
    teams: teams.map(t => ({ slug: t.slug, name: t.name, leadAgentSlug: t.leadAgentSlug ?? null })),
    budgets: budgets.map(b => ({ agentSlug: b.agentSlug, period: b.period, currentCents: Number(b.currentCents ?? 0), currentTokens: Number(b.currentTokens ?? 0), hardCentsLimit: b.hardCentsLimit === null ? null : Number(b.hardCentsLimit) })),
  });

  // Workspace-aware links (libs/links.ts): the mail is about THIS project, so
  // its links must open this project — not whichever one the reader's browser
  // last had active.
  const link = (path: string) => workspaceUrl(project.slug, path, { absolute: true });
  return {
    workspace: { id: project.id, name: project.name, slug: project.slug, accountableEmail },
    window: w,
    ...shaped,
    ...(performance ? { performance } : {}),
    needsYou,
    rollup,
    links: { inbox: link('/dashboard/inbox'), teamReport: link('/dashboard/team-report'), briefings: link('/dashboard/briefings') },
    generatedAt: new Date(),
  };
}
