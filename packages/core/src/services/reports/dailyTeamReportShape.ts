/**
 * Daily team report — the pure half: the data types and the fold from rows
 * to team → member stats. No database import, so the renderer and its
 * snapshot test load without an environment. `dailyTeamReport.ts` does the
 * reading and re-exports everything here.
 */

/** `briefing.agent_slug` the job stamps on the copy it stores; the collector skips those when picking the latest rollup. */
export const DAILY_TEAM_REPORT_PUBLISHER = 'daily-team-report';

export type ReportWindow = { since: Date; until: Date };

export type WorkerRunRow = {
  agentSlug: string;
  status: string;
  kind: string | null;
  tokens: number;
  cents: number;
  createdAt: Date;
};

export type AgentRow = { slug: string; name: string; teamSlug: string | null; active: boolean };
export type TeamRow = { slug: string; name: string; leadAgentSlug: string | null };
export type BudgetRow = { agentSlug: string; period: string; currentCents: number; currentTokens: number; hardCentsLimit: number | null };

export type MemberStats = {
  agentSlug: string;
  name: string;
  teamSlug: string | null;
  runs: number;
  completed: number;
  failed: number;
  tokens: number;
  cents: number;
  /** Share of the window's total spend, 0–100, one decimal. */
  weightPct: number;
  byKind: Record<string, number>;
  /** Current-period spend from `agent_budget`, when a row exists. */
  budgetCents: number | null;
  budgetHardCentsLimit: number | null;
};

export type TeamStats = {
  teamSlug: string | null;
  name: string;
  leadAgentSlug: string | null;
  runs: number;
  tokens: number;
  cents: number;
  weightPct: number;
  members: MemberStats[];
};

export type NeedsYou = {
  pendingActions: number;
  runsAwaitingReview: number;
  runsPaused: number;
  pendingLearningCandidates: number;
  /** null when the deployment has no `ask` table yet. */
  openAsks: number | null;
  total: number;
};

export type DailyTeamReportData = {
  workspace: { id: string; name: string; slug: string; accountableEmail: string | null };
  window: ReportWindow;
  totals: {
    runs: number;
    completed: number;
    failed: number;
    tokens: number;
    cents: number;
    boardRuns: number;
    redTeamRuns: number;
    /** false when no run in the window carried a `kind` (column absent or unset). */
    kindsKnown: boolean;
  };
  teams: TeamStats[];
  needsYou: NeedsYou;
  rollup: { id: number; title: string; content: string; createdAt: Date } | null;
  links: { inbox: string; teamReport: string; briefings: string };
  generatedAt: Date;
};

const FAILED_STATUSES = new Set(['failed', 'lost', 'cancelled']);
const KIND_ALIASES: Record<string, string> = { final: 'board', red_team: 'red-team', redteam: 'red-team' };

function normalizeKind(kind: string | null): string | null {
  if (!kind) {
    return null;
  }
  const k = kind.trim().toLowerCase();
  return KIND_ALIASES[k] ?? k;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/**
 * Pure: fold rows into the team → member shape. Members without a run in the
 * window still appear (with zeros) so a silent role is visible, not missing.
 * Agents with no `team_slug` are grouped under a synthetic "Unassigned" team.
 * @param input - Already-fetched rows.
 * @param input.runs - Worker runs in the window.
 * @param input.agents - Every agent in the org.
 * @param input.teams - Every team in the org.
 * @param input.budgets - `agent_budget` rows for the org.
 */
export function shapeDailyTeamReport(input: {
  runs: WorkerRunRow[];
  agents: AgentRow[];
  teams: TeamRow[];
  budgets: BudgetRow[];
}): Pick<DailyTeamReportData, 'totals' | 'teams'> {
  const totalCents = input.runs.reduce((n, r) => n + r.cents, 0);
  const budgetBySlug = new Map<string, BudgetRow>();
  for (const b of input.budgets) {
    // Prefer the daily row; fall back to whatever exists.
    const prev = budgetBySlug.get(b.agentSlug);
    if (!prev || (b.period === 'daily' && prev.period !== 'daily')) {
      budgetBySlug.set(b.agentSlug, b);
    }
  }

  const members = new Map<string, MemberStats>();
  const ensureMember = (slug: string): MemberStats => {
    let m = members.get(slug);
    if (!m) {
      const agent = input.agents.find(a => a.slug === slug);
      const budget = budgetBySlug.get(slug);
      m = {
        agentSlug: slug,
        name: agent?.name ?? slug,
        teamSlug: agent?.teamSlug ?? null,
        runs: 0,
        completed: 0,
        failed: 0,
        tokens: 0,
        cents: 0,
        weightPct: 0,
        byKind: {},
        budgetCents: budget ? budget.currentCents : null,
        budgetHardCentsLimit: budget?.hardCentsLimit ?? null,
      };
      members.set(slug, m);
    }
    return m;
  };
  for (const a of input.agents) {
    if (a.active) {
      ensureMember(a.slug);
    }
  }

  let boardRuns = 0;
  let redTeamRuns = 0;
  let completed = 0;
  let failed = 0;
  let kindsKnown = false;
  let totalTokens = 0;
  for (const r of input.runs) {
    const m = ensureMember(r.agentSlug);
    m.runs += 1;
    m.tokens += r.tokens;
    m.cents += r.cents;
    totalTokens += r.tokens;
    if (r.status === 'completed') {
      m.completed += 1;
      completed += 1;
    } else if (FAILED_STATUSES.has(r.status)) {
      m.failed += 1;
      failed += 1;
    }
    const kind = normalizeKind(r.kind);
    if (kind) {
      kindsKnown = true;
      m.byKind[kind] = (m.byKind[kind] ?? 0) + 1;
      if (kind === 'board') {
        boardRuns += 1;
      } else if (kind === 'red-team') {
        redTeamRuns += 1;
      }
    }
  }
  for (const m of members.values()) {
    m.weightPct = pct(m.cents, totalCents);
  }

  const teamOrder = [...input.teams.map(t => t.slug), null];
  const teams: TeamStats[] = [];
  for (const slug of teamOrder) {
    const team = slug ? input.teams.find(t => t.slug === slug) : undefined;
    const mine = [...members.values()]
      .filter(m => (slug === null ? m.teamSlug === null || !input.teams.some(t => t.slug === m.teamSlug) : m.teamSlug === slug))
      .sort((a, b) => b.cents - a.cents || b.runs - a.runs || a.agentSlug.localeCompare(b.agentSlug));
    if (mine.length === 0) {
      continue;
    }
    const cents = mine.reduce((n, m) => n + m.cents, 0);
    teams.push({
      teamSlug: slug,
      name: team?.name ?? 'Unassigned',
      leadAgentSlug: team?.leadAgentSlug ?? null,
      runs: mine.reduce((n, m) => n + m.runs, 0),
      tokens: mine.reduce((n, m) => n + m.tokens, 0),
      cents,
      weightPct: pct(cents, totalCents),
      members: mine,
    });
  }
  teams.sort((a, b) => b.cents - a.cents || b.runs - a.runs);

  return {
    totals: { runs: input.runs.length, completed, failed, tokens: totalTokens, cents: totalCents, boardRuns, redTeamRuns, kindsKnown },
    teams,
  };
}
