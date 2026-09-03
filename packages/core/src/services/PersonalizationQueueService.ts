/**
 * PersonalizationQueueService — the personalization lane: new MQLs become
 * rows on the `lead_brief` queue, each is researched into a brief, and each
 * briefed lead is drafted into numbered sends recommending an EXISTING
 * HubSpot sequence, then proposed as a `personalization.enroll` review item.
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
 * The CRM read is the same one `hubspot_count_contacts` uses, so arrivals here
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
  return toDate(rec.createdAt);
}

function toDate(v: unknown): Date | null {
  const raw = str(v);
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
    // HubSpot's stage-entry date, when the mirror carries it. Null falls back
    // to arrivedAt on every surface, labeled "Arrived", never as stage timing.
    mqlAt: toDate(rec.mqlEnteredAt),
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
/** What a handoff brief carries, and why the lead left. */
export type SaveHandoffBriefOptions = {
  contactRef: string;
  sections: Array<{ heading: string; body: string }>;
  /** Why the lead left the agent's care. */
  trigger: 'reply' | 'intent' | 'routed';
  now?: Date;
};

export type SaveHandoffBriefResult = {
  saved: boolean;
  contactRef: string;
  /** Echoed so the caller can see the review brief was left alone. */
  reviewSectionCount?: number;
};

/**
 * Save the call prep written when a lead leaves the agent.
 *
 * Writes ONLY the handoff columns. The review brief, the claims, the
 * confidence and the lane are left exactly as they were: the two briefs
 * answer different questions at different moments, and a handoff re-run
 * that quietly rewrote the review brief would change the record of a
 * decision that was already taken.
 * @param orgId - Tenant.
 * @param opts - The brief, and why the lead left.
 * @returns Whether a row took it, echoing the untouched review brief's size.
 */
export async function saveHandoffBrief(orgId: string, opts: SaveHandoffBriefOptions): Promise<SaveHandoffBriefResult> {
  const [row] = await db
    .update(leadBriefSchema)
    .set({
      handoffSections: opts.sections,
      handoffTrigger: opts.trigger,
      handoffAt: opts.now ?? new Date(),
    })
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.contactRef, opts.contactRef),
    ))
    .returning({ sections: leadBriefSchema.sections });
  if (!row) {
    return { saved: false, contactRef: opts.contactRef };
  }
  return { saved: true, contactRef: opts.contactRef, reviewSectionCount: row.sections.length };
}

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
      // Drafts hang off the brief, so a rewrite clears them too. A pending
      // enroll item is not cancelled here: the next drafting pass updates it
      // in place through the dedup key and re-links it.
      draftSequence: [],
      recommendedSequence: null,
      draftAttempts: 0,
      lastDraftAttemptAt: null,
      draftError: null,
      reviewActionRunId: null,
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

/* ------------------------------------------------------------------ */
/* Draft generation                                                    */
/* ------------------------------------------------------------------ */

/** Drafting tries before a lead stops being handed out — same budget as the briefs. */
export const MAX_DRAFT_ATTEMPTS = 3;

/** One drafted send. `day` is its offset in the recommended sequence's cadence, when known. */
export type DraftSend = { day?: number; subject: string; body: string };

export type ClaimedDraftLead = {
  id: number;
  contactRef: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  entranceSource: string | null;
  utmCampaign: string | null;
  confidence: number | null;
  sections: BriefSection[];
  claims: BriefClaim[];
  missing: string[];
  regenerateNote: string | null;
  mqlAt: Date | null;
  arrivedAt: Date | null;
  /** Which try this is, 1-based. */
  attempt: number;
  attemptsRemaining: number;
};

export type DraftClaimResult = {
  lead: ClaimedDraftLead | null;
  /** Briefed leads still waiting for drafts, this claim excluded. */
  waiting: number;
};

/**
 * Briefed, undrafted, not yet surfaced as a review item, tries left.
 * @param orgId
 * @param floor
 */
function draftEligible(orgId: string, floor: Date) {
  return and(
    eq(leadBriefSchema.orgId, orgId),
    eq(leadBriefSchema.status, REVIEW_STATUS),
    // A failed brief never gets drafts: drafting requires written sections.
    sql`jsonb_array_length(${leadBriefSchema.sections}) > 0`,
    sql`jsonb_array_length(${leadBriefSchema.draftSequence}) = 0`,
    isNull(leadBriefSchema.reviewActionRunId),
    lt(leadBriefSchema.draftAttempts, MAX_DRAFT_ATTEMPTS),
    or(isNull(leadBriefSchema.lastDraftAttemptAt), lt(leadBriefSchema.lastDraftAttemptAt, floor)),
  );
}

/**
 * Hand out the next briefed lead that needs a draft sequence, counting the
 * try in the same operation — the same claim contract as `claimLeadToBrief`:
 * being given the work IS the attempt. Returns the whole brief so the
 * drafting pass never re-reads it through another tool.
 * @param orgId
 * @param opts
 * @param opts.now
 */
