/**
 * What the org review reads — the evidence core already stores, per agent and
 * per team, gathered once per review and scoped to one workspace.
 *
 * Nothing here is new data. Each signal is a reading of a table the platform
 * already writes for its own reasons:
 *
 *   last run       the latest of a chat turn (`conversation`), a worker run, a
 *                  mission run it led, a proposal it made and an ask it filed
 *   spend          assistant turns' cost (`conversation_message.micro_cents`)
 *                  and worker runs' cents in the window, and today's counter
 *                  and cap in force (`agent_budget`, `agentBudgetStatuses`)
 *   decisions      the alignment ledger (`decision_alignment`): what people
 *                  decided on the agent's proposals, per action kind, and the
 *                  notes they left when they turned one down
 *   escalations    asks it filed and how they were answered; runs that failed
 *   measures       each team's primary measure, read through the team report's
 *                  own reader, and the catalog roles the team has not hired
 *
 * Every query names the org. A reading that cannot be taken is left out, never
 * read as zero ("unavailable is never rendered as zero", principle 2).
 */

import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { effectiveMeasures } from '@/libs/workspace/team-export';
import {
  actionRunSchema,
  agentSchema,
  askSchema,
  conversationMessageSchema,
  conversationSchema,
  decisionAlignmentSchema,
  missionRunSchema,
  projectSchema,
  teamSchema,
  workerRunSchema,
} from '@/models/Schema';

/** How far back the review reads decisions, spend and escalations. */
export const REVIEW_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

export type KindDecisions = {
  /** The action id (or ladder key) people decided on. */
  subjectKey: string;
  decided: number;
  rejected: number;
  /** Decisions where something was recommended. */
  withRecommendation: number;
  agreed: number;
};

export type AgentSignals = {
  slug: string;
  name: string;
  description: string | null;
  teamSlug: string | null;
  /** Answers every message nobody addressed — never proposed for retirement. */
  isWorkspaceLead: boolean;
  createdAt: Date;
  /** The latest sign it worked, from any source; null when it never has. */
  lastActiveAt: Date | null;
  /** Assistant turns in the window. */
  turns: number;
  /** Turns that ended failed or refused in the window. */
  failedTurns: number;
  /** Turns refused — a budget stop is one — in the window. */
  refusedTurns: number;
  /** Worker runs in the window, and how many failed or were lost. */
  workerRuns: number;
  failedRuns: number;
  /** Chat turns' and worker runs' cost in the window, cents. */
  spentCents: number;
  /** Today's counter against the cap in force, when there is one. */
  today: { spentCents: number; hardCentsLimit: number | null; blocked: boolean } | null;
  decisions: KindDecisions[];
  /** What people wrote when they turned its proposals down, newest first, at most five. */
  rejectionNotes: string[];
  asks: { filed: number; answered: number; byKind: Record<string, number> };
  /** Recent asks it filed with their answers, newest first, at most five — what a standing rule could pre-answer. */
  answeredAsks: Array<{ title: string; decision: string | null; note: string | null }>;
};

export type TeamSignals = {
  slug: string;
  name: string;
  goal: string | null;
  agentSlugs: string[];
  /** The team's primary measure as the team report reads it; null when it declares none or it could not be read. */
  primary: { label: string; value: number; target: number; attainment: number; unit: string | null; window: string; provenance: string } | null;
  /** Catalog roles of this team nobody has hired here. */
  unhired: Array<{ slug: string; name: string; description: string }>;
};

export type OrgSignals = {
  orgId: string;
  workspace: { name: string; goal: string | null; leadAgentSlug: string | null };
  asOf: Date;
  windowDays: number;
  agents: AgentSignals[];
  teams: TeamSignals[];
};

/** Which agent a proposal belongs to: its envelope's agent, else an `agent:` proposer. */
const proposalAgent = sql<string | null>`coalesce(${actionRunSchema.proposal} ->> 'agentSlug', case when ${actionRunSchema.invokedBy} like 'agent:%' then substr(${actionRunSchema.invokedBy}, 7) end)`;

