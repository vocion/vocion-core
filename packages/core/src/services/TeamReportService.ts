/**
 * TeamReportService — who did what, at what cost, against which goal.
 *
 * Read-side aggregation over `worker_run` (the only per-run cost record in
 * the schema, ADR 0004) joined to the org chart (`team`, `agent`), for the
 * `/dashboard/team-report` surface. Every number here is derived at read time
 * from what workers reported; nothing is stored. Two facts the page must
 * always be able to state:
 *
 *   - WEIGHT — each team's and each member's share of the org's spend and
 *     tokens in the window, so "where does the money go" is one glance;
 *   - PROGRESS — each team's KPI readings (sum of a `worker_run.counts` key
 *     over its agents) against the target the workspace authored, read
 *     under the workspace's top-line goal (`project.goal`).
 *
 * Board reviews (`kind = board`) and red-team grades (`kind = red-team`) are
 * counted like any other run but carried separately in `byKind`, so the UI
 * badges judgement-over-the-work apart from the work itself.
 *
 * `agent_budget` (per agent per period) rides along as a secondary cost
 * source: it is what the budget caps enforce against, and on a deployment
 * where in-process agents charge it too, it can exceed the worker_run sum.
 *
 * Shape follows the Product Design Manifesto (`docs/MANIFESTO.md`): every
 * team and member carries an OUTCOME CONTRACT — purpose, owner, KPI with
 * baseline and target, permissions, autonomy, current performance — and the
 * activity numbers (runs, tokens, cents) are the evidence layer beneath it.
 * Spend weight is always reported next to outcome share, so "is this member
 * worth its share of the spend" is a question the page can answer.
 */

import type { TeamKpi } from '@/models/Schema';
import type { RiskTier, Rung } from '@/services/autonomy/rungs';
import type { AccountableUser } from '@/services/TeamService';
import type { WorkerRun } from '@/services/WorkerRunService';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentBudgetSchema, agentSchema, projectSchema, teamSchema, trustRuleSchema, workerRunSchema } from '@/models/Schema';
import { scoresByAgentAndKey, splitAgentKey } from '@/services/alignment/AlignmentService';
import { effectivePolicies } from '@/services/autonomy/AutonomyService';
import { DEFAULT_RUNG, defaultRiskTier, rungIndex } from '@/services/autonomy/rungs';
import { getWorkspaceLead, listTeams } from '@/services/TeamService';

export type ReportWindow = '24h' | '7d' | 'all';

export const REPORT_WINDOWS: readonly ReportWindow[] = ['24h', '7d', 'all'];

/**
 * Narrow a query-string window to one we know; anything else is `7d`.
 * @param raw - Whatever the URL carried.
 */
export function parseReportWindow(raw: unknown): ReportWindow {
  return typeof raw === 'string' && (REPORT_WINDOWS as readonly string[]).includes(raw) ? raw as ReportWindow : '7d';
}

/** Per-kind run counts — `board` and `red-team` are what the UI badges. */
export type KindCounts = Record<string, number>;

/** The kinds that are judgement about the work rather than the work: their spend is quality spend, not output. */
export const JUDGEMENT_KINDS: readonly string[] = ['board', 'red-team'];

export type ReportTotals = {
  runs: number;
  cents: number;
  tokens: number;
  /** Runs still `running` or `paused` right now. */
  active: number;
  /** Runs that ended `failed` or `lost`. */
  failed: number;
  byKind: KindCounts;
  /** Spend per kind — what `judgementCents` is read from. */
  centsByKind: Record<string, number>;
  /** Spend on board reviews and red-team grades: quality spend, not output. */
  judgementCents: number;
  lastActivity: Date | null;
};

export type KpiReading = TeamKpi & {
  /** The summed reading in the KPI's own window (not the page's). */
  value: number;
  /**
   * Progress from baseline to target, 0..1 (capped). With no baseline this
   * is value / target. The meter reads this; `met` is the uncapped truth.
   */
  progress: number;
  met: boolean;
};

