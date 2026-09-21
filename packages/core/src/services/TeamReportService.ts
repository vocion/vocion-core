/**
 * TeamReportService — is the AI workforce earning its keep, can it be
 * trusted, and exactly why do we believe that.
 *
 * The read model behind `/dashboard/team-report` and the daily mail, built
 * to docs/specs/team-report-v2.md. Every team DECLARES a mission and
 * measures (`teams/<slug>.yaml`); Vocion READS each measure from where its
 * source says the truth lives (`services/team-report/provenance.ts`) and
 * DERIVES the rest (`derive.ts`, `humanLoad.ts`):
 *
 *   goal attainment · trend vs the prior window · cost per outcome ·
 *   quality rate · human interventions · decision latency · intervention
 *   rate · autonomous completion rate · escalation rate · blocked time ·
 *   budget variance
 *
 * Nothing derived is stored. Every reading carries its provenance, so the
 * page can never show a number without saying where it came from, and an
 * agent-reported count is visibly the weakest kind.
 *
 * Activity — runs, tokens, spend by member — is the evidence layer beneath
 * the contract. Board reviews (`kind = board`) and red-team grades
 * (`kind = red-team`) are counted like any other run but carried separately
 * in `byKind`, so judgement over the work is never mistaken for output.
 *
 * `buildTeamReport` is the pure assembly over already-loaded rows;
 * `teamReport` is the DB-backed wrapper.
 */

import type { EffectivePolicy } from '@/services/autonomy/AutonomyService';
import type { RiskTier, Rung } from '@/services/autonomy/rungs';
import type { HumanLoad, MeasureReading, OutcomeChain, SetupState } from '@/services/team-report';
import type { AccountableUser } from '@/services/TeamService';
import type { WorkerRun } from '@/services/WorkerRunService';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { effectiveMeasures } from '@/libs/workspace/team-export';
import { actionRunSchema, agentBudgetSchema, agentSchema, projectSchema, teamSchema, trustRuleSchema, workerRunSchema } from '@/models/Schema';
import { scoresByAgentAndKey, splitAgentKey } from '@/services/alignment/AlignmentService';
import { effectivePolicies } from '@/services/autonomy/AutonomyService';
import { DEFAULT_RUNG, defaultRiskTier, rungAutomates, rungIndex } from '@/services/autonomy/rungs';
import { agentScopedOnly } from '@/services/BudgetService';
import { budgetVariance, costPerOutcomeCents, deriveHumanLoad, detectSetupState, emptyHumanLoadCounts, goalProgress, measureRange, primaryOutcome, readHumanLoad, readOutcomeChains, readTeamMeasures, sumHumanLoadCounts, teamsOnTarget } from '@/services/team-report';
import { getWorkspaceLead, listTeams } from '@/services/TeamService';

export type ReportWindow = '24h' | '7d' | '30d';

export const REPORT_WINDOWS: readonly ReportWindow[] = ['24h', '7d', '30d'];

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

/**
 * The manifesto's outcome contract, as far as the workspace states it.
 * Fields the workspace has not authored are null — shown as "not set", never
 * invented.
 */
export type OutcomeContract = {
  /** Mission — the team's `goal:` (falling back to its description) or the agent's description. */
  purpose: string | null;
  /** Accountable owner — the human, with provenance (team-set or inherited). */
  owner: AccountableUser | null;
  /** Every declared measure, read. Empty = nothing measured. */
  measures: MeasureReading[];
  /** Mean attainment across readable measures, 0..1, or null when nothing is measured. */
  attainment: number | null;
  /** Where each action kind the team's agents have had decided stands on the ladder, with the 30-day alignment. */
  autonomy: AutonomyReading[];
  /** The agents' authored `approvalPolicy` keys; empty = every outward action waits for approval. */
  permissions: string[];
};