export async function claimBriefToDraft(
  orgId: string,
  opts: { now?: Date } = {},
): Promise<DraftClaimResult> {
  const now = opts.now ?? new Date();
  const floor = new Date(now.getTime() - RETRY_FLOOR_MINUTES * 60_000);
  const eligible = draftEligible(orgId, floor);

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
      eq(leadBriefSchema.status, REVIEW_STATUS),
      sql`jsonb_array_length(${leadBriefSchema.sections}) > 0`,
      sql`jsonb_array_length(${leadBriefSchema.draftSequence}) = 0`,
      isNull(leadBriefSchema.reviewActionRunId),
      lt(leadBriefSchema.draftAttempts, MAX_DRAFT_ATTEMPTS),
    ));
  const waiting = waitingRow?.n ?? 0;

  if (!next) {
    return { lead: null, waiting };
  }

  // Re-asserted predicate, same as the brief claim: two overlapping runs
  // cannot both claim the same lead and burn two tries on one pass.
  const [claimed] = await db
    .update(leadBriefSchema)
    .set({
      draftAttempts: sql`${leadBriefSchema.draftAttempts} + 1`,
      lastDraftAttemptAt: now,
    })
    .where(and(eq(leadBriefSchema.id, next.id), eligible))
    .returning({
      id: leadBriefSchema.id,
      contactRef: leadBriefSchema.contactRef,
      contactName: leadBriefSchema.contactName,
      contactTitle: leadBriefSchema.contactTitle,
      companyName: leadBriefSchema.companyName,
      entranceSource: leadBriefSchema.entranceSource,
      utmCampaign: leadBriefSchema.utmCampaign,
      confidence: leadBriefSchema.confidence,
      sections: leadBriefSchema.sections,
      claims: leadBriefSchema.claims,
      missing: leadBriefSchema.missing,
      regenerateNote: leadBriefSchema.regenerateNote,
      mqlAt: leadBriefSchema.mqlAt,
      arrivedAt: leadBriefSchema.arrivedAt,
      draftAttempts: leadBriefSchema.draftAttempts,
    });

  if (!claimed) {
    return { lead: null, waiting };
  }

  return {
    waiting: Math.max(waiting - 1, 0),
    lead: {
      id: claimed.id,
      contactRef: claimed.contactRef,
      contactName: claimed.contactName,
      contactTitle: claimed.contactTitle,
      companyName: claimed.companyName,
      entranceSource: claimed.entranceSource,
      utmCampaign: claimed.utmCampaign,
      confidence: claimed.confidence,
      sections: claimed.sections,
      claims: claimed.claims,
      missing: claimed.missing,
      regenerateNote: claimed.regenerateNote,
      mqlAt: claimed.mqlAt,
      arrivedAt: claimed.arrivedAt,
      attempt: claimed.draftAttempts,
      attemptsRemaining: MAX_DRAFT_ATTEMPTS - claimed.draftAttempts,
    },
  };
}

export type SaveDraftSequenceOptions = {
  contactRef: string;
  /** The numbered sends, in order. Steps are numbered server-side by position. */
  sends: DraftSend[];
  /** The EXISTING sequence the agent recommends — from the sequence library read. */
  recommendedSequence: { id: string; name: string; reason?: string };
  senderEmail: string;
  /** HubSpot user id from the library read — scopes verification and the later enrollment. */
  hubspotUserId?: string;
  briefedBy?: BriefedBy;
  now?: Date;
};

export type SaveDraftSequenceResult = {
  saved: boolean;
  reason?: 'not_on_queue' | 'not_briefed' | 'unknown_sequence';
  contactRef: string;
  message?: string;
  sendCount?: number;
  /** True when the recommendation was checked against the live sequence library. */
  sequenceVerified?: boolean;
  /** The pending `personalization.enroll` review item — proposed here, server-side, so the agent cannot forget. */
  reviewRunId?: number;
  reviewRunStatus?: string;
};

/**
 * Write the drafted sends onto a briefed lead and propose the
 * `personalization.enroll` review item in the same operation — the propose
 * step is structural, not a prompt instruction the agent can skip.
 *
 * The recommendation must name an EXISTING sequence: when HubSpot credentials
 * are connected, the id is verified against the live library and an unknown
 * id is refused. The write list is closed the same way `save_lead_brief`'s
 * is — identity and the brief itself are not arguments here.
 * @param orgId
 * @param opts
 */