/**
 * The manifesto's outcome contract, as far as the schema can state it today.
 * Fields the workspace has not authored are null — shown as "not set", never
 * invented. Escalation is not modeled yet; the UI points at the inbox.
 */
/** One action kind on the ladder, as the contract states it. */
export type AutonomyReading = {
  actionId: string;
  rung: Rung;
  riskTier: RiskTier;
  /** 30-day agreement between the recommendation and the person, or null with nothing decided. */
  agreementRate: number | null;
  /** Decided recommendations in the window. */
  n: number;
};

export type OutcomeContract = {
  /** Purpose — the team's `goal:` (falling back to its description) or the agent's description. */
  purpose: string | null;
  /** Owner — the accountable human, with provenance (team-set or inherited). */
  owner: AccountableUser | null;
  /** The KPI readings this contract is measured on. Empty = no measurement authored. */
  kpis: KpiReading[];
  /** Current performance: mean KPI progress 0..1, or null when nothing is measured. */
  attainment: number | null;
  /**
   * Autonomy — where each action kind this agent (or this team's agents) has
   * had decided stands on the ladder (`services/autonomy/rungs.ts`), with the
   * 30-day alignment behind it. Empty when nobody has decided anything of
   * theirs yet; the mission-level proxy this replaced said "Level 3" about a
   * goal, which is not what runs without a person.
   */
  autonomy: AutonomyReading[];
  /** Permissions — the agent's authored `approvalPolicy` keys; empty = every outward action waits for approval. */
  permissions: string[];
};

export type MemberReport = ReportTotals & {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  teamSlug: string | null;
  isLead: boolean;
  /** Share of the org's spend / tokens in the window, 0..1. */
  shareOfCents: number;
  shareOfTokens: number;
  /**
   * Share of the TEAM's KPI readings this member produced, 0..1 — the
   * outcome side of "spend weight vs outcome contribution". Null when the
   * team has no KPIs or nothing has been counted yet.
   */
  outcomeShare: number | null;
  /** The member's own contract: purpose, autonomy, permissions; owner inherited from its team. */
  contract: OutcomeContract;
  /** Models this member ran on, most-used first. */
  models: string[];
  /** The agent's live period budget, when one is configured. */
  budget: { period: string; currentCents: number; currentTokens: number; hardCentsLimit: number | null; softCentsLimit: number | null } | null;
};

export type TeamReportTeam = ReportTotals & {
  slug: string;
  name: string;
  description: string | null;
  goal: string | null;
  leadAgentSlug: string | null;
  /** The lead's accent, so the team colors like it does on the org chart. */
  accent: string | null;
  shareOfCents: number;
  shareOfTokens: number;
  /** The team's outcome contract — KPIs, owner, autonomy, permissions, attainment. */
  contract: OutcomeContract;
  /** Lead first, then by spend. */
  members: MemberReport[];
};

export type TeamReport = {
  window: ReportWindow;
  /** The workspace's top-line goal (`project.goal`), or null when none is stated. */
  goal: string | null;
  /** The workspace-default owner (workspace.yaml `accountableUser:`). */
  owner: AccountableUser | null;
  /** Mean attainment across teams that measure anything; null when none do. */
  attainment: number | null;
  /** How many actions may auto-execute under trust rules — the workspace's permission posture in one number. */
  autoExecuteActions: number;
  totals: ReportTotals;
  /** Teams by spend, highest first. */
  teams: TeamReportTeam[];
  /** Agents on no team — rendered, never dropped. */
  ungrouped: MemberReport[];
};

type AggRow = {
  agentSlug: string;
  kind: string;
  runs: number;
  cents: number;
  tokens: number;
  active: number;
  failed: number;
  lastActivity: Date | null;
};

type ModelRow = { agentSlug: string; model: string | null; runs: number };