/** "Human approval required · 5 action types · 0 auto-execute" — autonomy and permissions collapsed into one line (spec §7). */
export type ControlSummary = {
  /** Distinct action kinds this team's agents have proposed or are permitted. */
  actionTypes: number;
  /** …of which may run without a person. */
  autoExecute: number;
  approvalRequired: boolean;
  /** The highest rung any of the team's kinds stands on. */
  topRung: Rung | null;
};

export type NeedsYouSummary = {
  count: number;
  oldestAt: Date | null;
  /** The inbox, filtered to this team's agents (`?agents=`). */
  href: string;
};

export type DimensionReading = {
  /** The declared measure of this dimension, when the team authored one. */
  measure: MeasureReading | null;
};

export type QualityReading = DimensionReading & {
  /** Approved without an edit / decided — derived when no measure is declared. */
  rate: number | null;
  decided: number;
};

export type VelocityReading = DimensionReading & {
  /** Median created → finished over the window's work, ms. */
  medianMs: number | null;
};

export type EconomicsReading = DimensionReading & {
  /** Operating cost in the page's window. */
  cents: number;
  /** Operating cost over the PRIMARY MEASURE's window — the numerator of cost per outcome. */
  primaryWindowCents: number | null;
  /** primaryWindowCents / primary outcome value; null when nothing was produced or nothing spent. */
  costPerOutcomeCents: number | null;
  budget: { spentCents: number; limitCents: number | null; variance: number | null };
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
  /** The team's `goal:`, falling back to its description. */
  mission: string | null;
  leadAgentSlug: string | null;
  /** The lead's accent, so the team colors like it does on the org chart. */
  accent: string | null;
  shareOfCents: number;
  shareOfTokens: number;
  contract: OutcomeContract;
  /** The measure that leads the section: the first outcome-dimension measure. */
  primary: MeasureReading | null;
  quality: QualityReading;
  velocity: VelocityReading;
  economics: EconomicsReading;
  humanLoad: HumanLoad;
  control: ControlSummary;
  needsYou: NeedsYouSummary;
  /** Evidence — the work behind the numbers, with a chain per completed outcome where the record allows. */
  evidence: { workItems: number; completed: number; chains: OutcomeChain[] };
  /** Lead first, then by spend. */
  members: MemberReport[];
};

export type Headline = {
  teamsOnTarget: { onTarget: number; measured: number };
  /** Normalized goal progress (spec §3) — null unless measures declare a weighted contribution. */
  goalProgress: { progress: number; measures: number } | null;
  /** AI operating cost in the window. */
  cents: number;
  /** Decision latency summed over every decided item, ms. */
  humanReviewMs: number;
  /** Work items that needed nobody / work items. */
  autoCompletedRate: number | null;
  /** Items waiting on a person right now. */
  needsAttention: number;
  needsAttentionOldestAt: Date | null;
};

