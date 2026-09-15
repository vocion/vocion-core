/**
 * Outcome lineage — the funnel behind a primary outcome
 * (docs/specs/team-report-v2.md, "Outcome lineage"): outcomes → approved
 * items → recommendations → runs → cost → human minutes, each node with the
 * ids behind it so a person can click from "8 qualified referrals" down to
 * the run that produced one.
 *
 * Honest about missing links. Nothing in the schema ties an `action_run` to
 * the `worker_run` that proposed it, or an action to a CRM record it later
 * moved, so the nodes are the team's work in the measure's window — the
 * same population the report counts — and every node says what it is
 * counting. Where a link does exist (a decision on a proposal, a synced CRM
 * record behind a verified count) it is followed.
 */

import type { MeasureReading, MeasureWindow, TeamMeasure } from './measures';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { effectiveMeasures } from '@/libs/workspace/team-export';
import { actionRunSchema, askSchema, decisionAlignmentSchema, teamSchema, workerRunSchema } from '@/models/Schema';
import { queryCrmRecords } from '@/services/CrmRecordsService';
import { describeActionRun } from '@/services/inbox/describeActionRun';
import { listTeamAgents } from '@/services/TeamService';
import { actionAgentSlug, DECISION_LATENCY_CAP_MS } from './humanLoad';
import { measureRange } from './measures';
import { readMeasure } from './provenance';

export type LineageNodeId = 'outcomes' | 'approved' | 'recommendations' | 'runs' | 'cost' | 'human';

export type LineageItem = {
  id: string;
  title: string;
  /** Where clicking goes; null when nothing in the app shows this item. */
  href: string | null;
  at: Date | null;
  /** One line more — the decision, the agent, the cost. */
  detail: string | null;
};

export type LineageNode = {
  id: LineageNodeId;
  label: string;
  /** The figure a person reads: "8", "$49.12", "17 min". */
  display: string;
  /** The raw number behind it. */
  value: number | null;
  /** What was counted, in a sentence. */
  basis: string;
  items: LineageItem[];
  /** How many more exist than are listed. */
  more: number;
};

export type LineageFunnel = {
  teamSlug: string;
  teamName: string;
  measure: TeamMeasure;
  reading: MeasureReading;
  window: MeasureWindow;
  range: { since: Date; until: Date };
  nodes: LineageNode[];
  /** Links the schema does not record — said, never invented. */
  missing: string[];
};

const ITEM_LIMIT = 25;

function usd(cents: number): string {
  const d = cents / 100;
  return d >= 100 ? `$${Math.round(d).toLocaleString('en-US')}` : `$${d.toFixed(2)}`;
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) {
    return `${m} min`;
  }
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Trace one team measure. Null when the team or the measure does not exist.
 * @param orgId - Tenant.
 * @param teamSlug - The team.
 * @param measureKey - One of its measures.
 * @param now - The clock.
 */
