/**
 * Evidence chains — one line per completed outcome, as far as the record
 * goes (docs/specs/team-report-v2.md §13):
 *
 *   artifact / action · human decision · resulting external event · cost
 *
 * Built from `action_run` (the action and what it did) → `decision_alignment`
 * (what a person decided) → the synced CRM record the action touched (what
 * the system of record says NOW). Where a link is missing the line says so —
 * an action carries no cost of its own, and a CRM change is only shown when
 * a synced record exists for the id the action named.
 */

import type { Range } from './measures';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, decisionAlignmentSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';
import { isHubspotSource } from '@/services/CrmRecordsService';
import { describeActionRun } from '@/services/inbox/describeActionRun';
import { actionAgentSlug } from './humanLoad';
import { personNames } from './lineage';

export type OutcomeChain = {
  actionRunId: number;
  actionId: string;
  /** "Proposal: Acme expansion", from the action's own description. */
  title: string;
  /** "CRM update", "Email", "Enrollment". */
  actionKind: string;
  agentSlug: string | null;
  /** The record the action was about, when the payload named one. */
  record: { kind: string; name: string; hubspotId: string | null } | null;
  /** What a person did — or that nobody had to. */
  decision: { kind: 'approved' | 'edited' | 'rejected' | 'auto-executed'; by: string | null; at: Date | null };
  executedAt: Date | null;
  /** What the system of record shows for that record now; null when no synced record exists. */
  externalEvent: { summary: string; asOf: Date | null } | null;
  /** Per-action cost is not recorded — always null today, said out loud on the line. */
  costCents: number | null;
};

const HUBSPOT_ID_KEYS = ['hubspotId', 'objectId', 'dealId', 'contactId', 'companyId', 'id'] as const;

/**
 * The HubSpot id an action's payload or result names, if any.
 * @param run - Input and result of an action_run.
 * @param run.input
 * @param run.result
 */
export function hubspotIdOf(run: { input: Record<string, unknown> | null; result: Record<string, unknown> | null }): string | null {
  for (const bag of [run.result, run.input]) {
    if (!bag) {
      continue;
    }
    for (const k of HUBSPOT_ID_KEYS) {
      const v = bag[k];
      if (typeof v === 'string' && /^\d+$/.test(v)) {
        return v;
      }
      if (typeof v === 'number' && Number.isInteger(v)) {
        return String(v);
      }
    }
  }
  return null;
}

/**
 * Executed actions by the teams' agents in the window, newest first, up to
 * `limit` per team, each with its decision and any synced CRM state.
 * @param orgId - Tenant.
 * @param teams - Team → agent slugs.
 * @param range - The window.
 * @param limit - Per team.
 */
