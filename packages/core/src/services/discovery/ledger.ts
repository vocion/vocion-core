/**
 * The Discovery Ledger's read model — one row per assessed call, carrying the
 * THREE dimensions the ledger is about and nothing collapsed between them:
 *
 *   1. classification      what Vocion decided the call is
 *   2. recommended action  what it proposed doing about it
 *   3. human disposition   what a person did with that
 *
 * plus the entities the meeting is actually with, and the telemetry that
 * belongs behind a disclosure rather than in the row.
 *
 * Disposition is read from `decision_alignment` — the same ledger the inbox
 * writes on every decision — so the agreement rate here is the platform's
 * agreement rate, not a second number computed a second way
 * (`services/discovery/disposition.ts`).
 */

import type { ReadClassification, Route } from './classification';
import type { Disposition } from './disposition';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, decisionAlignmentSchema, discoveryCandidateSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';
import { readClassification, recommendedAction } from './classification';
import { dispositionOf } from './disposition';

/** Who the meeting was actually with. An email address is not a company. */
export type DiscoveryEntities = {
  /** The CRM opportunity the meeting matched, when it matched a deal. */
  opportunity: { label: string; ref: string; href?: string } | null;
  /** The account, when CRM resolution produced a real one. */
  account: { label: string; ref: string | null; href?: string } | null;
  /**
   * False when the match resolved to an email address or a bare domain. The
   * row then says "Account not resolved" and shows `unresolvedKnown` — which
   * is safer than rendering an email under the word "Company".
   */
  accountResolved: boolean;
  /** What IS known when the account is not: the contact's email, the external domain. */
  unresolvedKnown: string | null;
  /** The external domain a seller-hosted call matched on — a referral signal, not a CRM fact. */
  sponsorDomain: string | null;
  /** Meeting attendees, split by whether they are on the seller's own domain. */
  attendees: Array<{ email: string; external: boolean }>;
};

export type DiscoveryLedgerEntry = {
  id: number;
  /** The meeting, named for a human. */
  title: string;
  meetingExternalId: string;
  when: string | null;
  matchedAt: string;
  classifiedAt: string | null;
  matchReason: string | null;
  /** Lifecycle: matched | classified | routed | dropped. */
  status: string;
  route: Route | null;
  recommendedAction: ReturnType<typeof recommendedAction>;
  classification: ReadClassification | null;
  disposition: Disposition;
  /** What the person actually chose, when the inbox recorded it. */
  humanDecision: string | null;
  humanDecidedBy: string | null;
  entities: DiscoveryEntities;
  thresholds: { discovery: number; ready: number } | null;
  skippedReason: string | null;
  classifierVersion: string | null;
  assessedBy: { agentSlug?: string; missionRunId?: number; userId?: string } | null;
  transcriptHash: string | null;
  workspaceSha: string | null;
  reviewActionRunId: number | null;
  reviewStatus: string | null;
};

const HUBSPOT_TYPE_CODE: Record<string, string> = { contacts: '0-1', companies: '0-2', deals: '0-3' };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function looksLikeEmail(v: string | null): boolean {
  return v !== null && v.includes('@');
}

/**
 * Build the entity block from what the matcher recorded plus the CRM document
 * it matched. Never promotes an email or a domain to a company name — the
 * whole point of `accountResolved`.
 * @param matchRef - `deals:123` / `contacts:9` / `companies:5`, or a bare domain.
 * @param matchType
 * @param crm - The matched CRM document's metadata + title, when there is one.
 * @param attendees - Meeting attendee emails.
 * @param sellerDomain - The seller's own email domain, for the internal/external split.
 * @param portalId - HubSpot portal id, for the deep link.
 */
export function entitiesFor(
  matchRef: string | null,
  matchType: string,
  crm: { metadata: Record<string, unknown>; title: string | null } | null,
  attendees: string[],
  sellerDomain: string | null,
  portalId: string | null,
): DiscoveryEntities {
  const split = attendees.map(email => ({
    email,
    external: !sellerDomain || !email.toLowerCase().endsWith(`@${sellerDomain.toLowerCase()}`),
  }));
  const refMatch = matchRef ? /^(contacts|companies|deals):(.+)$/.exec(matchRef) : null;

  if (!refMatch) {
    // Calendly-external: a domain, and nothing in the CRM yet.
    return {
      opportunity: null,
      account: null,
      accountResolved: false,
      unresolvedKnown: matchRef ?? split.find(a => a.external)?.email ?? null,
      sponsorDomain: matchType === 'calendly-external' ? matchRef : null,
      attendees: split,
    };
  }

  const objectType = refMatch[1]!;
  const hubspotId = refMatch[2]!;
  const meta = crm?.metadata ?? {};
  const href = portalId
    ? `https://app.hubspot.com/contacts/${portalId}/record/${HUBSPOT_TYPE_CODE[objectType]}/${hubspotId}`
    : undefined;

  const company = str(meta.company) ?? (objectType === 'companies' ? str(meta.name) ?? str(crm?.title ?? null) : null);
  const dealName = objectType === 'deals' ? str(meta.name) ?? str(crm?.title ?? null) : null;
  const known = str(meta.primaryEmail) ?? str(meta.domain) ?? str(meta.name) ?? str(crm?.title ?? null) ?? matchRef;

  return {
    opportunity: dealName ? { label: company ? `${dealName} / ${company}` : dealName, ref: matchRef!, href } : null,
    account: company ? { label: company, ref: matchRef, href } : null,
    // An email is not a company; a deal with no company on it has no account.
    accountResolved: company !== null && !looksLikeEmail(company),
    unresolvedKnown: company ? null : known,
    sponsorDomain: null,
    attendees: split,
  };
}