export type TeamReport = {
  window: ReportWindow;
  range: { since: Date; until: Date };
  workspace: { name: string; goal: string | null; owner: AccountableUser | null };
  /** The workspace's top-line goal (`project.goal`), or null when none is stated. */
  goal: string | null;
  /** The workspace-default owner (workspace.yaml `accountableUser:`). */
  owner: AccountableUser | null;
  setup: SetupState;
  headline: Headline;
  /** Mean attainment across teams that measure anything; null when none do. */
  attainment: number | null;
  /** How many action kinds may auto-execute under trust rules — the workspace's permission posture in one number. */
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

const HOUR = 3_600_000;

/**
 * The lower bound of a window.
 * @param window - Report window.
 * @param now - The clock, injectable for tests.
 */
export function windowStart(window: ReportWindow, now: Date = new Date()): Date {
  const hours = window === '24h' ? 24 : window === '7d' ? 7 * 24 : 30 * 24;
  return new Date(now.getTime() - hours * HOUR);
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
 * The inbox filtered to a team. `?agents=<comma-separated slugs>` is what the
 * one-decision surface parses (R10, #348) — verified against its `Params` and
 * `InboxQuery.agents`, which survived Review folding into the review queue.
 * @param agentSlugs
 */
export function inboxHrefFor(agentSlugs: string[]): string {
  return agentSlugs.length > 0 ? `/dashboard/inbox?agents=${encodeURIComponent(agentSlugs.join(','))}` : '/dashboard/inbox';
}

/**
 * Control in one line: how many action kinds, how many run without a
 * person. Kinds come from what the agents have proposed (the autonomy
 * readings) and what their policies name.
 * @param autonomy - The team's merged autonomy readings.
 * @param permissions - The team's authored permission keys.
 * @param policies - The org's effective policy per action id.
 */
export function controlSummary(autonomy: AutonomyReading[], permissions: string[], policies: Map<string, EffectivePolicy>): ControlSummary {
  const kinds = new Set<string>([...autonomy.map(a => a.actionId), ...permissions]);
  let autoExecute = 0;
  let topRung: Rung | null = null;
  for (const id of kinds) {
    const rung = policies.get(id)?.rung ?? autonomy.find(a => a.actionId === id)?.rung ?? DEFAULT_RUNG;
    if (rungAutomates(rung)) {
      autoExecute += 1;
    }
    if (!topRung || rungIndex(rung) > rungIndex(topRung)) {
      topRung = rung;
    }
  }
  return { actionTypes: kinds.size, autoExecute, approvalRequired: kinds.size === 0 || autoExecute < kinds.size, topRung };
}

/**
 * Pure assembly of the report from already-loaded rows. Exported so the
 * arithmetic unit-tests without a database; `teamReport` is the DB-backed
 * wrapper.
 * @param input - Everything the report is built from.
 * @param input.window
 * @param input.range
 * @param input.range.since
 * @param input.range.until
 * @param input.workspaceName
 * @param input.goal
 * @param input.teams
 * @param input.agents
 * @param input.agg - One row per (agent, kind) in the window.
 * @param input.models - One row per (agent, model) in the window.
 * @param input.measures - Every measure reading, keyed `${teamSlug}/${key}`.
 * @param input.humanLoad - Per team slug (and `null` for unattributed work).
 * @param input.primaryCents - Per team slug, operating cents over its primary measure's window (falls back to the page window).
 * @param input.chains - Evidence chains per team slug.
 * @param input.budgets - Live period budgets, any period.
 * @param input.owners - Accountable human per team slug (resolved by TeamService) and the workspace default.
 * @param input.owners.byTeam
 * @param input.owners.workspace
 * @param input.autonomy - Per agent slug, the action kinds it has had decided, with rung and alignment.
 * @param input.policies - The org's effective autonomy policy per action id.
 * @param input.autoExecuteActions - Enabled trust rules in the org.
 * @param input.completedWorkEver - Completed runs + executed actions, all time — the setup gate.
 */
export function buildTeamReport(input: {
  window: ReportWindow;
  range: { since: Date; until: Date };
  workspaceName: string;
  goal: string | null;
  teams: TeamRow[];
  agents: AgentRow[];
  agg: AggRow[];
  models: ModelRow[];
  measures: Map<string, MeasureReading>;
  humanLoad: Map<string | null, HumanLoad>;
  primaryCents?: Map<string, number>;
  chains: Map<string, OutcomeChain[]>;
  budgets: BudgetRow[];
  owners: { byTeam: Map<string, AccountableUser | null>; workspace: AccountableUser | null };
  autonomy: Map<string, AutonomyReading[]>;
  policies: Map<string, EffectivePolicy>;
  autoExecuteActions: number;
  completedWorkEver: number;
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
      contract: {
        purpose: a.description,
        owner: team ? input.owners.byTeam.get(team.slug) ?? null : input.owners.workspace,
        measures: [],
        attainment: null,
        autonomy: input.autonomy.get(a.slug) ?? [],
        permissions: permissionKeys(a.approvalPolicy),
      },
      models: modelsByAgent.get(a.slug) ?? [],
      budget: b
        ? { period: b.period, currentCents: Number(b.currentMicroCents ?? 0) / 1_000_000, currentTokens: Number(b.currentTokens ?? 0), hardCentsLimit: b.hardCentsLimit === null ? null : Number(b.hardCentsLimit), softCentsLimit: b.softCentsLimit === null ? null : Number(b.softCentsLimit) }
        : null,
    };
  };

  const agentsBySlug = new Map(input.agents.map(a => [a.slug, a]));
  const bySpend = (x: MemberReport, y: MemberReport) => Number(y.isLead) - Number(x.isLead) || y.cents - x.cents || x.name.localeCompare(y.name);

  const teams: TeamReportTeam[] = input.teams.map((team) => {
    const members = input.agents.filter(a => a.teamSlug === team.slug).map(member).sort(bySpend);
    const memberSlugs = members.map(m => m.slug);
    const t = emptyTotals();
    for (const m of members) {
      // Re-add from the agg rows so byKind stays per kind, not per member.
      for (const row of input.agg.filter(r => r.agentSlug === m.slug)) {
        addTotals(t, row);
      }
    }
    const readings = effectiveMeasures(team).map(m => input.measures.get(`${team.slug}/${m.key}`)).filter((r): r is MeasureReading => r !== undefined);
    const primary = primaryOutcome(readings);
    const humanLoad = input.humanLoad.get(team.slug) ?? deriveHumanLoad(emptyHumanLoadCounts());
    const autonomy = mergeAutonomy(members.map(m => m.contract.autonomy));
    const permissions = [...new Set(members.flatMap(m => m.contract.permissions))].sort();
    const byDimension = (d: MeasureReading['measure']['dimension']) => readings.find(r => r.measure.dimension === d) ?? null;
    const budgets = members.map(m => m.budget).filter((b): b is NonNullable<MemberReport['budget']> => b !== null);
    const spentCents = budgets.reduce((n, b) => n + b.currentCents, 0);
    const limitCents = budgets.length > 0 && budgets.every(b => b.hardCentsLimit !== null) ? budgets.reduce((n, b) => n + (b.hardCentsLimit ?? 0), 0) : null;
    const attained = readings.map(r => r.attainment).filter((a): a is number => a !== null);
    const primaryWindowCents = primary ? input.primaryCents?.get(team.slug) ?? t.cents : null;
    return {
      ...t,
      slug: team.slug,
      name: team.name,
      description: team.description,
      mission: team.goal ?? team.description ?? null,
      leadAgentSlug: team.leadAgentSlug,
      accent: team.leadAgentSlug ? agentsBySlug.get(team.leadAgentSlug)?.accent ?? null : null,
      shareOfCents: share(t.cents, totals.cents),
      shareOfTokens: share(t.tokens, totals.tokens),
      contract: {
        purpose: team.goal ?? team.description ?? null,
        owner: input.owners.byTeam.get(team.slug) ?? null,
        measures: readings,
        attainment: meanOrNull(attained),
        autonomy,
        permissions,
      },
      primary,
      quality: { measure: byDimension('quality'), rate: humanLoad.qualityRate, decided: humanLoad.approvedClean + humanLoad.approvedEdited + humanLoad.rejected },
      velocity: { measure: byDimension('velocity'), medianMs: humanLoad.turnaroundMedianMs },
      economics: {
        measure: byDimension('economics'),
        cents: t.cents,
        primaryWindowCents,
        costPerOutcomeCents: primary && primaryWindowCents !== null ? costPerOutcomeCents(primaryWindowCents, primary.value) : null,
        budget: { spentCents, limitCents, variance: budgetVariance(spentCents, limitCents) },
      },
      humanLoad,
      control: controlSummary(autonomy, permissions, input.policies),
      needsYou: { count: humanLoad.open.count, oldestAt: humanLoad.open.oldestAt, href: inboxHrefFor(memberSlugs) },
      evidence: { workItems: humanLoad.workItems, completed: humanLoad.completedRuns + humanLoad.executed, chains: input.chains.get(team.slug) ?? [] },
      members,
    };
  }).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const teamSlugs = new Set(input.teams.map(t => t.slug));
  const ungrouped = input.agents
    .filter(a => a.teamSlug === null || !teamSlugs.has(a.teamSlug))
    .map(member)
    .sort(bySpend);

  const orgLoad = deriveHumanLoad(sumHumanLoadCounts([...input.humanLoad.values()]));
  const allReadings = teams.flatMap(t => t.contract.measures);
  const setup = detectSetupState({
    goal: input.goal,
    teams: input.teams.map(t => ({ slug: t.slug, measures: effectiveMeasures(t) })),
    unassignedAgents: ungrouped.length,
    completedWorkEver: input.completedWorkEver,
    autoExecuteActions: input.autoExecuteActions,
  });

  return {
    window: input.window,
    range: input.range,
    workspace: { name: input.workspaceName, goal: input.goal, owner: input.owners.workspace },
    goal: input.goal,
    owner: input.owners.workspace,
    setup,
    headline: {
      teamsOnTarget: teamsOnTarget(teams.map(t => t.primary)),
      goalProgress: goalProgress(allReadings),
      cents: totals.cents,
      humanReviewMs: orgLoad.decisionLatencyMs,
      autoCompletedRate: orgLoad.unattendedRate,
      needsAttention: orgLoad.open.count,
      needsAttentionOldestAt: orgLoad.open.oldestAt,
    },
    attainment: meanOrNull(teams.map(t => t.contract.attainment).filter((a): a is number => a !== null)),
    autoExecuteActions: input.autoExecuteActions,
    totals,
    teams,
    ungrouped,
  };
}

/**
 * The full report for an org in a window: the org chart, the run aggregate,
 * every measure read from its source, human load, evidence chains, budgets
 * and the ladder — in parallel where they do not depend on each other.
 * @param orgId - Tenant.
 * @param window - Report window; measures read their own authored window regardless.
 * @param now - The clock, injectable for tests.
 */
export async function teamReport(orgId: string, window: ReportWindow = '7d', now: Date = new Date()): Promise<TeamReport> {
  const since = windowStart(window, now);
  const range = { since, until: now };
  const runWhere = and(eq(workerRunSchema.orgId, orgId), gte(workerRunSchema.createdAt, since), lt(workerRunSchema.createdAt, now));

  const [project, teams, agents, agg, models, budgets, teamViews, workspaceLead, autonomy, policies, trustRules, completedRuns, executedActions] = await Promise.all([
    db.select({ name: projectSchema.name, goal: projectSchema.goal }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1),
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
    db.select().from(agentBudgetSchema).where(and(eq(agentBudgetSchema.orgId, orgId), agentScopedOnly())),
    // Owners come from TeamService so the inheritance rule (team-set vs
    // workspace default) is resolved in exactly one place.
    listTeams(orgId),
    getWorkspaceLead(orgId),
    readAutonomy(orgId, now),
    effectivePolicies(orgId),
    db.select({ n: sql<number>`count(*)::int` }).from(trustRuleSchema).where(and(eq(trustRuleSchema.orgId, orgId), eq(trustRuleSchema.enabled, 'true'))),
    db.select({ n: sql<number>`count(*)::int` }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.status, 'completed'))),
    db.select({ n: sql<number>`count(*)::int` }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'done'))),
  ]);

  const scopes = teams.map(t => ({ slug: t.slug, teamSlug: t.slug, agentSlugs: agents.filter(a => a.teamSlug === t.slug).map(a => a.slug), measures: effectiveMeasures(t) }));
  const [measures, humanLoad, chains, primaryCents] = await Promise.all([
    readTeamMeasures(orgId, scopes, now),
    readHumanLoad(orgId, scopes, range, now),
    readOutcomeChains(orgId, scopes, range),
    readPrimaryWindowCents(orgId, scopes, now),
  ]);

  return buildTeamReport({
    window,
    range,
    workspaceName: project[0]?.name ?? 'Workspace',
    goal: project[0]?.goal ?? null,
    teams,
    agents,
    agg: agg.map(r => ({ ...r, lastActivity: r.lastActivity ? new Date(r.lastActivity) : null })),
    models,
    measures,
    humanLoad,
    primaryCents,
    chains,
    budgets,
    owners: { byTeam: new Map(teamViews.map(v => [v.slug, v.accountable])), workspace: workspaceLead.accountable },
    autonomy,
    policies,
    autoExecuteActions: Number(trustRules[0]?.n ?? 0),
    completedWorkEver: Number(completedRuns[0]?.n ?? 0) + Number(executedActions[0]?.n ?? 0),
  });
}