type AgentRow = {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  teamSlug: string | null;
  approvalPolicy: Record<string, unknown> | null;
};

type TeamRow = typeof teamSchema.$inferSelect;
type BudgetRow = typeof agentBudgetSchema.$inferSelect;

/** The KPI sums the report needs: per team (`${teamSlug}/${key}`) and per agent (`${teamSlug}/${key}` → agent → value). */
export type KpiValues = {
  byTeam: Map<string, number>;
  byAgent: Map<string, Map<string, number>>;
};

/**
 * The lower bound of a window, or null for all time.
 * @param window - Report window.
 * @param now - The clock, injectable for tests.
 */
export function windowStart(window: ReportWindow, now: Date = new Date()): Date | null {
  if (window === '24h') {
    return new Date(now.getTime() - 24 * 3600 * 1000);
  }
  if (window === '7d') {
    return new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  }
  return null;
}

function emptyTotals(): ReportTotals {
  return { runs: 0, cents: 0, tokens: 0, active: 0, failed: 0, byKind: {}, centsByKind: {}, judgementCents: 0, lastActivity: null };
}

function addTotals(into: ReportTotals, row: AggRow): void {
  into.runs += row.runs;
  into.cents += row.cents;
  into.tokens += row.tokens;
  into.active += row.active;
  into.failed += row.failed;
  into.byKind[row.kind] = (into.byKind[row.kind] ?? 0) + row.runs;
  into.centsByKind[row.kind] = (into.centsByKind[row.kind] ?? 0) + row.cents;
  if (JUDGEMENT_KINDS.includes(row.kind)) {
    into.judgementCents += row.cents;
  }
  if (row.lastActivity && (!into.lastActivity || row.lastActivity > into.lastActivity)) {
    into.lastActivity = row.lastActivity;
  }
}

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * Progress from baseline to target, capped 0..1. No baseline = from zero.
 * @param kpi - The authored KPI.
 * @param value - The current reading.
 */
export function kpiProgress(kpi: TeamKpi, value: number): number {
  const base = kpi.baseline ?? 0;
  const span = kpi.target - base;
  if (span <= 0) {
    return value >= kpi.target ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (value - base) / span));
}

