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
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { leadBriefSchema } from '@/models/Schema';
import { queryCrmRecords } from '@/services/CrmRecordsService';

/**
 * Model id + prompt version, the stamp `lead_brief.brief_version` carries.
 * Phase 1 runs no model, and saying so is the point: `queue-only` marks every
 * row that was recorded without a research pass behind it.
 */
export const QUEUE_BRIEF_VERSION = 'queue-only#personalization-v1';

/** The lane a row lands in before a brief exists. Not a lane the page shows. */
export const QUEUED_STATUS = 'queued';

/** The lane a brief lands in, and the only one the sweep ever moves a lead to. */
export const REVIEW_STATUS = 'ready_for_review';

/**
 * Tries before a lead surfaces unbriefed: the first run and two retries. A
 * failure about to fix itself is not worth a reviewer's attention, so a lead
 * mid-retry stays off the screen; the third failure puts it in Review with
 * whatever the run reported and ends the retries.
 *
 * Failures are NOT classified into transient and permanent. A timeout and an
 * unresearchable record take the same path and the difference shows in the
 * error text a person reads.
 */
export const MAX_BRIEF_ATTEMPTS = 3;

/** Coverage record on a lead that ran out of tries. */
export const BRIEF_FAILED_REASON = 'brief-failed';

/**
 * Floor between tries. The sweep is hourly, so this never delays a scheduled
 * retry; it stops one run from spending all three tries in a minute.
 */
const RETRY_FLOOR_MINUTES = 30;

/** What a reviewer sees when the run died without reporting anything. */
const NO_ERROR_REPORTED = 'The briefing run ended without producing a brief and without reporting an error. Nothing is known beyond that it did not finish.';

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
  /** False means no brief has been written, whatever else the row carries. */
  hasBrief: boolean;
  briefAttempts: number;
  briefError: string | null;
  regenerateNote: string | null;
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
      sections: leadBriefSchema.sections,
      briefAttempts: leadBriefSchema.briefAttempts,
      briefError: leadBriefSchema.briefError,
      regenerateNote: leadBriefSchema.regenerateNote,
      briefVersion: leadBriefSchema.briefVersion,
      skippedReason: leadBriefSchema.skippedReason,
      arrivedAt: leadBriefSchema.arrivedAt,
      briefedAt: leadBriefSchema.briefedAt,
    })
    .from(leadBriefSchema)
    .where(where)
    .orderBy(desc(leadBriefSchema.briefedAt), desc(leadBriefSchema.id))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));

  const leads = rows.map(({ claims, sections, ...rest }) => ({
    ...rest,
    claimCount: claims.length,
    hasBrief: sections.length > 0,
  }));
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

/* ------------------------------------------------------------------ */
/* Brief generation                                                    */
/* ------------------------------------------------------------------ */

/** One written section of the brief, in the order the page renders it. */
export type BriefSection = { heading: string; body: string };

export type BriefClaim = { text: string; kind: string; source: string; date?: string };

export type ClaimedLead = {
  id: number;
  contactRef: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  /** Which try this is, 1-based. */
  attempt: number;
  attemptsRemaining: number;
  /** The reviewer's instruction, when this lead was sent back for a rewrite. */
  regenerateNote: string | null;
};

export type ClaimResult = {
  lead: ClaimedLead | null;
  /** Leads that ran out of tries on this call and are now in Review. */
  surfaced: string[];
  /** Unbriefed leads still waiting, this claim excluded. */
  waiting: number;
};

/**
 * Move every lead that has used all its tries into Review, carrying the error
 * where the brief would be. Deterministic and independent of what the agent
 * does, so a run that dies mid-brief still surfaces the lead on the next pass.
 * @param orgId
 */
async function surfaceExhaustedBriefs(orgId: string): Promise<string[]> {
  const rows = await db
    .update(leadBriefSchema)
    .set({
      status: REVIEW_STATUS,
      skippedReason: BRIEF_FAILED_REASON,
      // Only when the run reported nothing. A real error is never overwritten.
      briefError: sql`coalesce(${leadBriefSchema.briefError}, ${NO_ERROR_REPORTED})`,
    })
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.status, QUEUED_STATUS),
      gte(leadBriefSchema.briefAttempts, MAX_BRIEF_ATTEMPTS),
    ))
    .returning({ contactRef: leadBriefSchema.contactRef });
  return rows.map(r => r.contactRef);
}

/**
 * Hand out the next lead that needs a brief, counting the try in the same
 * operation. The count is not something the caller can decline to increment:
 * being given the work IS the attempt, which is what makes "three tries" hold
 * even when a run dies without reporting anything.
 *
 * Oldest arrival first, so a backlog drains in the order leads came in.
 * @param orgId
 * @param opts
 * @param opts.now
 */