function later(a: Date | null, b: Date | string | null | undefined): Date | null {
  const d = b ? new Date(b) : null;
  if (!d || Number.isNaN(d.getTime())) {
    return a;
  }
  return !a || d > a ? d : a;
}

/**
 * Read everything the review weighs, for one workspace.
 * @param orgId - The workspace. Every query is scoped to it.
 * @param opts - The clock and window.
 * @param opts.now - The moment the evidence is read; every date shown is relative to it.
 * @param opts.windowDays - How far back decisions, spend and escalations reach.
 */
export async function readOrgSignals(orgId: string, opts: { now?: Date; windowDays?: number } = {}): Promise<OrgSignals> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? REVIEW_WINDOW_DAYS;
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const [project] = await db
    .select({ name: projectSchema.name, goal: projectSchema.goal, lead: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  const agents = await db
    .select({
      slug: agentSchema.slug,
      name: agentSchema.name,
      description: agentSchema.description,
      teamSlug: agentSchema.teamSlug,
      active: agentSchema.active,
      createdAt: agentSchema.createdAt,
    })
    .from(agentSchema)
    .where(eq(agentSchema.orgId, orgId));
  const active = agents.filter(a => a.active !== 'false');
  const slugs = active.map(a => a.slug);
  if (slugs.length === 0) {
    return { orgId, workspace: { name: project?.name ?? 'Workspace', goal: project?.goal ?? null, leadAgentSlug: project?.lead ?? null }, asOf: now, windowDays, agents: [], teams: await readTeamSignals(orgId, [], now) };
  }

  const [chatLast, turnRows, workerLast, workerRows, missionLast, proposalLast, askLast, askRows, decisionRows, rejectionRows, answeredRows, today] = await Promise.all([
    // All-time latest chat activity per agent, off the indexed conversation row.
    db.select({ slug: conversationSchema.agentSlug, at: sql<string>`max(${conversationSchema.updatedAt})` })
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, orgId), inArray(conversationSchema.agentSlug, slugs)))
      .groupBy(conversationSchema.agentSlug),
    db.select({
      slug: sql<string>`coalesce(${conversationMessageSchema.agentSlug}, ${conversationSchema.agentSlug})`,
      turns: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${conversationMessageSchema.status} in ('failed', 'refused'))::int`,
      refused: sql<number>`count(*) filter (where ${conversationMessageSchema.status} = 'refused')::int`,
      microCents: sql<number>`coalesce(sum(${conversationMessageSchema.microCents}), 0)::float8`,
    })
      .from(conversationMessageSchema)
      .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
      .where(and(eq(conversationSchema.orgId, orgId), eq(conversationMessageSchema.role, 'assistant'), gte(conversationMessageSchema.createdAt, since)))
      .groupBy(sql`coalesce(${conversationMessageSchema.agentSlug}, ${conversationSchema.agentSlug})`),
    db.select({ slug: workerRunSchema.agentSlug, at: sql<string>`max(${workerRunSchema.createdAt})` })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.agentSlug, slugs)))
      .groupBy(workerRunSchema.agentSlug),
    db.select({
      slug: workerRunSchema.agentSlug,
      runs: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${workerRunSchema.status} in ('failed', 'lost'))::int`,
      cents: sql<number>`coalesce(sum(${workerRunSchema.cents}), 0)::int`,
    })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), gte(workerRunSchema.createdAt, since)))
      .groupBy(workerRunSchema.agentSlug),
    db.select({ slug: sql<string>`${missionRunSchema.team} ->> 'lead'`, at: sql<string>`max(${missionRunSchema.createdAt})` })
      .from(missionRunSchema)
      .where(eq(missionRunSchema.orgId, orgId))
      .groupBy(sql`${missionRunSchema.team} ->> 'lead'`),
    db.select({ slug: proposalAgent, at: sql<string>`max(${actionRunSchema.createdAt})` })
      .from(actionRunSchema)
      .where(eq(actionRunSchema.orgId, orgId))
      .groupBy(proposalAgent),
    db.select({ slug: askSchema.agentSlug, at: sql<string>`max(${askSchema.createdAt})` })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), isNotNull(askSchema.agentSlug)))
      .groupBy(askSchema.agentSlug),
    db.select({
      slug: askSchema.agentSlug,
      kind: askSchema.kind,
      filed: sql<number>`count(*)::int`,
      answered: sql<number>`count(*) filter (where ${askSchema.status} <> 'open' and ${askSchema.status} <> 'superseded')::int`,
    })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), isNotNull(askSchema.agentSlug), gte(askSchema.createdAt, since)))
      .groupBy(askSchema.agentSlug, askSchema.kind),
    db.select({
      slug: decisionAlignmentSchema.agentSlug,
      subjectKey: decisionAlignmentSchema.subjectKey,
      decided: sql<number>`count(*)::int`,
      rejected: sql<number>`count(*) filter (where ${decisionAlignmentSchema.decision} = 'rejected')::int`,
      withRecommendation: sql<number>`count(*) filter (where ${decisionAlignmentSchema.agreed} is not null)::int`,
      agreed: sql<number>`count(*) filter (where ${decisionAlignmentSchema.agreed} is true)::int`,
    })
      .from(decisionAlignmentSchema)
      .where(and(
        eq(decisionAlignmentSchema.orgId, orgId),
        eq(decisionAlignmentSchema.subjectKind, 'action'),
        isNotNull(decisionAlignmentSchema.agentSlug),
        gte(decisionAlignmentSchema.decidedAt, since),
      ))
      .groupBy(decisionAlignmentSchema.agentSlug, decisionAlignmentSchema.subjectKey),
    db.select({ slug: proposalAgent, actionId: actionRunSchema.actionId, note: actionRunSchema.error })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, orgId),
        eq(actionRunSchema.status, 'rejected'),
        isNotNull(actionRunSchema.error),
        gte(actionRunSchema.createdAt, since),
      ))
      .orderBy(desc(actionRunSchema.id))
      .limit(300),
    db.select({ slug: askSchema.agentSlug, title: askSchema.title, decision: askSchema.decision, note: askSchema.decisionNote })
      .from(askSchema)
      .where(and(
        eq(askSchema.orgId, orgId),
        isNotNull(askSchema.agentSlug),
        isNotNull(askSchema.decidedAt),
        gte(askSchema.createdAt, since),
      ))
      .orderBy(desc(askSchema.id))
      .limit(300),
    readToday(orgId),
  ]);

  const out: AgentSignals[] = active.map((a) => {
    let last: Date | null = null;
    for (const rows of [chatLast, workerLast, missionLast, proposalLast, askLast] as Array<Array<{ slug: string | null; at: string }>>) {
      last = later(last, rows.find(r => r.slug === a.slug)?.at);
    }
    const turns = turnRows.find(r => r.slug === a.slug);
    const worker = workerRows.find(r => r.slug === a.slug);
    const askKinds = askRows.filter(r => r.slug === a.slug);
    return {
      slug: a.slug,
      name: a.name,
      description: a.description,
      teamSlug: a.teamSlug,
      isWorkspaceLead: project?.lead === a.slug,
      createdAt: a.createdAt,
      lastActiveAt: last,
      turns: turns?.turns ?? 0,
      failedTurns: turns?.failed ?? 0,
      refusedTurns: turns?.refused ?? 0,
      workerRuns: worker?.runs ?? 0,
      failedRuns: worker?.failed ?? 0,
      // Micro-cents are a millionth of a cent (`agent_budget`'s unit).
      spentCents: Math.round(((turns?.microCents ?? 0) / 1_000_000 + (worker?.cents ?? 0)) * 100) / 100,
      today: today.get(a.slug) ?? null,
      decisions: decisionRows
        .filter(r => r.slug === a.slug)
        .map(r => ({ subjectKey: r.subjectKey, decided: r.decided, rejected: r.rejected, withRecommendation: r.withRecommendation, agreed: r.agreed })),
      rejectionNotes: rejectionRows.filter(r => r.slug === a.slug && r.note?.trim()).slice(0, 5).map(r => `${r.actionId}: ${r.note!.trim().slice(0, 300)}`),
      asks: {
        filed: askKinds.reduce((n, r) => n + r.filed, 0),
        answered: askKinds.reduce((n, r) => n + r.answered, 0),
        byKind: Object.fromEntries(askKinds.map(r => [r.kind, r.filed])),
      },
      answeredAsks: answeredRows.filter(r => r.slug === a.slug).slice(0, 5).map(r => ({ title: r.title.slice(0, 200), decision: r.decision, note: r.note?.slice(0, 300) ?? null })),
    };
  });

  return {
    orgId,
    workspace: { name: project?.name ?? 'Workspace', goal: project?.goal ?? null, leadAgentSlug: project?.lead ?? null },
    asOf: now,
    windowDays,
    agents: out,
    teams: await readTeamSignals(orgId, active, now),
  };
}