export async function readOutcomeChains(orgId: string, teams: { slug: string; agentSlugs: string[] }[], range: Range, limit = 6): Promise<Map<string, OutcomeChain[]>> {
  const out = new Map<string, OutcomeChain[]>(teams.map(t => [t.slug, []]));
  const allAgents = [...new Set(teams.flatMap(t => t.agentSlugs))];
  if (allAgents.length === 0) {
    return out;
  }
  const rows = await db.select({
    id: actionRunSchema.id,
    actionId: actionRunSchema.actionId,
    input: actionRunSchema.input,
    result: actionRunSchema.result,
    proposal: actionRunSchema.proposal,
    invokedBy: actionRunSchema.invokedBy,
    status: actionRunSchema.status,
    decidedBy: actionRunSchema.decidedBy,
    decidedAt: actionRunSchema.decidedAt,
    executedAt: actionRunSchema.executedAt,
    agentSlug: actionAgentSlug,
    autoApproved: sql<boolean>`coalesce((${actionRunSchema.proposal} ->> 'autoApproved')::boolean, false)`,
  })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.status, 'done'),
      sql`${actionAgentSlug} in (${sql.join(allAgents.map(s => sql`${s}`), sql`, `)})`,
      gte(actionRunSchema.executedAt, range.since),
      lt(actionRunSchema.executedAt, range.until),
    ))
    .orderBy(desc(actionRunSchema.executedAt))
    .limit(limit * teams.length * 2);
  if (rows.length === 0) {
    return out;
  }

  const [decisions, crm] = await Promise.all([
    db.select({ subjectId: decisionAlignmentSchema.subjectId, decision: decisionAlignmentSchema.decision, decidedBy: decisionAlignmentSchema.decidedBy, decidedAt: decisionAlignmentSchema.decidedAt })
      .from(decisionAlignmentSchema)
      .where(and(eq(decisionAlignmentSchema.orgId, orgId), eq(decisionAlignmentSchema.subjectKind, 'action'), inArray(decisionAlignmentSchema.subjectId, rows.map(r => r.id)), inArray(decisionAlignmentSchema.decision, ['approved', 'edited', 'rejected']))),
    readCrmState(orgId, rows.map(r => hubspotIdOf(r)).filter((x): x is string => x !== null)),
  ]);
  const decisionOf = new Map<number, { decision: string; decidedBy: string | null; decidedAt: Date }>();
  for (const d of decisions) {
    const prev = decisionOf.get(d.subjectId);
    if (!prev || (d.decision === 'edited' && prev.decision === 'approved')) {
      decisionOf.set(d.subjectId, { decision: d.decision, decidedBy: d.decidedBy, decidedAt: new Date(d.decidedAt) });
    }
  }
  const names = await personNames(orgId, [...decisions.map(d => d.decidedBy), ...rows.map(r => r.decidedBy)]);
  const who = (id: string | null) => (id ? names.get(id) ?? id : null);
  const teamOf = new Map<string, string>();
  for (const t of teams) {
    for (const a of t.agentSlugs) {
      teamOf.set(a, t.slug);
    }
  }

  for (const r of rows) {
    const teamSlug = r.agentSlug ? teamOf.get(r.agentSlug) : undefined;
    if (!teamSlug) {
      continue;
    }
    const list = out.get(teamSlug)!;
    if (list.length >= limit) {
      continue;
    }
    const d = describeActionRun({ id: r.id, actionId: r.actionId, input: r.input, proposal: r.proposal, invokedBy: r.invokedBy });
    const dec = decisionOf.get(r.id);
    const hubspotId = hubspotIdOf(r);
    const state = hubspotId ? crm.get(hubspotId) ?? null : null;
    list.push({
      actionRunId: r.id,
      actionId: r.actionId,
      title: d.title,
      actionKind: d.actionKind,
      agentSlug: r.agentSlug,
      record: d.record ? { kind: d.record.kind, name: d.record.name, hubspotId } : null,
      decision: r.autoApproved && !dec
        ? { kind: 'auto-executed', by: null, at: r.executedAt ? new Date(r.executedAt) : null }
        : { kind: (dec?.decision as 'approved' | 'edited' | 'rejected' | undefined) ?? 'approved', by: who(dec?.decidedBy ?? r.decidedBy ?? null), at: dec?.decidedAt ?? (r.decidedAt ? new Date(r.decidedAt) : null) },
      executedAt: r.executedAt ? new Date(r.executedAt) : null,
      externalEvent: state,
      costCents: null,
    });
  }
  return out;
}

/**
 * What the HubSpot mirror holds for these ids right now — stage for a deal,
 * lifecycle stage for a contact — with the mirror's sync time. One query.
 * @param orgId
 * @param hubspotIds
 */
async function readCrmState(orgId: string, hubspotIds: string[]): Promise<Map<string, { summary: string; asOf: Date | null }>> {
  const ids = [...new Set(hubspotIds)];
  const out = new Map<string, { summary: string; asOf: Date | null }>();
  if (ids.length === 0) {
    return out;
  }
  const rows = await db.select({
    hubspotId: sql<string>`${knowledgeDocumentSchema.metadata} ->> 'hubspotId'`,
    objectType: sql<string | null>`${knowledgeDocumentSchema.metadata} ->> 'objectType'`,
    stage: sql<string | null>`coalesce(${knowledgeDocumentSchema.metadata} ->> 'dealStageLabel', ${knowledgeDocumentSchema.metadata} ->> 'lifecycleStage')`,
    lastSyncedAt: knowledgeSourceSchema.lastSyncedAt,
    lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
  })
    .from(knowledgeDocumentSchema)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeDocumentSchema.sourceId, knowledgeSourceSchema.id))
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      isHubspotSource,
      sql`${knowledgeDocumentSchema.metadata} ->> 'hubspotId' in (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`,
    ));
  for (const r of rows) {
    const noun = r.objectType === 'deals' ? 'Deal' : r.objectType === 'contacts' ? 'Contact' : r.objectType === 'companies' ? 'Company' : 'Record';
    out.set(r.hubspotId, {
      summary: r.stage ? `${noun} now at ${r.stage}` : `${noun} present in HubSpot`,
      asOf: r.lastSyncedAt ? new Date(r.lastSyncedAt) : r.lastModifiedAt ? new Date(r.lastModifiedAt) : null,
    });
  }
  return out;
}
