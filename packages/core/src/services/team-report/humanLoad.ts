/**
 * Human load — the AI-workforce metric the spec calls the most important one
 * (docs/specs/team-report-v2.md §6): how often, and for how long, the
 * people around a team had to step in.
 *
 * `deriveHumanLoad` is pure; `readHumanLoad` gathers the rows. Definitions,
 * so the numbers can be argued with:
 *
 *   work items          action_run proposals + worker_runs created in the window
 *   interventions       decisions a person took: action_run approve / edit /
 *                       reject + asks decided, in the window
 *   decision latency    Σ (decided_at − created_at) per decided item, capped
 *                       at DECISION_LATENCY_CAP_MS each. Labelled "decision
 *                       latency", not review time: nothing tracks when a
 *                       person first LOOKED, so this is the whole wait.
 *   intervention rate   items that needed a person / work items — a proposal
 *                       that did not auto-execute, an ask, a paused run
 *   autonomous completion  auto-executed / executed (action_run `done`)
 *   escalation rate     asks filed + runs paused or awaiting review / work items
 *   blocked time        Σ (now − created_at) over what is open RIGHT NOW
 */

import type { Range } from './measures';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, askSchema, decisionAlignmentSchema, workerRunSchema } from '@/models/Schema';
import { median, rate } from './derive';

/** The most one decision may count toward review time — a proposal left over a weekend is a queue problem, not eight hours of reading. */
export const DECISION_LATENCY_CAP_MS = 8 * 3_600_000;

export type HumanLoadCounts = {
  workItems: number;
  /** action_run proposals created in the window. */
  proposals: number;
  /** worker_runs created in the window. */
  runs: number;
  /** worker_runs that reached `completed` in the window. */
  completedRuns: number;
  /** Decisions a person took (approve / edit / reject / ask answered). */
  interventions: number;
  approvedClean: number;
  approvedEdited: number;
  rejected: number;
  /** Σ capped (decided_at − created_at), ms. */
  decisionLatencyMs: number;
  /** Items that waited for (or are waiting for) a person. */
  needingDecision: number;
  /** action_runs that reached `done`. */
  executed: number;
  /** …of which under a trust rule, with nobody in the loop. */
  autoExecuted: number;
  /** Asks filed + runs paused / awaiting review, in the window. */
  escalations: number;
  /** Median (executed_at or completed_at − created_at) over finished work, ms. */
  turnaroundMedianMs: number | null;
  open: {
    count: number;
    oldestAt: Date | null;
    /** Σ (now − created_at) over open items, ms. */
    blockedMs: number;
  };
};

export type HumanLoad = HumanLoadCounts & {
  interventionRate: number | null;
  autonomousCompletionRate: number | null;
  escalationRate: number | null;
  /** approvedClean / (approvedClean + approvedEdited + rejected). */
  qualityRate: number | null;
  /** Work items that needed nobody / work items — the headline "auto-completed work". */
  unattendedRate: number | null;
};

export function emptyHumanLoadCounts(): HumanLoadCounts {
  return {
    workItems: 0,
    proposals: 0,
    runs: 0,
    completedRuns: 0,
    interventions: 0,
    approvedClean: 0,
    approvedEdited: 0,
    rejected: 0,
    decisionLatencyMs: 0,
    needingDecision: 0,
    executed: 0,
    autoExecuted: 0,
    escalations: 0,
    turnaroundMedianMs: null,
    open: { count: 0, oldestAt: null, blockedMs: 0 },
  };
}

/**
 * The rates over the counts. Pure.
 * @param c - Counts for one team (or the whole org).
 */
export function deriveHumanLoad(c: HumanLoadCounts): HumanLoad {
  const decided = c.approvedClean + c.approvedEdited + c.rejected;
  return {
    ...c,
    interventionRate: rate(c.needingDecision, c.workItems),
    autonomousCompletionRate: rate(c.autoExecuted, c.executed),
    escalationRate: rate(c.escalations, c.workItems),
    qualityRate: rate(c.approvedClean, decided),
    unattendedRate: rate(Math.max(0, c.workItems - c.needingDecision), c.workItems),
  };
}

/**
 * Sum counts across teams (for the workspace headline). Medians do not sum;
 * the fold recomputes nothing and reports the median as null.
 * @param parts
 */
export function sumHumanLoadCounts(parts: HumanLoadCounts[]): HumanLoadCounts {
  const out = emptyHumanLoadCounts();
  for (const p of parts) {
    out.workItems += p.workItems;
    out.proposals += p.proposals;
    out.runs += p.runs;
    out.completedRuns += p.completedRuns;
    out.interventions += p.interventions;
    out.approvedClean += p.approvedClean;
    out.approvedEdited += p.approvedEdited;
    out.rejected += p.rejected;
    out.decisionLatencyMs += p.decisionLatencyMs;
    out.needingDecision += p.needingDecision;
    out.executed += p.executed;
    out.autoExecuted += p.autoExecuted;
    out.escalations += p.escalations;
    out.open.count += p.open.count;
    out.open.blockedMs += p.open.blockedMs;
    if (p.open.oldestAt && (!out.open.oldestAt || p.open.oldestAt < out.open.oldestAt)) {
      out.open.oldestAt = p.open.oldestAt;
    }
  }
  return out;
}

