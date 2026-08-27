/**
 * PersonalizationQueueService — the phase-1 personalization lane: new MQLs
 * become rows on the `lead_brief` queue and nothing else happens.
 *
 * Two structural guarantees, both here rather than in a prompt:
 *
 *   - **Nothing is invented.** `queueLeads` takes CRM mirror refs, re-reads
 *     those records itself through `queryCrmRecords`, and writes only what the
 *     mirror carries. The caller cannot hand it a name, a company, or an
 *     entrance path, so a phase-1 row can never contain research that was
 *     never done. `claims`, `missing` and `draftSequence` stay at their empty
 *     defaults and `confidence` stays null until the research slice ships.
 *   - **A re-fire is a no-op.** There is no de-duplication logic; the insert
 *     runs ON CONFLICT DO NOTHING against `lead_brief_org_contact_idx`, so the
 *     unique index is the guarantee. DO NOTHING rather than DO UPDATE on
 *     purpose: a later re-fire must not wipe a researched brief back to empty.
 *
 * The CRM read is the same one `get_hubspot_contacts` uses, so arrivals here
 * and counts there can never disagree.
 */

import type { CrmRecord } from '@/services/CrmRecordsService';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { leadBriefSchema } from '@/models/Schema';
import { queryCrmRecords } from '@/services/CrmRecordsService';

/**
 * Model id + prompt version, the stamp `lead_brief.brief_version` carries.
 * Phase 1 runs no model, and saying so is the point: `queue-only` marks every
 * row that was recorded without a research pass behind it.
 */
export const QUEUE_BRIEF_VERSION = 'queue-only#personalization-v1';

/** The lane a phase-1 row lands in. Nothing to review until research runs. */
export const QUEUED_STATUS = 'queued';

/** Mirror pages are capped; this bounds a reconciliation sweep. */
const MAX_ARRIVALS = 2000;
const PAGE = 200;
/** Trailing window when the caller names neither a window nor a start date. */
const DEFAULT_SINCE_DAYS = 7;

export type BriefedBy = { agentSlug?: string; missionRunId?: number; userId?: string };

export type QueueLeadsOptions = {
  contactRefs: string[];
  /** Why the sweep picked it up. Phase 1 only ever queues fresh arrivals. */
  triggerType?: string;
  briefedBy?: BriefedBy;
  allowedSourceSlugs?: string[];
  now?: Date;
};

export type QueuedLead = {
  contactRef: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  entranceSource: string | null;
  utmCampaign: string | null;
  arrivedAt: string | null;
};

export type QueueLeadsResult = {
  requested: number;
  queued: number;
  alreadyQueued: number;
  /** Refs with no record in the CRM mirror — nothing was written for these. */
  notInMirror: string[];
  /** Total rows on the queue after this call, across every lane. */
  queueTotal: number;
  leads: QueuedLead[];
};

export type LedgerRow = {
  id: number;
  contactRef: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  triggerType: string;
  entranceSource: string | null;
  utmCampaign: string | null;
  engagementSent: number;
  engagementOpened: number;
  status: string;
  confidence: number | null;
  claimCount: number;
  briefVersion: string | null;
  skippedReason: string | null;
  arrivedAt: Date | null;
  briefedAt: Date | null;
};

export type MqlGap = {
  contactRef: string;
  contactName: string | null;
  companyName: string | null;
  arrivedAt: string | null;
  kind: 'unqueued';
  detail: string;
};

export type MqlReconciliation = {
  window: { since: string | null; until: string | null };
  lifecycleStages: string[];
  /** Arrivals recomputed from the mirror for this window. */
  arrivals: number;
  /** Arrivals that already carry a `lead_brief` row. */
  queued: number;
  gapCount: number;
  gaps: MqlGap[];
  /** True when the window held more arrivals than one sweep reads. */
  truncated: boolean;
  asOf: string | null;
  sourcesRead: string[];
  note: string;
};