/**
 * Load the ledger for one org: candidates, their human decisions, and the
 * entities behind each match. One pass, no N+1 — the CRM and meeting documents
 * are fetched in two `IN` queries keyed on what the candidates reference.
 * @param orgId
 * @param opts
 * @param opts.limit - Rows to read, newest match first. Default 200.
 * @param opts.sellerDomain - The seller's own domain, for the attendee split.
 */
export async function loadDiscoveryLedger(
  orgId: string,
  opts: { limit?: number; sellerDomain?: string | null } = {},
): Promise<DiscoveryLedgerEntry[]> {
  const rows = await db
    .select({ candidate: discoveryCandidateSchema, reviewStatus: actionRunSchema.status })
    .from(discoveryCandidateSchema)
    .leftJoin(actionRunSchema, eq(actionRunSchema.id, discoveryCandidateSchema.reviewActionRunId))
    .where(eq(discoveryCandidateSchema.orgId, orgId))
    .orderBy(desc(discoveryCandidateSchema.matchedAt))
    .limit(opts.limit ?? 200);

  if (rows.length === 0) {
    return [];
  }

  // The human side, from the ledger the inbox already writes.
  const runIds = rows.map(r => r.candidate.reviewActionRunId).filter((n): n is number => n !== null);
  const alignments = runIds.length === 0
    ? []
    : await db
        .select({
          subjectId: decisionAlignmentSchema.subjectId,
          decision: decisionAlignmentSchema.decision,
          agreed: decisionAlignmentSchema.agreed,
          decidedBy: decisionAlignmentSchema.decidedBy,
          decidedAt: decisionAlignmentSchema.decidedAt,
        })
        .from(decisionAlignmentSchema)
        .where(and(
          eq(decisionAlignmentSchema.orgId, orgId),
          eq(decisionAlignmentSchema.subjectKind, 'action'),
          inArray(decisionAlignmentSchema.subjectId, runIds),
        ))
        .orderBy(decisionAlignmentSchema.decidedAt);
  // Last decision wins: the unique index is per (subject, decision), so a
  // re-decided run legitimately has more than one row.
  const alignmentByRun = new Map(alignments.map(a => [a.subjectId, a]));

  // The CRM documents the matches point at, and the meeting documents the
  // attendees live on — two `IN` queries, not one per row.
  const crmRefs = [...new Set(rows.map(r => r.candidate.matchRef).filter((s): s is string => Boolean(s && /^(?:contacts|companies|deals):/.test(s))))];
  const crmDocs = crmRefs.length === 0
    ? []
    : await db
        .select({ externalId: knowledgeDocumentSchema.externalId, metadata: knowledgeDocumentSchema.metadata, title: knowledgeDocumentSchema.title })
        .from(knowledgeDocumentSchema)
        .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.externalId, crmRefs)));
  const crmByRef = new Map(crmDocs.map(d => [d.externalId, { metadata: (d.metadata ?? {}) as Record<string, unknown>, title: d.title }]));

  const docIds = [...new Set(rows.map(r => r.candidate.meetingDocId).filter((n): n is number => n !== null))];
  const meetingDocs = docIds.length === 0
    ? []
    : await db
        .select({ id: knowledgeDocumentSchema.id, metadata: knowledgeDocumentSchema.metadata })
        .from(knowledgeDocumentSchema)
        .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.id, docIds)));
  const attendeesByDoc = new Map(meetingDocs.map(d => [
    d.id,
    (((d.metadata ?? {}) as Record<string, unknown>).attendees as unknown[] ?? [])
      .filter((a): a is string => typeof a === 'string'),
  ]));

  const [source] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, 'hubspot')))
    .limit(1);
  const portalId = (source?.configJson as { portalId?: string | number } | null)?.portalId;

  return rows.map(({ candidate: c, reviewStatus }) => {
    const alignment = c.reviewActionRunId === null ? undefined : alignmentByRun.get(c.reviewActionRunId);
    const disposition = dispositionOf({
      reviewStatus: c.reviewActionRunId === null ? null : reviewStatus ?? null,
      decision: alignment?.decision ?? null,
      agreed: alignment?.agreed ?? null,
    });
    const route = (c.route ?? null) as Route | null;
    return {
      id: c.id,
      title: c.meetingTitle ?? c.meetingExternalId,
      meetingExternalId: c.meetingExternalId,
      when: c.meetingStart?.toISOString() ?? null,
      matchedAt: c.matchedAt.toISOString(),
      classifiedAt: c.classifiedAt?.toISOString() ?? null,
      matchReason: c.matchReason,
      status: c.status,
      route,
      recommendedAction: recommendedAction(route),
      classification: readClassification(c.classification),
      disposition,
      humanDecision: alignment?.decision ?? null,
      humanDecidedBy: alignment?.decidedBy ?? null,
      entities: entitiesFor(
        c.matchRef,
        c.matchType,
        c.matchRef ? crmByRef.get(c.matchRef) ?? null : null,
        c.meetingDocId === null ? [] : attendeesByDoc.get(c.meetingDocId) ?? [],
        opts.sellerDomain ?? null,
        portalId === undefined || portalId === null ? null : String(portalId),
      ),
      thresholds: c.thresholds,
      skippedReason: c.skippedReason,
      classifierVersion: c.classifierVersion,
      assessedBy: c.assessedBy,
      transcriptHash: c.transcriptHash,
      workspaceSha: c.workspaceSha,
      reviewActionRunId: c.reviewActionRunId,
      reviewStatus: reviewStatus ?? null,
    };
  });
}