function meanOrNull(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Summarize an agent's `approvalPolicy` as the list of what it names. The
 * policy is a free-form record today, so the keys ARE the summary; an
 * empty record means the default — every outward action waits for a person.
 * @param policy - `agent.approval_policy`.
 */
export function permissionKeys(policy: Record<string, unknown> | null | undefined): string[] {
  return Object.keys(policy ?? {}).sort();
}

/**
 * Pure assembly of the report from already-loaded rows. Exported so the
 * weighting and KPI arithmetic unit-test without a database; `teamReport`
 * is the DB-backed wrapper.
 * @param input - Everything the report is built from.
 * @param input.window
 * @param input.goal
 * @param input.teams
 * @param input.agents
 * @param input.agg - One row per (agent, kind) in the window.
 * @param input.models - One row per (agent, model) in the window.
 * @param input.kpiValues - KPI sums per team and per agent.
 * @param input.budgets - Live period budgets, any period.
 * @param input.owners - Accountable human per team slug (resolved by TeamService) and the workspace default.
 * @param input.owners.byTeam
 * @param input.owners.workspace
 * @param input.autonomy - Per agent slug, the action kinds it has had decided, with rung and alignment.
 * @param input.autoExecuteActions - Enabled trust rules in the org.
 */
export function buildTeamReport(input: {
  window: ReportWindow;
  goal: string | null;
  teams: TeamRow[];
  agents: AgentRow[];
  agg: AggRow[];
  models: ModelRow[];
  kpiValues: KpiValues;
  budgets: BudgetRow[];
  owners: { byTeam: Map<string, AccountableUser | null>; workspace: AccountableUser | null };
  autonomy: Map<string, AutonomyReading[]>;
  autoExecuteActions: number;
}): TeamReport {
  const totals = emptyTotals();
  const perAgent = new Map<string, ReportTotals>();
  for (const row of input.agg) {
    addTotals(totals, row);
    const t = perAgent.get(row.agentSlug) ?? emptyTotals();
    addTotals(t, row);
    perAgent.set(row.agentSlug, t);
  }

  const modelsByAgent = new Map<string, string[]>();
  for (const m of [...input.models].sort((a, b) => b.runs - a.runs)) {
    if (!m.model) {
      continue;
    }
    modelsByAgent.set(m.agentSlug, [...(modelsByAgent.get(m.agentSlug) ?? []), m.model]);
  }

  // One budget row per agent: prefer daily (what most caps are set on).
  const budgetByAgent = new Map<string, BudgetRow>();
  for (const b of input.budgets) {
    const existing = budgetByAgent.get(b.agentSlug);
    if (!existing || (existing.period !== 'daily' && b.period === 'daily')) {
      budgetByAgent.set(b.agentSlug, b);
    }
  }

  const leadSlugs = new Set(input.teams.map(t => t.leadAgentSlug).filter((s): s is string => s !== null));
  const teamsBySlug = new Map(input.teams.map(t => [t.slug, t]));
  const member = (a: AgentRow): MemberReport => {
    const t = perAgent.get(a.slug) ?? emptyTotals();
    const b = budgetByAgent.get(a.slug);
    const team = a.teamSlug ? teamsBySlug.get(a.teamSlug) : undefined;
    // Outcome share: this member's part of the team's KPI readings — the
    // MEAN of its per-KPI shares, never a sum across KPIs. KPIs come in
    // different units (a count of PRs beside a 0–100 rate), and summing lets
    // the largest unit swallow the rest: one of three merged PRs read as
    // "<1%" next to a rate KPI. KPIs the team has not moved yet are skipped
    // rather than counted as a zero share.
    const kpiShares: number[] = [];
    for (const k of team?.kpis ?? []) {
      const id = `${team!.slug}/${k.key}`;
      const teamTotal = input.kpiValues.byTeam.get(id) ?? 0;
      if (teamTotal > 0) {
        kpiShares.push((input.kpiValues.byAgent.get(id)?.get(a.slug) ?? 0) / teamTotal);
      }
    }
    return {
      ...t,
      slug: a.slug,
      name: a.name,
      description: a.description,
      icon: a.icon,
      accent: a.accent,
      teamSlug: a.teamSlug,
      isLead: leadSlugs.has(a.slug),
      shareOfCents: share(t.cents, totals.cents),
      shareOfTokens: share(t.tokens, totals.tokens),
      outcomeShare: meanOrNull(kpiShares),
      contract: {
        purpose: a.description,
        owner: team ? input.owners.byTeam.get(team.slug) ?? null : input.owners.workspace,
        kpis: [],
        attainment: null,
        autonomy: input.autonomy.get(a.slug) ?? [],
        permissions: permissionKeys(a.approvalPolicy),
      },
      models: modelsByAgent.get(a.slug) ?? [],
      budget: b
        ? { period: b.period, currentCents: Number(b.currentCents ?? 0), currentTokens: Number(b.currentTokens ?? 0), hardCentsLimit: b.hardCentsLimit === null ? null : Number(b.hardCentsLimit), softCentsLimit: b.softCentsLimit === null ? null : Number(b.softCentsLimit) }
        : null,
    };
  };

  const agentsBySlug = new Map(input.agents.map(a => [a.slug, a]));
  const bySpend = (x: MemberReport, y: MemberReport) => Number(y.isLead) - Number(x.isLead) || y.cents - x.cents || x.name.localeCompare(y.name);

  const teams: TeamReportTeam[] = input.teams.map((team) => {
    const members = input.agents.filter(a => a.teamSlug === team.slug).map(member).sort(bySpend);
    const t = emptyTotals();
    for (const m of members) {
      // Re-add from the agg rows so byKind stays per kind, not per member.
      for (const row of input.agg.filter(r => r.agentSlug === m.slug)) {
        addTotals(t, row);
      }
    }
    const kpis: KpiReading[] = (team.kpis ?? []).map((k) => {
      const value = input.kpiValues.byTeam.get(`${team.slug}/${k.key}`) ?? 0;
      return { ...k, value, progress: kpiProgress(k, value), met: value >= k.target };
    });
    return {
      ...t,
      slug: team.slug,
      name: team.name,
      description: team.description,
      goal: team.goal ?? null,
      leadAgentSlug: team.leadAgentSlug,
      accent: team.leadAgentSlug ? agentsBySlug.get(team.leadAgentSlug)?.accent ?? null : null,
      shareOfCents: share(t.cents, totals.cents),
      shareOfTokens: share(t.tokens, totals.tokens),
      contract: {
        purpose: team.goal ?? team.description ?? null,
        owner: input.owners.byTeam.get(team.slug) ?? null,
        kpis,
        attainment: meanOrNull(kpis.map(k => k.progress)),
        autonomy: mergeAutonomy(members.map(m => m.contract.autonomy)),
        // The team's permissions are the union of what its members name.
        permissions: [...new Set(members.flatMap(m => m.contract.permissions))].sort(),
      },
      members,
    };
  }).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const teamSlugs = new Set(input.teams.map(t => t.slug));
  const ungrouped = input.agents
    .filter(a => a.teamSlug === null || !teamSlugs.has(a.teamSlug))
    .map(member)
    .sort(bySpend);

  return {
    window: input.window,
    goal: input.goal,
    owner: input.owners.workspace,
    attainment: meanOrNull(teams.map(t => t.contract.attainment).filter((a): a is number => a !== null)),
    autoExecuteActions: input.autoExecuteActions,
    totals,
    teams,
    ungrouped,
  };
}

/**
 * The full report for an org in a window. One pass over `worker_run` for
 * the (agent, kind) aggregate, one for models, one per distinct KPI
 * (key, window) pair, plus the org chart and budgets — all in parallel.
 * @param orgId - Tenant.
 * @param window - Report window; KPIs read their own authored window regardless.
 * @param now - The clock, injectable for tests.
 */
export async function teamReport(orgId: string, window: ReportWindow = '7d', now: Date = new Date()): Promise<TeamReport> {
  const since = windowStart(window, now);
  const runWhere = and(eq(workerRunSchema.orgId, orgId), since ? gte(workerRunSchema.createdAt, since) : undefined);

  const [project, teams, agents, agg, models, budgets, teamViews, workspaceLead, autonomy, trustRules] = await Promise.all([
    db.select({ goal: projectSchema.goal }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1),
    db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId)),
    db.select({
      slug: agentSchema.slug,
      name: agentSchema.name,
      description: agentSchema.description,
      icon: agentSchema.icon,
      accent: agentSchema.accent,
      teamSlug: agentSchema.teamSlug,
      approvalPolicy: agentSchema.approvalPolicy,
    }).from(agentSchema).where(eq(agentSchema.orgId, orgId)),
    db.select({
      agentSlug: workerRunSchema.agentSlug,
      kind: workerRunSchema.kind,
      runs: sql<number>`count(*)::int`,
      cents: sql<number>`coalesce(sum(${workerRunSchema.cents}), 0)::int`,
      tokens: sql<number>`coalesce(sum(${workerRunSchema.tokens}), 0)::int`,
      active: sql<number>`count(*) filter (where ${workerRunSchema.status} in ('running', 'paused'))::int`,
      failed: sql<number>`count(*) filter (where ${workerRunSchema.status} in ('failed', 'lost'))::int`,
      lastActivity: sql<Date | null>`max(${workerRunSchema.createdAt})`,
    }).from(workerRunSchema).where(runWhere).groupBy(workerRunSchema.agentSlug, workerRunSchema.kind),
    db.select({
      agentSlug: workerRunSchema.agentSlug,
      model: workerRunSchema.model,
      runs: sql<number>`count(*)::int`,
    }).from(workerRunSchema).where(runWhere).groupBy(workerRunSchema.agentSlug, workerRunSchema.model),
    db.select().from(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, orgId)),
    // Owners come from TeamService so the inheritance rule (team-set vs
    // workspace default) is resolved in exactly one place.
    listTeams(orgId),
    getWorkspaceLead(orgId),
    readAutonomy(orgId, now),
    db.select({ n: sql<number>`count(*)::int` }).from(trustRuleSchema).where(and(eq(trustRuleSchema.orgId, orgId), eq(trustRuleSchema.enabled, 'true'))),
  ]);

  const kpiValues = await readKpiValues(orgId, teams, agents, now);

  return buildTeamReport({
    window,
    goal: project[0]?.goal ?? null,
    teams,
    agents,
    agg: agg.map(r => ({ ...r, lastActivity: r.lastActivity ? new Date(r.lastActivity) : null })),
    models,
    kpiValues,
    budgets,
    owners: { byTeam: new Map(teamViews.map(v => [v.slug, v.accountable])), workspace: workspaceLead.accountable },
    autonomy,
    autoExecuteActions: Number(trustRules[0]?.n ?? 0),
  });
}