/**
 * Each team's operating cents over its PRIMARY measure's own window, so cost
 * per outcome divides like with like (a daily page must not divide a day of
 * spend by a week of outcomes). One aggregate per distinct window.
 * @param orgId
 * @param scopes - Teams with their agents and measures.
 * @param now
 */
async function readPrimaryWindowCents(orgId: string, scopes: Array<{ slug: string; agentSlugs: string[]; measures: ReturnType<typeof effectiveMeasures> }>, now: Date): Promise<Map<string, number>> {
  const windowOf = new Map(scopes.map(s => [s.slug, (s.measures.find(m => m.dimension === 'outcome') ?? s.measures[0])?.window] as const));
  const windows = [...new Set([...windowOf.values()].filter((w): w is NonNullable<typeof w> => w !== undefined))];
  const centsByAgent = new Map<string, Map<string, number>>();
  await Promise.all(windows.map(async (w) => {
    const r = measureRange(w, now);
    const rows = await db.select({ agentSlug: workerRunSchema.agentSlug, cents: sql<number>`coalesce(sum(${workerRunSchema.cents}), 0)::int` })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), gte(workerRunSchema.createdAt, r.since), lt(workerRunSchema.createdAt, r.until)))
      .groupBy(workerRunSchema.agentSlug);
    centsByAgent.set(w, new Map(rows.map(x => [x.agentSlug, Number(x.cents)])));
  }));
  const out = new Map<string, number>();
  for (const s of scopes) {
    const w = windowOf.get(s.slug);
    if (!w) {
      continue;
    }
    const byAgent = centsByAgent.get(w) ?? new Map<string, number>();
    out.set(s.slug, s.agentSlugs.reduce((n, a) => n + (byAgent.get(a) ?? 0), 0));
  }
  return out;
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

export type MemberDetail = {
  member: MemberReport;
  team: { slug: string; name: string; mission: string | null } | null;
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
 * @param opts.now
 */
export async function memberReport(orgId: string, agentSlug: string, opts: { window?: ReportWindow; limit?: number; now?: Date } = {}): Promise<MemberDetail | null> {
  const window = opts.window ?? '7d';
  const now = opts.now ?? new Date();
  const report = await teamReport(orgId, window, now);
  const fromTeam = report.teams.flatMap(t => t.members.map(m => ({ m, t }))).find(x => x.m.slug === agentSlug);
  const member = fromTeam?.m ?? report.ungrouped.find(m => m.slug === agentSlug) ?? null;
  if (!member) {
    return null;
  }
  const since = windowStart(window, now);
  const runs = await db.select().from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.agentSlug, agentSlug), gte(workerRunSchema.createdAt, since), lt(workerRunSchema.createdAt, now))).orderBy(desc(workerRunSchema.createdAt)).limit(opts.limit ?? 100);
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
    team: fromTeam ? { slug: fromTeam.t.slug, name: fromTeam.t.name, mission: fromTeam.t.mission } : null,
    runs,
    counts,
  };
}