export async function trace(orgId: string, teamSlug: string, measureKey: string, now: Date = new Date()): Promise<LineageFunnel | null> {
  const [team] = await db.select().from(teamSchema).where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, teamSlug))).limit(1);
  if (!team) {
    return null;
  }
  const measure = effectiveMeasures(team).find(m => m.key === measureKey);
  if (!measure) {
    return null;
  }
  const agents = (await listTeamAgents(orgId)).filter(a => a.teamSlug === teamSlug);
  const agentSlugs = agents.map(a => a.slug);
  const nameOf = new Map(agents.map(a => [a.slug, a.name]));
  const scope = { teamSlug, agentSlugs };
  const range = measureRange(measure.window, now);
  const reading = await readMeasure(orgId, measure, scope, now);

  const inRange = (col: typeof actionRunSchema.createdAt) => and(gte(col, range.since), lt(col, range.until));
  const agentIn = agentSlugs.length > 0 ? sql`${actionAgentSlug} in (${sql.join(agentSlugs.map(s => sql`${s}`), sql`, `)})` : sql`false`;

  const [proposals, runs, asks] = await Promise.all([
    db.select({
      id: actionRunSchema.id,
      actionId: actionRunSchema.actionId,
      input: actionRunSchema.input,
      proposal: actionRunSchema.proposal,
      invokedBy: actionRunSchema.invokedBy,
      status: actionRunSchema.status,
      createdAt: actionRunSchema.createdAt,
      decidedAt: actionRunSchema.decidedAt,
      decidedBy: actionRunSchema.decidedBy,
      executedAt: actionRunSchema.executedAt,
      agentSlug: actionAgentSlug,
    }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), agentIn, inRange(actionRunSchema.createdAt))).orderBy(desc(actionRunSchema.createdAt)),
    agentSlugs.length === 0
      ? Promise.resolve([])
      : db.select({ id: workerRunSchema.id, agentSlug: workerRunSchema.agentSlug, kind: workerRunSchema.kind, status: workerRunSchema.status, cents: workerRunSchema.cents, summary: workerRunSchema.summary, counts: workerRunSchema.counts, createdAt: workerRunSchema.createdAt })
          .from(workerRunSchema)
          .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.agentSlug, agentSlugs), gte(workerRunSchema.createdAt, range.since), lt(workerRunSchema.createdAt, range.until)))
          .orderBy(desc(workerRunSchema.createdAt)),
    db.select({ id: askSchema.id, title: askSchema.title, kind: askSchema.kind, status: askSchema.status, decision: askSchema.decision, createdAt: askSchema.createdAt, decidedAt: askSchema.decidedAt })
      .from(askSchema)
      .where(and(
        eq(askSchema.orgId, orgId),
        agentSlugs.length > 0 ? sql`(${askSchema.teamSlug} = ${teamSlug} or ${askSchema.agentSlug} in (${sql.join(agentSlugs.map(s => sql`${s}`), sql`, `)}))` : eq(askSchema.teamSlug, teamSlug),
        gte(askSchema.createdAt, range.since),
        lt(askSchema.createdAt, range.until),
      ))
      .orderBy(desc(askSchema.createdAt)),
  ]);

  const decisions = proposals.length === 0
    ? []
    : await db.select({ subjectId: decisionAlignmentSchema.subjectId, decision: decisionAlignmentSchema.decision, decidedBy: decisionAlignmentSchema.decidedBy, decidedAt: decisionAlignmentSchema.decidedAt })
        .from(decisionAlignmentSchema)
        .where(and(eq(decisionAlignmentSchema.orgId, orgId), eq(decisionAlignmentSchema.subjectKind, 'action'), inArray(decisionAlignmentSchema.subjectId, proposals.map(p => p.id)), inArray(decisionAlignmentSchema.decision, ['approved', 'edited', 'rejected'])));
  const decisionOf = new Map<number, { decision: string; decidedBy: string | null; decidedAt: Date }>();
  for (const d of decisions) {
    const prev = decisionOf.get(d.subjectId);
    if (!prev || d.decision === 'rejected' || (d.decision === 'edited' && prev.decision === 'approved')) {
      decisionOf.set(d.subjectId, { decision: d.decision, decidedBy: d.decidedBy, decidedAt: new Date(d.decidedAt) });
    }
  }

  const describe = (p: typeof proposals[number]) => describeActionRun({ id: p.id, actionId: p.actionId, input: p.input, proposal: p.proposal, invokedBy: p.invokedBy });
  const proposalItem = (p: typeof proposals[number]): LineageItem => {
    const d = describe(p);
    const dec = decisionOf.get(p.id);
    const who = p.agentSlug ? nameOf.get(p.agentSlug) ?? p.agentSlug : 'unknown agent';
    return {
      id: `action:${p.id}`,
      title: d.title,
      href: `/dashboard/inbox?q=${encodeURIComponent(d.title)}&tab=${p.status === 'pending' ? 'open' : 'decided'}`,
      at: new Date(p.createdAt),
      detail: [d.actionKind, `by ${who}`, dec ? `${dec.decision}${dec.decidedBy ? ` by ${dec.decidedBy}` : ''}` : p.status].join(' · '),
    };
  };

  const approvedProposals = proposals.filter(p => ['approved', 'edited'].includes(decisionOf.get(p.id)?.decision ?? ''));
  const approvedAsks = asks.filter(a => a.decidedAt && ['approved', 'done'].includes(a.status));
  const approvedItems: LineageItem[] = [
    ...approvedProposals.map(proposalItem),
    ...approvedAsks.map((a): LineageItem => ({ id: `ask:${a.id}`, title: a.title, href: `/dashboard/inbox/${a.id}`, at: new Date(a.createdAt), detail: `${a.kind} · ${a.decision ?? a.status}` })),
  ].sort((x, y) => (y.at?.getTime() ?? 0) - (x.at?.getTime() ?? 0));

  const runItems: LineageItem[] = runs.map(r => ({
    id: `run:${r.id}`,
    title: `${nameOf.get(r.agentSlug) ?? r.agentSlug} · ${r.kind} run #${r.id}`,
    href: `/dashboard/team-report/${encodeURIComponent(r.agentSlug)}#run-${r.id}`,
    at: new Date(r.createdAt),
    detail: [r.status, usd(r.cents), r.summary ? r.summary.slice(0, 120) : null].filter(Boolean).join(' · '),
  }));
  const cents = runs.reduce((n, r) => n + r.cents, 0);

  const cap = (ms: number) => Math.min(Math.max(0, ms), DECISION_LATENCY_CAP_MS);
  let humanMs = 0;
  let humanN = 0;
  for (const p of proposals) {
    const dec = decisionOf.get(p.id);
    const at = dec?.decidedAt ?? (p.decidedAt ? new Date(p.decidedAt) : null);
    if (dec && at) {
      humanMs += cap(at.getTime() - new Date(p.createdAt).getTime());
      humanN += 1;
    }
  }
  for (const a of asks) {
    if (a.decidedAt && a.status !== 'superseded') {
      humanMs += cap(new Date(a.decidedAt).getTime() - new Date(a.createdAt).getTime());
      humanN += 1;
    }
  }

  // The outcome node: what the measure's own source counted.
  const outcomeItems: LineageItem[] = [];
  let outcomeBasis: string;
  const missing: string[] = [];
  switch (measure.source.kind) {
    case 'verified': {
      const q = measure.source.query;
      const result = await queryCrmRecords(orgId, q.object, { ...q.filter, createdAfter: range.since.toISOString(), createdBefore: range.until.toISOString(), limit: ITEM_LIMIT });
      outcomeBasis = `${q.object} in HubSpot matching the measure's filter, created in the window${result.asOf ? ` · mirror synced ${result.asOf.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`;
      for (const r of result.records) {
        const hubspotId = r.hubspotId;
        outcomeItems.push({
          id: `crm:${r.ref}`,
          title: r.name ?? r.ref,
          href: q.object === 'contacts' && hubspotId ? `/gtm/lead/${encodeURIComponent(hubspotId)}` : null,
          at: typeof r.createdAt === 'string' ? new Date(r.createdAt) : null,
          detail: [r.dealStageLabel, r.lifecycleStage, r.amount !== undefined ? usd(Number(r.amount) * 100) : null].filter((x): x is string => typeof x === 'string').join(' · ') || null,
        });
      }
      missing.push('A CRM record is not linked to the action that moved it; the records and the actions below share only the window.');
      break;
    }
    case 'observed': {
      if (measure.source.actions) {
        const ids = measure.source.actions;
        const executed = proposals.filter(p => p.status === 'done' && ids.includes(p.actionId) && p.executedAt && new Date(p.executedAt) >= range.since && new Date(p.executedAt) < range.until);
        outcomeItems.push(...executed.map(proposalItem));
        outcomeBasis = `${ids.join(', ')} actions that executed in the window`;
      } else {
        const key = measure.source.counts!;
        const completed = runs.filter(r => r.status === 'completed' && r.counts && key in r.counts);
        outcomeItems.push(...runItems.filter(i => completed.some(r => `run:${r.id}` === i.id)));
        outcomeBasis = `completed runs that reported \`${key}\``;
      }
      break;
    }
    case 'human-confirmed': {
      const ids = measure.source.actions ?? [];
      const kinds = measure.source.askKinds ?? [];
      outcomeItems.push(...approvedProposals.filter(p => ids.includes(p.actionId)).map(proposalItem));
      outcomeItems.push(...approvedAsks.filter(a => kinds.includes(a.kind)).map((a): LineageItem => ({ id: `ask:${a.id}`, title: a.title, href: `/dashboard/inbox/${a.id}`, at: new Date(a.createdAt), detail: `${a.kind} · ${a.decision ?? a.status}` })));
      outcomeBasis = [ids.length > 0 ? `${ids.join(', ')} proposals a person approved` : null, kinds.length > 0 ? `${kinds.join(', ')} asks answered` : null].filter(Boolean).join(' + ');
      break;
    }
    case 'agent-reported': {
      const key = measure.source.counts;
      const reporting = runs.filter(r => r.counts && key in r.counts);
      outcomeItems.push(...reporting.map(r => ({ ...runItems.find(i => i.id === `run:${r.id}`)!, detail: `reported ${key}: ${r.counts[key]}` })));
      outcomeBasis = `Σ \`${key}\` the workers reported — the worker grades itself here; nothing independent confirms these`;
      missing.push('An agent-reported count is the worker\'s own claim. No artifact, decision or external record is tied to it.');
      break;
    }
  }
  if (proposals.length > 0 && runs.length > 0) {
    missing.push('A proposal is not linked to the run that made it; recommendations and runs share the team and the window.');
  }
  if (proposals.length === 0 && measure.source.kind !== 'agent-reported') {
    missing.push('No proposals from this team in the window — nothing to trace a decision through.');
  }

  const unit = measure.unit ? ` ${measure.unit}` : '';
  const display = reading.value === null ? '—' : measure.unit === '$' ? usd(reading.value * 100) : `${Number.isInteger(reading.value) ? reading.value : reading.value.toFixed(1)}${unit}`;
  const take = (items: LineageItem[]) => ({ items: items.slice(0, ITEM_LIMIT), more: Math.max(0, items.length - ITEM_LIMIT) });

  const nodes: LineageNode[] = [
    { id: 'outcomes', label: measure.label, display, value: reading.value, basis: outcomeBasis, ...take(outcomeItems) },
    { id: 'approved', label: 'Approved items', display: String(approvedItems.length), value: approvedItems.length, basis: 'proposals a person approved or edited, and asks answered, in the window', ...take(approvedItems) },
    { id: 'recommendations', label: 'Recommendations', display: String(proposals.length), value: proposals.length, basis: 'actions the team\'s agents proposed in the window', ...take(proposals.map(proposalItem)) },
    { id: 'runs', label: 'Agent runs', display: String(runs.length), value: runs.length, basis: 'worker runs by the team\'s agents in the window', ...take(runItems) },
    { id: 'cost', label: 'Model and tool cost', display: usd(cents), value: cents, basis: 'Σ worker_run.cents over those runs — an action carries no cost of its own', items: [], more: 0 },
    { id: 'human', label: 'Human review', display: humanN === 0 ? '—' : minutes(humanMs), value: humanN === 0 ? null : humanMs, basis: `decision latency over ${humanN} decided item${humanN === 1 ? '' : 's'}, capped at ${DECISION_LATENCY_CAP_MS / 3_600_000}h each — nothing records when a person first looked`, items: [], more: 0 },
  ];

  return { teamSlug, teamName: team.name, measure, reading, window: measure.window, range, nodes, missing };
}