/** The agent an action_run belongs to: `agent:<slug>` on invokedBy, else the proposal's own claim. */
export const actionAgentSlug = sql<string | null>`case when ${actionRunSchema.invokedBy} like 'agent:%' then substr(${actionRunSchema.invokedBy}, 7) else ${actionRunSchema.proposal} ->> 'agentSlug' end`;

/** The rows `readHumanLoad` folds — exported so the fold unit-tests on fixtures. */
export type HumanLoadRows = {
  actions: { id: number; agentSlug: string | null; status: string; autoApproved: boolean; createdAt: Date; decidedAt: Date | null; executedAt: Date | null }[];
  /** decision_alignment rows for actions in the window, by action_run id. */
  decisions: { subjectId: number; decision: string }[];
  asks: { agentSlug: string | null; teamSlug: string | null; status: string; createdAt: Date; decidedAt: Date | null }[];
  runs: { agentSlug: string; status: string; createdAt: Date; completedAt: Date | null }[];
  /** Everything open right now, whatever window it was created in. */
  open: { agentSlug: string | null; teamSlug: string | null; createdAt: Date }[];
};

export type TeamScope = { slug: string; agentSlugs: string[] };

/**
 * Fold rows into per-team counts. Pure. A row whose agent is on no listed
 * team lands under the `null` key so the org headline still counts it.
 * @param rows - Everything in the window (plus what is open now).
 * @param teams - Team → agent slugs.
 * @param now - The clock, for blocked time.
 */
export function foldHumanLoad(rows: HumanLoadRows, teams: TeamScope[], now: Date): Map<string | null, HumanLoadCounts> {
  const teamOfAgent = new Map<string, string>();
  for (const t of teams) {
    for (const a of t.agentSlugs) {
      teamOfAgent.set(a, t.slug);
    }
  }
  const out = new Map<string | null, HumanLoadCounts>();
  const turnarounds = new Map<string | null, number[]>();
  const bucket = (agentSlug: string | null, teamSlug: string | null = null): HumanLoadCounts => {
    const key = teamSlug ?? (agentSlug ? teamOfAgent.get(agentSlug) ?? null : null);
    let c = out.get(key);
    if (!c) {
      c = emptyHumanLoadCounts();
      out.set(key, c);
      turnarounds.set(key, []);
    }
    return c;
  };
  const keyOf = (agentSlug: string | null, teamSlug: string | null = null) => teamSlug ?? (agentSlug ? teamOfAgent.get(agentSlug) ?? null : null);
  const cap = (ms: number) => Math.min(Math.max(0, ms), DECISION_LATENCY_CAP_MS);

  const decisionByAction = new Map<number, string>();
  for (const d of rows.decisions) {
    // approved / edited / rejected are terminal; the strongest statement wins.
    const prev = decisionByAction.get(d.subjectId);
    if (!prev || d.decision === 'rejected' || (d.decision === 'edited' && prev === 'approved')) {
      decisionByAction.set(d.subjectId, d.decision);
    }
  }

  for (const a of rows.actions) {
    const c = bucket(a.agentSlug);
    c.workItems += 1;
    c.proposals += 1;
    if (a.status === 'done') {
      c.executed += 1;
      if (a.autoApproved) {
        c.autoExecuted += 1;
      }
      if (a.executedAt) {
        turnarounds.get(keyOf(a.agentSlug))!.push(a.executedAt.getTime() - a.createdAt.getTime());
      }
    }
    if (!a.autoApproved) {
      c.needingDecision += 1;
    }
    const decision = decisionByAction.get(a.id) ?? (a.status === 'rejected' ? 'rejected' : a.status === 'done' && !a.autoApproved && a.decidedAt ? 'approved' : null);
    if (decision) {
      c.interventions += 1;
      if (decision === 'approved') {
        c.approvedClean += 1;
      } else if (decision === 'edited') {
        c.approvedEdited += 1;
      } else if (decision === 'rejected') {
        c.rejected += 1;
      }
      const decidedAt = a.decidedAt ?? a.executedAt;
      if (decidedAt) {
        c.decisionLatencyMs += cap(decidedAt.getTime() - a.createdAt.getTime());
      }
    }
  }

  for (const ask of rows.asks) {
    const c = bucket(ask.agentSlug, ask.teamSlug);
    c.workItems += 1;
    c.needingDecision += 1;
    c.escalations += 1;
    if (ask.decidedAt && ask.status !== 'superseded') {
      c.interventions += 1;
      c.decisionLatencyMs += cap(ask.decidedAt.getTime() - ask.createdAt.getTime());
    }
  }

  for (const r of rows.runs) {
    const c = bucket(r.agentSlug);
    c.workItems += 1;
    c.runs += 1;
    if (r.status === 'completed') {
      c.completedRuns += 1;
      if (r.completedAt) {
        turnarounds.get(keyOf(r.agentSlug))!.push(r.completedAt.getTime() - r.createdAt.getTime());
      }
    }
    if (r.status === 'paused' || r.status === 'awaiting_review') {
      c.needingDecision += 1;
      c.escalations += 1;
    }
  }

  for (const o of rows.open) {
    const c = bucket(o.agentSlug, o.teamSlug);
    c.open.count += 1;
    c.open.blockedMs += Math.max(0, now.getTime() - o.createdAt.getTime());
    if (!c.open.oldestAt || o.createdAt < c.open.oldestAt) {
      c.open.oldestAt = o.createdAt;
    }
  }

  for (const [key, c] of out) {
    c.turnaroundMedianMs = median(turnarounds.get(key) ?? []);
  }
  for (const t of teams) {
    if (!out.has(t.slug)) {
      out.set(t.slug, emptyHumanLoadCounts());
    }
  }
  return out;
}