/**
 * Per agent, the action kinds a person has decided in the last 30 days, each
 * with the org's rung for that kind and the agent's own agreement rate. One
 * ledger scan plus the policy rows — the same numbers `/dashboard/autonomy`
 * shows, cut per member.
 * @param orgId
 * @param now
 */
async function readAutonomy(orgId: string, now: Date): Promise<Map<string, AutonomyReading[]>> {
  const [scores, policies] = await Promise.all([
    scoresByAgentAndKey(orgId, '30d', now, 'action'),
    effectivePolicies(orgId),
  ]);
  const byAgent = new Map<string, AutonomyReading[]>();
  for (const [key, score] of scores) {
    const [agentSlug, actionId] = splitAgentKey(key);
    if (!agentSlug || !actionId) {
      continue;
    }
    const policy = policies.get(actionId) ?? { rung: DEFAULT_RUNG, riskTier: defaultRiskTier(actionId) };
    const list = byAgent.get(agentSlug) ?? [];
    list.push({ actionId, rung: policy.rung, riskTier: policy.riskTier, agreementRate: score.agreementRate, n: score.n });
    byAgent.set(agentSlug, list);
  }
  for (const list of byAgent.values()) {
    list.sort((a, b) => rungIndex(b.rung) - rungIndex(a.rung) || b.n - a.n || a.actionId.localeCompare(b.actionId));
  }
  return byAgent;
}