export async function claimLeadToBrief(
  orgId: string,
  opts: { now?: Date } = {},
): Promise<ClaimResult> {
  const now = opts.now ?? new Date();
  const surfaced = await surfaceExhaustedBriefs(orgId);
  const floor = new Date(now.getTime() - RETRY_FLOOR_MINUTES * 60_000);

  const eligible = and(
    eq(leadBriefSchema.orgId, orgId),
    eq(leadBriefSchema.status, QUEUED_STATUS),
    lt(leadBriefSchema.briefAttempts, MAX_BRIEF_ATTEMPTS),
    or(isNull(leadBriefSchema.lastAttemptAt), lt(leadBriefSchema.lastAttemptAt, floor)),
  );

  const [next] = await db
    .select({ id: leadBriefSchema.id })
    .from(leadBriefSchema)
    .where(eligible)
    .orderBy(sql`${leadBriefSchema.arrivedAt} asc nulls last`, asc(leadBriefSchema.id))
    .limit(1);

  const [waitingRow] = await db
    .select({ n: count() })
    .from(leadBriefSchema)
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.status, QUEUED_STATUS),
      lt(leadBriefSchema.briefAttempts, MAX_BRIEF_ATTEMPTS),
    ));
  const waiting = waitingRow?.n ?? 0;

  if (!next) {
    return { lead: null, surfaced, waiting };
  }

  // The eligibility predicate is re-asserted here, so two overlapping runs
  // cannot both claim the same lead and burn two tries on one pass.
  const [claimed] = await db
    .update(leadBriefSchema)
    .set({
      briefAttempts: sql`${leadBriefSchema.briefAttempts} + 1`,
      lastAttemptAt: now,
    })
    .where(and(eq(leadBriefSchema.id, next.id), eligible))
    .returning({
      id: leadBriefSchema.id,
      contactRef: leadBriefSchema.contactRef,
      contactName: leadBriefSchema.contactName,
      contactTitle: leadBriefSchema.contactTitle,
      companyName: leadBriefSchema.companyName,
      briefAttempts: leadBriefSchema.briefAttempts,
      regenerateNote: leadBriefSchema.regenerateNote,
    });

  if (!claimed) {
    return { lead: null, surfaced, waiting };
  }

  return {
    surfaced,
    waiting: Math.max(waiting - 1, 0),
    lead: {
      id: claimed.id,
      contactRef: claimed.contactRef,
      contactName: claimed.contactName,
      contactTitle: claimed.contactTitle,
      companyName: claimed.companyName,
      attempt: claimed.briefAttempts,
      attemptsRemaining: MAX_BRIEF_ATTEMPTS - claimed.briefAttempts,
      regenerateNote: claimed.regenerateNote,
    },
  };
}

export type SaveLeadBriefOptions = {
  contactRef: string;
  sections: BriefSection[];
  claims: BriefClaim[];
  missing: string[];
  confidence: number;
  briefVersion: string;
  briefedBy?: BriefedBy;
  now?: Date;
};

export type SaveLeadBriefResult = {
  saved: boolean;
  reason?: 'not_on_queue';
  contactRef: string;
  status?: string;
  sectionCount?: number;
  claimCount?: number;
  missingCount?: number;
  confidence?: number | null;
  briefVersion?: string | null;
  /** Echoed back from the row, never from the caller. */
  identity?: {
    contactName: string;
    contactTitle: string | null;
    companyName: string | null;
    entranceSource: string | null;
    utmCampaign: string | null;
    engagementSent: number;
    engagementOpened: number;
  };
};

/**
 * Write the brief onto an existing queue row.
 *
 * The write list is closed. Identity (name, title, company), the entrance
 * source and the engagement counters were read off the CRM mirror at queue
 * time and are not in the SET clause, so a re-run cannot change who the lead
 * is however the model describes them. The caller supplies what was WRITTEN
 * and never what is RECORDED, the same division `queue_lead` enforces.
 * @param orgId
 * @param opts
 */