/**
 * Read everything `foldHumanLoad` needs for one org and one window. Five
 * queries, all org-wide, folded per team in memory.
 * @param orgId - Tenant.
 * @param range - The window.
 */
export async function readHumanLoadRows(orgId: string, range: Range): Promise<HumanLoadRows> {
  const inRange = (col: typeof actionRunSchema.createdAt | typeof askSchema.createdAt | typeof workerRunSchema.createdAt) => and(gte(col, range.since), lt(col, range.until));
  const [actions, asks, runs, pendingActions, openAsks, waitingRuns] = await Promise.all([
    db.select({
      id: actionRunSchema.id,
      agentSlug: actionAgentSlug,
      status: actionRunSchema.status,
      autoApproved: sql<boolean>`coalesce((${actionRunSchema.proposal} ->> 'autoApproved')::boolean, false)`,
      createdAt: actionRunSchema.createdAt,
      decidedAt: actionRunSchema.decidedAt,
      executedAt: actionRunSchema.executedAt,
    }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inRange(actionRunSchema.createdAt))),
    db.select({ agentSlug: askSchema.agentSlug, teamSlug: askSchema.teamSlug, status: askSchema.status, createdAt: askSchema.createdAt, decidedAt: askSchema.decidedAt })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), inRange(askSchema.createdAt))),
    db.select({ agentSlug: workerRunSchema.agentSlug, status: workerRunSchema.status, createdAt: workerRunSchema.createdAt, completedAt: workerRunSchema.completedAt })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), inRange(workerRunSchema.createdAt))),
    db.select({ agentSlug: actionAgentSlug, createdAt: actionRunSchema.createdAt })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending'))),
    db.select({ agentSlug: askSchema.agentSlug, teamSlug: askSchema.teamSlug, createdAt: askSchema.createdAt })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'))),
    db.select({ agentSlug: workerRunSchema.agentSlug, createdAt: workerRunSchema.createdAt })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, ['paused', 'awaiting_review']))),
  ]);
  const ids = actions.map(a => a.id);
  const decisions = ids.length === 0
    ? []
    : await db.select({ subjectId: decisionAlignmentSchema.subjectId, decision: decisionAlignmentSchema.decision })
        .from(decisionAlignmentSchema)
        .where(and(eq(decisionAlignmentSchema.orgId, orgId), eq(decisionAlignmentSchema.subjectKind, 'action'), inArray(decisionAlignmentSchema.subjectId, ids), inArray(decisionAlignmentSchema.decision, ['approved', 'edited', 'rejected'])));
  return {
    actions: actions.map(a => ({ ...a, autoApproved: Boolean(a.autoApproved), createdAt: new Date(a.createdAt), decidedAt: a.decidedAt ? new Date(a.decidedAt) : null, executedAt: a.executedAt ? new Date(a.executedAt) : null })),
    decisions,
    asks: asks.map(a => ({ ...a, createdAt: new Date(a.createdAt), decidedAt: a.decidedAt ? new Date(a.decidedAt) : null })),
    runs: runs.map(r => ({ ...r, createdAt: new Date(r.createdAt), completedAt: r.completedAt ? new Date(r.completedAt) : null })),
    open: [
      ...pendingActions.map(p => ({ agentSlug: p.agentSlug, teamSlug: null, createdAt: new Date(p.createdAt) })),
      ...openAsks.map(a => ({ agentSlug: a.agentSlug, teamSlug: a.teamSlug, createdAt: new Date(a.createdAt) })),
      ...waitingRuns.map(w => ({ agentSlug: w.agentSlug, teamSlug: null, createdAt: new Date(w.createdAt) })),
    ],
  };
}

/**
 * Per-team human load for a window, plus the org-wide fold under `null`.
 * @param orgId - Tenant.
 * @param teams - Team → agent slugs.
 * @param range - The window.
 * @param now - The clock.
 */
export async function readHumanLoad(orgId: string, teams: TeamScope[], range: Range, now: Date = new Date()): Promise<Map<string | null, HumanLoad>> {
  const rows = await readHumanLoadRows(orgId, range);
  const counts = foldHumanLoad(rows, teams, now);
  return new Map([...counts].map(([k, c]) => [k, deriveHumanLoad(c)]));
}