export async function saveDraftSequence(orgId: string, opts: SaveDraftSequenceOptions): Promise<SaveDraftSequenceResult> {
  // Verify the recommended sequence exists before anything is written. A
  // portal without connected credentials skips the check (there is no library
  // to read); the flag on the row says which happened.
  let sequenceVerified = false;
  if (opts.hubspotUserId) {
    const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
    const resolved = await hubspotClientForOrg(orgId);
    if (resolved.ok) {
      const { getSequence } = await import('@/libs/hubspot/sequences');
      const res = await getSequence(resolved.client, opts.recommendedSequence.id, opts.hubspotUserId);
      if (!res.ok && res.error === 'hubspot_error' && res.status === 404) {
        return {
          saved: false,
          reason: 'unknown_sequence',
          contactRef: opts.contactRef,
          message: `NOTHING WAS SAVED. Sequence ${opts.recommendedSequence.id} does not exist in the sender's HubSpot sequence library. Re-read the library and recommend a sequence it actually returns.`,
        };
      }
      sequenceVerified = res.ok;
    }
  }

  const sends = opts.sends.map((send, i) => ({
    step: i + 1,
    ...(send.day !== undefined ? { day: send.day } : {}),
    subject: send.subject,
    body: send.body,
  }));

  const [row] = await db
    .update(leadBriefSchema)
    .set({
      draftSequence: sends,
      recommendedSequence: {
        id: opts.recommendedSequence.id,
        name: opts.recommendedSequence.name,
        reason: opts.recommendedSequence.reason,
        senderEmail: opts.senderEmail,
        hubspotUserId: opts.hubspotUserId,
        verified: sequenceVerified,
      },
      // Drafts supersede whatever the last drafting failure said.
      draftError: null,
    })
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.contactRef, opts.contactRef),
      eq(leadBriefSchema.status, REVIEW_STATUS),
      // A failed brief never gets drafts, whatever the caller sends.
      sql`jsonb_array_length(${leadBriefSchema.sections}) > 0`,
    ))
    .returning({
      id: leadBriefSchema.id,
      contactName: leadBriefSchema.contactName,
      companyName: leadBriefSchema.companyName,
      confidence: leadBriefSchema.confidence,
    });

  if (!row) {
    const [exists] = await db
      .select({ id: leadBriefSchema.id })
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, orgId), eq(leadBriefSchema.contactRef, opts.contactRef)))
      .limit(1);
    return {
      saved: false,
      reason: exists ? 'not_briefed' : 'not_on_queue',
      contactRef: opts.contactRef,
      message: exists
        ? 'NOTHING WAS SAVED. The lead exists but is not a briefed lead in ready_for_review, so drafts cannot attach to it.'
        : 'NOTHING WAS SAVED. No queue row carries that contact_ref. Use the exact `contactRef` next_brief_to_draft handed you.',
    };
  }

  // Propose the review item server-side. Dedup is keyed on the contact, so a
  // re-fired sweep updates the one pending item rather than duplicating it;
  // onProposed back-links lead_brief.review_action_run_id.
  const { proposeAction } = await import('@/services/ActionService');
  const invokedBy = opts.briefedBy?.agentSlug ? `agent:${opts.briefedBy.agentSlug}` : 'personalization-drafting';
  const proposed = await proposeAction({
    orgId,
    actionId: 'personalization.enroll',
    input: {
      leadBriefId: row.id,
      contactRef: opts.contactRef,
      contactName: row.contactName,
      companyName: row.companyName ?? undefined,
      sequenceId: opts.recommendedSequence.id,
      sequenceName: opts.recommendedSequence.name,
      senderEmail: opts.senderEmail,
      hubspotUserId: opts.hubspotUserId,
      sends,
    },
    principal: { kind: 'agent', id: invokedBy, scope: { orgId }, grants: ['*'], autonomy: 2 },
    invokedBy,
    proposal: {
      confidence: row.confidence ?? undefined,
      rationale: opts.recommendedSequence.reason,
    },
  });

  return {
    saved: true,
    contactRef: opts.contactRef,
    sendCount: sends.length,
    sequenceVerified,
    reviewRunId: proposed.runId,
    reviewRunStatus: proposed.status,
  };
}

export type DraftFailureResult = {
  recorded: boolean;
  reason?: 'not_awaiting_drafts';
  contactRef: string;
  attemptsUsed?: number;
  attemptsRemaining?: number;
};

/**
 * Record why a briefed lead could not be drafted. Stored, not acted on — the
 * try was already spent by the claim; this is the text a person reads on a
 * lead whose drafts never arrived.
 * @param orgId
 * @param contactRef
 * @param error
 */
export async function recordDraftFailure(
  orgId: string,
  contactRef: string,
  error: string,
): Promise<DraftFailureResult> {
  const [row] = await db
    .update(leadBriefSchema)
    .set({ draftError: error.slice(0, 2000) })
    .where(and(
      eq(leadBriefSchema.orgId, orgId),
      eq(leadBriefSchema.contactRef, contactRef),
      eq(leadBriefSchema.status, REVIEW_STATUS),
      // Written drafts are never replaced by an error.
      sql`jsonb_array_length(${leadBriefSchema.draftSequence}) = 0`,
    ))
    .returning({ draftAttempts: leadBriefSchema.draftAttempts });

  if (!row) {
    return { recorded: false, reason: 'not_awaiting_drafts', contactRef };
  }
  return {
    recorded: true,
    contactRef,
    attemptsUsed: row.draftAttempts,
    attemptsRemaining: Math.max(MAX_DRAFT_ATTEMPTS - row.draftAttempts, 0),
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