/**
 * A team's autonomy is the union of its members' — per action kind, the rung
 * (the same for every member, it is per org) and the pooled agreement.
 * @param members
 */
export function mergeAutonomy(members: AutonomyReading[][]): AutonomyReading[] {
  const byAction = new Map<string, AutonomyReading & { agreed: number }>();
  for (const reading of members.flat()) {
    const agreed = reading.agreementRate === null ? 0 : reading.agreementRate * reading.n;
    const cur = byAction.get(reading.actionId);
    if (!cur) {
      byAction.set(reading.actionId, { ...reading, agreed });
      continue;
    }
    cur.n += reading.n;
    cur.agreed += agreed;
    cur.agreementRate = cur.n > 0 ? cur.agreed / cur.n : null;
  }
  return [...byAction.values()]
    .map(({ agreed: _agreed, ...r }) => r)
    .sort((a, b) => rungIndex(b.rung) - rungIndex(a.rung) || b.n - a.n || a.actionId.localeCompare(b.actionId));
}

/**
 * Sum each team KPI's `counts.<key>` over the team's agents in the KPI's
 * own window. One query per distinct (key, window) so a workspace with
 * twenty KPIs on the same key costs one scan, not twenty.
 * @param orgId
 * @param teams
 * @param agents
 * @param now
 */