export async function saveLeadBrief(orgId: string, opts: SaveLeadBriefOptions): Promise<SaveLeadBriefResult> {
  const briefedAt = opts.now ?? new Date();
  const { getCurrentWorkspaceSha } = await import('@/libs/workspace');
  const workspaceSha = await getCurrentWorkspaceSha(orgId).catch(() => null);

  const [row] = await db
    .update(leadBriefSchema)
    .set({
      sections: opts.sections,
      claims: opts.claims,
      missing: opts.missing,
      confidence: opts.confidence,
      status: REVIEW_STATUS,
      briefedAt,
      briefVersion: opts.briefVersion,
      workspaceSha,
      briefedBy: opts.briefedBy,
      // A brief supersedes whatever the last failure said.
      briefError: null,
      skippedReason: null,
    })
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.contactRef, opts.contactRef),
    ))
    .returning({
      status: leadBriefSchema.status,
      confidence: leadBriefSchema.confidence,
      briefVersion: leadBriefSchema.briefVersion,
      contactName: leadBriefSchema.contactName,
      contactTitle: leadBriefSchema.contactTitle,
      companyName: leadBriefSchema.companyName,
      entranceSource: leadBriefSchema.entranceSource,
      utmCampaign: leadBriefSchema.utmCampaign,
      engagementSent: leadBriefSchema.engagementSent,
      engagementOpened: leadBriefSchema.engagementOpened,
    });

  if (!row) {
    return { saved: false, reason: 'not_on_queue', contactRef: opts.contactRef };
  }

  return {
    saved: true,
    contactRef: opts.contactRef,
    status: row.status,
    sectionCount: opts.sections.length,
    claimCount: opts.claims.length,
    missingCount: opts.missing.length,
    confidence: row.confidence,
    briefVersion: row.briefVersion,
    identity: {
      contactName: row.contactName,
      contactTitle: row.contactTitle,
      companyName: row.companyName,
      entranceSource: row.entranceSource,
      utmCampaign: row.utmCampaign,
      engagementSent: row.engagementSent,
      engagementOpened: row.engagementOpened,
    },
  };
}

export type BriefFailureResult = {
  recorded: boolean;
  reason?: 'not_on_queue' | 'already_briefed';
  contactRef: string;
  attemptsUsed?: number;
  attemptsRemaining?: number;
  /** True when this was the last try, so the next sweep puts it in Review. */
  surfacesNext?: boolean;
};

/**
 * Record why a lead could not be briefed. Stored, not acted on: the retry
 * budget was already spent by the claim, so this only supplies the text a
 * reviewer reads if the tries run out.
 * @param orgId
 * @param contactRef
 * @param error
 */
export async function recordBriefFailure(
  orgId: string,
  contactRef: string,
  error: string,
): Promise<BriefFailureResult> {
  const [row] = await db
    .update(leadBriefSchema)
    .set({ briefError: error.slice(0, 2000) })
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.contactRef, contactRef),
      // A written brief is never replaced by an error.
      eq(leadBriefSchema.status, QUEUED_STATUS),
    ))
    .returning({ briefAttempts: leadBriefSchema.briefAttempts });

  if (!row) {
    return { recorded: false, reason: 'not_on_queue', contactRef };
  }
  return {
    recorded: true,
    contactRef,
    attemptsUsed: row.briefAttempts,
    attemptsRemaining: Math.max(MAX_BRIEF_ATTEMPTS - row.briefAttempts, 0),
    surfacesNext: row.briefAttempts >= MAX_BRIEF_ATTEMPTS,
  };
}

export type RegenerateResult = {
  regenerated: boolean;
  reason?: 'not_found';
  id: number;
  contactRef?: string;
  contactName?: string;
};

/**
 * Send a brief back to be written again. The brief fields are cleared, the
 * reviewer's instruction is stored for the next pass to read, the tries reset,
 * and the lead returns to unbriefed so the next sweep picks it up. Identity
 * and the CRM projection are untouched, the same as everywhere else.
 * @param orgId
 * @param opts
 * @param opts.id
 * @param opts.note
 */
export async function regenerateBrief(
  orgId: string,
  opts: { id: number; note: string },
): Promise<RegenerateResult> {
  const [row] = await db
    .update(leadBriefSchema)
    .set({
      sections: [],
      claims: [],
      missing: [],
      confidence: null,
      status: QUEUED_STATUS,
      briefAttempts: 0,
      lastAttemptAt: null,
      briefError: null,
      skippedReason: null,
      regenerateNote: opts.note,
      // Back to the stamp that means "no research pass behind this row".
      briefVersion: QUEUE_BRIEF_VERSION,
    })
    .where(and(eq(leadBriefSchema.orgId, orgId), eq(leadBriefSchema.id, opts.id)))
    .returning({
      contactRef: leadBriefSchema.contactRef,
      contactName: leadBriefSchema.contactName,
    });

  if (!row) {
    return { regenerated: false, reason: 'not_found', id: opts.id };
  }
  return { regenerated: true, id: opts.id, contactRef: row.contactRef, contactName: row.contactName };
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