/**
 * Today's counter and the cap in force per agent, as the budget banner reads
 * it. A failure reads as "no reading", never as zero spend.
 * @param orgId - The workspace.
 */
async function readToday(orgId: string): Promise<Map<string, NonNullable<AgentSignals['today']>>> {
  try {
    const { agentBudgetStatuses } = await import('@/services/BudgetService');
    const statuses = await agentBudgetStatuses(orgId, 'daily');
    return new Map(statuses.agents.map(s => [s.agentSlug, { spentCents: s.spentCents, hardCentsLimit: s.hardCentsLimit, blocked: s.blocked }]));
  } catch (error) {
    console.error(`[orgReview] could not read today's budgets for ${orgId}`, error);
    return new Map();
  }
}

/**
 * Each team's primary measure and the catalog roles it has not hired. A
 * measure that cannot be read (a connector not connected, a provider down) is
 * left out, so a team is never called behind on a reading nobody took.
 * @param orgId - The workspace.
 * @param agents - The active agents, for membership and what is already hired.
 * @param now - The clock.
 */
async function readTeamSignals(orgId: string, agents: Array<{ slug: string; teamSlug: string | null }>, now: Date): Promise<TeamSignals[]> {
  const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId));
  if (teams.length === 0) {
    return [];
  }
  let catalog: Array<{ slug: string; name: string; description: string; team: string | null }> = [];
  try {
    const { listCatalog } = await import('@/services/CatalogService');
    catalog = listCatalog();
  } catch {
    catalog = [];
  }
  const hired = new Set((await db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, orgId))).map(a => a.slug));
  const { readMeasure } = await import('@/services/team-report');
  return Promise.all(teams.map(async (team) => {
    const agentSlugs = agents.filter(a => a.teamSlug === team.slug).map(a => a.slug);
    const measures = effectiveMeasures(team);
    const measure = measures.find(m => m.dimension === 'outcome') ?? measures[0];
    let primary: TeamSignals['primary'] = null;
    if (measure) {
      try {
        const reading = await readMeasure(orgId, measure, { teamSlug: team.slug, agentSlugs }, now);
        if (reading.value !== null && reading.attainment !== null) {
          primary = {
            label: measure.label,
            value: reading.value,
            target: measure.target,
            attainment: reading.attainment,
            unit: measure.unit ?? null,
            window: measure.window,
            provenance: reading.provenance,
          };
        }
      } catch (error) {
        console.error(`[orgReview] could not read ${team.slug}/${measure.key} for ${orgId}`, error);
      }
    }
    return {
      slug: team.slug,
      name: team.name,
      goal: team.goal ?? team.description ?? null,
      agentSlugs,
      primary,
      unhired: catalog.filter(e => e.team === team.slug && !hired.has(e.slug)).map(e => ({ slug: e.slug, name: e.name, description: e.description })),
    };
  }));
}