/** A filter value the mirror does not hold — the caller must retry, not report a zero. */
export class UnknownStageError extends Error {
  constructor(
    readonly requested: string[],
    readonly notFound: string[],
    readonly available: Record<string, number>,
  ) {
    super(`lifecycle stage(s) not present in the CRM: ${notFound.join(', ')}`);
    this.name = 'UnknownStageError';
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The CRM create date, or null when the mirror does not carry a usable one.
 * @param rec
 */
function arrivedAt(rec: CrmRecord): Date | null {
  const raw = str(rec.createdAt);
  if (!raw) {
    return null;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The mirror record, projected onto the columns the queue renders.
 * @param rec
 * @param opts
 * @param opts.orgId
 * @param opts.triggerType
 * @param opts.briefedAt
 * @param opts.briefedBy
 * @param opts.workspaceSha
 */
function toRow(rec: CrmRecord, opts: { orgId: string; triggerType: string; briefedAt: Date; briefedBy?: BriefedBy; workspaceSha: string | null }) {
  return {
    orgId: opts.orgId,
    contactRef: rec.ref,
    contactName: rec.name ?? str(rec.primaryEmail) ?? rec.ref,
    contactTitle: str(rec.jobTitle),
    companyName: str(rec.company),
    triggerType: opts.triggerType,
    // HubSpot's original-source pair is the entrance path the mirror carries.
    entranceSource: str(rec.originalSource),
    utmCampaign: str(rec.originalSourceDetail),
    engagementSent: num(rec.emailDelivered),
    engagementOpened: num(rec.emailOpened),
    status: QUEUED_STATUS,
    briefVersion: QUEUE_BRIEF_VERSION,
    workspaceSha: opts.workspaceSha,
    briefedBy: opts.briefedBy,
    arrivedAt: arrivedAt(rec),
    briefedAt: opts.briefedAt,
  };
}

/**
 * Read the named contacts from the CRM mirror and put each on the queue.
 * @param orgId
 * @param opts
 */
export async function queueLeads(orgId: string, opts: QueueLeadsOptions): Promise<QueueLeadsResult> {
  const refs = [...new Set(opts.contactRefs)];
  const briefedAt = opts.now ?? new Date();

  const found: CrmRecord[] = [];
  for (let offset = 0; offset < refs.length; offset += PAGE) {
    const page = await queryCrmRecords(orgId, 'contacts', {
      refs: refs.slice(offset, offset + PAGE),
      limit: PAGE,
      allowedSourceSlugs: opts.allowedSourceSlugs,
    });
    found.push(...page.records);
  }
  const foundRefs = new Set(found.map(r => r.ref));

  const { getCurrentWorkspaceSha } = await import('@/libs/workspace');
  const workspaceSha = await getCurrentWorkspaceSha(orgId).catch(() => null);

  const values = found.map(rec => toRow(rec, {
    orgId,
    triggerType: opts.triggerType ?? 'new',
    briefedAt,
    briefedBy: opts.briefedBy,
    workspaceSha,
  }));

  // The unique index IS the de-duplication. DO NOTHING, never DO UPDATE: a
  // re-fire must leave an already-researched brief exactly as it found it.
  const inserted = values.length === 0
    ? []
    : await db
        .insert(leadBriefSchema)
        .values(values)
        .onConflictDoNothing({ target: [leadBriefSchema.orgId, leadBriefSchema.contactRef] })
        .returning({ contactRef: leadBriefSchema.contactRef });
  const insertedRefs = new Set(inserted.map(r => r.contactRef));

  const [total] = await db
    .select({ n: count() })
    .from(leadBriefSchema)
    .where(eq(leadBriefSchema.orgId, orgId));

  const byRef = new Map(found.map(r => [r.ref, r]));
  return {
    requested: refs.length,
    queued: inserted.length,
    alreadyQueued: found.length - inserted.length,
    notInMirror: refs.filter(r => !foundRefs.has(r)),
    queueTotal: total?.n ?? 0,
    leads: [...insertedRefs].map((ref) => {
      const rec = byRef.get(ref)!;
      return {
        contactRef: ref,
        contactName: rec.name ?? str(rec.primaryEmail) ?? ref,
        contactTitle: str(rec.jobTitle),
        companyName: str(rec.company),
        entranceSource: str(rec.originalSource),
        utmCampaign: str(rec.originalSourceDetail),
        arrivedAt: str(rec.createdAt),
      };
    }),
  };
}

/**
 * Read the queue back — what a re-fire needs to see about its own past runs.
 * @param orgId
 * @param opts
 * @param opts.status
 * @param opts.limit
 */
export async function leadLedger(
  orgId: string,
  opts: { status?: string; limit?: number } = {},
): Promise<{ count: number; total: number; leads: LedgerRow[] }> {
  const conds = [eq(leadBriefSchema.orgId, orgId)];
  if (opts.status) {
    conds.push(eq(leadBriefSchema.status, opts.status));
  }
  const where = and(...conds);

  // Count first: the page is a page, and only the total answers "how many".
  const [total] = await db.select({ n: count() }).from(leadBriefSchema).where(where);

  const rows = await db
    .select({
      id: leadBriefSchema.id,
      contactRef: leadBriefSchema.contactRef,
      contactName: leadBriefSchema.contactName,
      contactTitle: leadBriefSchema.contactTitle,
      companyName: leadBriefSchema.companyName,
      triggerType: leadBriefSchema.triggerType,
      entranceSource: leadBriefSchema.entranceSource,
      utmCampaign: leadBriefSchema.utmCampaign,
      engagementSent: leadBriefSchema.engagementSent,
      engagementOpened: leadBriefSchema.engagementOpened,
      status: leadBriefSchema.status,
      confidence: leadBriefSchema.confidence,
      claims: leadBriefSchema.claims,
      briefVersion: leadBriefSchema.briefVersion,
      skippedReason: leadBriefSchema.skippedReason,
      arrivedAt: leadBriefSchema.arrivedAt,
      briefedAt: leadBriefSchema.briefedAt,
    })
    .from(leadBriefSchema)
    .where(where)
    .orderBy(desc(leadBriefSchema.briefedAt), desc(leadBriefSchema.id))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));

  const leads = rows.map(({ claims, ...rest }) => ({ ...rest, claimCount: claims.length }));
  return { count: leads.length, total: total?.n ?? 0, leads };
}

/**
 * Coverage check: recompute the window's arrivals from the CRM mirror and diff
 * them against the queue. Every arrival without a row is named.
 * @param orgId
 * @param opts
 * @param opts.lifecycleStages
 * @param opts.sinceDays
 * @param opts.createdAfter
 * @param opts.createdBefore
 * @param opts.allowedSourceSlugs
 */
export async function reconcileMqlWindow(
  orgId: string,
  opts: {
    lifecycleStages: string[];
    /** Trailing window in days, resolved on the server clock. Wins over createdAfter. */
    sinceDays?: number;
    createdAfter?: string;
    createdBefore?: string;
    allowedSourceSlugs?: string[];
  },
): Promise<MqlReconciliation> {
  const arrivals: CrmRecord[] = [];
  let truncated = false;
  let asOf: Date | null = null;
  let sources: string[] = [];
  let since: string | null = null;

  // An unbounded window would reconcile the whole CRM against a queue that
  // only ever covers recent arrivals, reporting years of old leads as gaps.
  // An explicit createdAfter is honored; otherwise the window is trailing.
  const sinceDays = opts.sinceDays ?? (opts.createdAfter ? undefined : DEFAULT_SINCE_DAYS);

  for (let offset = 0; offset < MAX_ARRIVALS; offset += PAGE) {
    const page = await queryCrmRecords(orgId, 'contacts', {
      lifecycleStages: opts.lifecycleStages,
      createdWithinDays: sinceDays,
      createdAfter: opts.createdAfter,
      createdBefore: opts.createdBefore,
      limit: PAGE,
      offset,
      allowedSourceSlugs: opts.allowedSourceSlugs,
    });

    // A stage the mirror does not hold would silently reconcile to zero gaps,
    // which reads as full coverage. Refuse instead.
    const unknown = page.unknownFilterValues.lifecycleStage;
    if (unknown) {
      throw new UnknownStageError(unknown.requested, unknown.notFound, page.facets.lifecycleStage ?? {});
    }

    asOf = page.asOf;
    sources = page.sources;
    since = page.createdAfter;
    arrivals.push(...page.records);
    if (!page.hasMore) {
      break;
    }
    if (offset + PAGE >= MAX_ARRIVALS) {
      truncated = true;
    }
  }

  const refs = arrivals.map(r => r.ref);
  const rows = refs.length === 0
    ? []
    : await db
        .select({ contactRef: leadBriefSchema.contactRef })
        .from(leadBriefSchema)
        .where(and(eq(leadBriefSchema.orgId, orgId), inArray(leadBriefSchema.contactRef, refs)));
  const queued = new Set(rows.map(r => r.contactRef));

  const gaps: MqlGap[] = arrivals
    .filter(r => !queued.has(r.ref))
    .map(r => ({
      contactRef: r.ref,
      contactName: r.name,
      companyName: str(r.company),
      arrivedAt: str(r.createdAt),
      kind: 'unqueued' as const,
      detail: 'arrived in the window and is still at this lifecycle stage, but has no queue row',
    }));

  return {
    window: { since, until: opts.createdBefore ?? null },
    lifecycleStages: opts.lifecycleStages,
    arrivals: arrivals.length,
    queued: arrivals.length - gaps.length,
    gapCount: gaps.length,
    gaps,
    truncated,
    asOf: asOf ? asOf.toISOString() : null,
    sourcesRead: sources,
    note: 'Arrivals are contacts CREATED in this window that are at the named stage now, which is not the same as contacts that ENTERED that stage in the window. The mirror does not carry a stage-entry date.',
  };
}

/**
 * TEMPORARY (phase 2 removes this). Clear the queue for one org so the flow
 * can be re-run; the unique index makes a second test impossible otherwise.
 * Scoped to the caller's org, and touches `lead_brief` only.
 * @param orgId
 */
export async function resetQueue(orgId: string): Promise<{ deleted: number }> {
  const deleted = await db
    .delete(leadBriefSchema)
    .where(eq(leadBriefSchema.orgId, orgId))
    .returning({ id: leadBriefSchema.id });
  return { deleted: deleted.length };
}