async function readKpiValues(orgId: string, teams: TeamRow[], agents: AgentRow[], now: Date): Promise<KpiValues> {
  const wanted = new Map<string, { key: string; window: ReportWindow }>();
  for (const team of teams) {
    for (const k of team.kpis ?? []) {
      const key = k.source.replace(/^counts\./, '');
      wanted.set(`${key}@${k.window ?? 'all'}`, { key, window: k.window ?? 'all' });
    }
  }
  const perAgent = new Map<string, Map<string, number>>(); // `${key}@${window}` → agentSlug → sum
  await Promise.all([...wanted.entries()].map(async ([id, { key, window }]) => {
    const since = windowStart(window, now);
    const rows = await db.select({
      agentSlug: workerRunSchema.agentSlug,
      total: sql<number>`coalesce(sum((${workerRunSchema.counts} ->> ${key})::numeric), 0)::float`,
    })
      .from(workerRunSchema)
      .where(and(
        eq(workerRunSchema.orgId, orgId),
        since ? gte(workerRunSchema.createdAt, since) : undefined,
        sql`${workerRunSchema.counts} ? ${key}`,
      ))
      .groupBy(workerRunSchema.agentSlug);
    perAgent.set(id, new Map(rows.map(r => [r.agentSlug, Number(r.total)])));
  }));

  const out: KpiValues = { byTeam: new Map(), byAgent: new Map() };
  for (const team of teams) {
    const memberSlugs = agents.filter(a => a.teamSlug === team.slug).map(a => a.slug);
    for (const k of team.kpis ?? []) {
      const key = k.source.replace(/^counts\./, '');
      const byAgent = perAgent.get(`${key}@${k.window ?? 'all'}`);
      const id = `${team.slug}/${k.key}`;
      const mine = new Map(memberSlugs.map(s => [s, byAgent?.get(s) ?? 0] as const));
      out.byAgent.set(id, mine);
      out.byTeam.set(id, [...mine.values()].reduce((a, b) => a + b, 0));
    }
  }
  return out;
}

export type MemberDetail = {
  member: MemberReport;
  team: { slug: string; name: string; goal: string | null } | null;
  /** Newest first. */
  runs: WorkerRun[];
  /** Every `counts` key summed over the listed runs — what this member reports about its work. */
  counts: Record<string, number>;
};

/**
 * One member's page: its row from the report plus its runs, newest first.
 * @param orgId - Tenant.
 * @param agentSlug - The member.
 * @param opts - Window and paging.
 * @param opts.window
 * @param opts.limit
 */
export async function memberReport(orgId: string, agentSlug: string, opts: { window?: ReportWindow; limit?: number } = {}): Promise<MemberDetail | null> {
  const window = opts.window ?? '7d';
  const report = await teamReport(orgId, window);
  const fromTeam = report.teams.flatMap(t => t.members.map(m => ({ m, t }))).find(x => x.m.slug === agentSlug);
  const member = fromTeam?.m ?? report.ungrouped.find(m => m.slug === agentSlug) ?? null;
  if (!member) {
    return null;
  }
  const since = windowStart(window);
  const runs = await db.select().from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.agentSlug, agentSlug), since ? gte(workerRunSchema.createdAt, since) : undefined)).orderBy(desc(workerRunSchema.createdAt)).limit(opts.limit ?? 100);
  const counts: Record<string, number> = {};
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.counts ?? {})) {
      if (typeof v === 'number') {
        counts[k] = (counts[k] ?? 0) + v;
      }
    }
  }
  return {
    member,
    team: fromTeam ? { slug: fromTeam.t.slug, name: fromTeam.t.name, goal: fromTeam.t.goal } : null,
    runs,
    counts,
  };
}
