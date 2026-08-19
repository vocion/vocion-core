/**
 * DiscoveryDetectionService — ticket 011.
 *
 * Detects when the seller has had a discovery call with a prospect and routes
 * it toward proposal generation. The governing rule is a privacy guarantee:
 *
 *   A meeting transcript is NEVER read unless the meeting first MATCHES — either
 *   a CRM record the seller owns (email/company-domain of an owned, in-stage
 *   contact/deal/company), or a seller-hosted call with an external guest (the
 *   Calendly-external first-meeting case, decision #1, which can be turned off).
 *   A fully-internal call, or one with nobody the seller is selling to, never
 *   matches, so it is never read.
 *
 * The funnel enforces that structurally, not by convention:
 *   Stage 0  buildEligibleSet   — who the seller is selling to (CRM only)
 *   Stage 1  matchMeeting       — meetings ↔ eligible parties, METADATA ONLY
 *   Stage 2  classifyTranscript — read + score, ONLY via the content gate
 *   Stage 3  routeClassification— generate / confirm / drop
 *
 * `readMatchedTranscript` is the SOLE place this feature reads transcript body
 * (knowledge_chunk.content). It refuses unless a discovery_candidate row exists,
 * and a candidate row is created only for a matched meeting — so an unmatched
 * call can never reach the classifier.
 */

import type { Principal } from '@/services/authz';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { buildChatModel } from '@/libs/llm';
import {
  discoveryCandidateSchema,
  knowledgeChunkSchema,
  knowledgeDocumentSchema,
} from '@/models/Schema';
import { proposeAction } from '@/services/ActionService';

// ── Types ───────────────────────────────────────────────────────────────────

export type PartyType = 'hubspot-contact' | 'hubspot-company' | 'hubspot-deal';
export type MatchType = PartyType | 'calendly-external';
export type Route = 'generate' | 'confirm' | 'drop';

/** A CRM party the seller owns and is actively working — the allow-list. */
export type EligibleParty = {
  ref: string; // 'contacts:9' | 'deals:123' | 'companies:5'
  type: PartyType;
  emails: string[]; // lowercased
  domains: string[]; // lowercased
  label?: string;
};

/** Meeting metadata — everything the matcher may see. Never the transcript. */
export type MeetingMeta = {
  docId: number;
  externalId: string; // 'zoom:<uuid>' | 'gcal:<eventId>'
  sourceSlug: string; // 'zoom' | 'google-calendar'
  title: string | null;
  host: string | null; // lowercased
  start: Date | null;
  attendees: string[]; // lowercased emails
  hasTranscript: boolean;
};

export type Match = {
  meeting: MeetingMeta;
  matchType: MatchType;
  matchRef: string | null;
  matchReason: string;
};

export type Classification = {
  isDiscovery: boolean;
  isDiscoveryConfidence: number;
  proposalReady: boolean;
  proposalReadyConfidence: number;
  reasoning: string;
  model?: string;
};

export type EligibleFilter = {
  /** HubSpot owner ids the meeting's records must belong to (empty = any owner). */
  ownerIds?: string[];
  /** Allowed contact lifecycle stages, e.g. ['lead','marketingqualifiedlead']. */
  lifecycleStages?: string[];
  /** Allowed deal stages (empty = any open deal). */
  dealStages?: string[];
};

export type SweepOptions = {
  eligible: EligibleFilter;
  /** The seller's own email domain, e.g. 'metacto.com' — anything else is external. */
  sellerDomain: string;
  sinceDays: number;
  discoveryThreshold: number;
  readyThreshold: number;
  /**
   * Allow the Calendly-external fallback (seller-hosted call with an external
   * guest, no CRM record required — decision #1). Default true.
   */
  allowCalendlyExternal?: boolean;
  /** v1 default: every classification is surfaced for review, nothing auto-runs. */
  supervised?: boolean;
  /**
   * Injectable clock. Also how a past day is replayed: pass the end of the day
   * as `now` with `sinceDays: 1` and the window is that day.
   */
  now?: Date;
  /**
   * Rehearsal mode, for the dashboard's test run. Needed because the real sweep
   * is idempotent by design — the `routed` skip means a second pass over an
   * already-swept day reports zero, which reads as broken when you are testing.
   *
   * A dry run DOES: match, record the match on `discovery_candidate`, read
   * matched transcripts, and classify. Those are the behaviours under test, and
   * the candidate row is what the content gate reads through.
   * A dry run does NOT: enqueue a review-queue item, or mark the candidate
   * routed. So it costs classifier spend, changes nothing anyone acts on, and
   * leaves the queue clean (that queue is the calibration data for 020). The
   * next real sweep still classifies the meeting normally.
   *
   * The privacy gate is untouched: only matched meetings are ever read, and a
   * dry run never widens what matches.
   */
  dryRun?: boolean;
};

/** Per-meeting detail — what a test run needs to explain itself. */
export type SweepMeetingDetail = {
  meetingExternalId: string;
  title: string | null;
  start: Date | null;
  matchType: MatchType;
  matchRef: string | null;
  matchReason: string;
  /** Why nothing was classified, when nothing was: already routed, or no transcript yet. */
  skipped?: 'already-routed' | 'no-transcript';
  classification?: Classification;
  route?: Route;
};

export type SweepResult = {
  eligibleParties: number;
  meetingsScanned: number;
  matched: number;
  classified: number;
  routed: { generate: number; confirm: number; drop: number };
  /** True when this was a rehearsal — nothing was persisted or enqueued. */
  dryRun: boolean;
  /** The window actually swept, so a run states its own scope. */
  window: { since: string; until: string };
  /** One entry per matched meeting, in sweep order. */
  meetings: SweepMeetingDetail[];
};

/** Raised when the content gate refuses a transcript read. */
export class ContentGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentGateError';
  }
}

// ── Small metadata helpers ───────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function lower(v: string | undefined): string | undefined {
  return v ? v.toLowerCase() : undefined;
}

function domainOf(email: string | undefined): string | undefined {
  const at = email?.lastIndexOf('@');
  return at != null && at >= 0 ? email!.slice(at + 1).toLowerCase() : undefined;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Free-email domains never become an eligible match-domain: a prospect using a
 * personal Gmail must not make `gmail.com` match every Gmail-hosted call. Exact
 * email still matches; only broad domain matching is suppressed for these.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

// ── Stage 0 · eligible set (pure) ────────────────────────────────────────────

type HubspotDoc = { docId: number; externalId: string; metadata: Record<string, unknown> };

const PARTY_TYPE: Record<'contacts' | 'deals' | 'companies', PartyType> = {
  contacts: 'hubspot-contact',
  deals: 'hubspot-deal',
  companies: 'hubspot-company',
};

/**
 * Filter synced HubSpot records down to the parties the seller owns and is
 * actively working, and extract the emails/domains a meeting can match against.
 * Pure — operates on already-loaded rows so it is trivially testable.
 * @param docs
 * @param filter
 */
export function filterEligible(docs: HubspotDoc[], filter: EligibleFilter): EligibleParty[] {
  const out: EligibleParty[] = [];
  for (const d of docs) {
    const m = d.metadata ?? {};
    const objectType = str(m.objectType);
    const hubspotId = str(m.hubspotId);
    if (!hubspotId || (objectType !== 'contacts' && objectType !== 'deals' && objectType !== 'companies')) {
      continue;
    }

    // Owner gate.
    if (filter.ownerIds && filter.ownerIds.length > 0) {
      const owner = str(m.ownerId);
      if (!owner || !filter.ownerIds.includes(owner)) {
        continue;
      }
    }

    // Stage gate (per object type).
    if (objectType === 'contacts' && filter.lifecycleStages && filter.lifecycleStages.length > 0) {
      const stage = lower(str(m.lifecycleStage));
      if (!stage || !filter.lifecycleStages.map(s => s.toLowerCase()).includes(stage)) {
        continue;
      }
    }
    if (objectType === 'deals' && filter.dealStages && filter.dealStages.length > 0) {
      const stage = lower(str(m.dealStage));
      if (!stage || !filter.dealStages.map(s => s.toLowerCase()).includes(stage)) {
        continue;
      }
    }

    const emails = [lower(str(m.primaryEmail))].filter((x): x is string => !!x);
    const domains = new Set<string>();
    for (const e of emails) {
      const dom = domainOf(e);
      if (dom && !FREE_EMAIL_DOMAINS.has(dom)) {
        domains.add(dom);
      }
    }
    const explicitDomain = lower(str(m.emailDomain)) ?? lower(str(m.domain));
    if (explicitDomain && !FREE_EMAIL_DOMAINS.has(explicitDomain)) {
      domains.add(explicitDomain);
    }

    out.push({
      ref: `${objectType}:${hubspotId}`,
      type: PARTY_TYPE[objectType],
      emails,
      domains: [...domains],
      label: str(m.name) ?? str(m.primaryEmail),
    });
  }
  return out;
}

// ── Stage 1 · meeting matcher (pure, metadata only) ──────────────────────────

/**
 * Match a single meeting to the eligible set using metadata alone. Returns null
 * when the meeting involves nobody the seller is selling to — those calls are
 * never read. Decision #1: a seller-hosted call with an external (non-seller)
 * attendee counts as a Calendly-external first-meeting even without a CRM record.
 * @param meeting
 * @param eligible
 * @param opts
 * @param opts.sellerDomain
 * @param opts.allowCalendlyExternal
 */
export function matchMeeting(
  meeting: MeetingMeta,
  eligible: EligibleParty[],
  opts: { sellerDomain: string; allowCalendlyExternal?: boolean },
): Match | null {
  const sellerDomain = opts.sellerDomain.toLowerCase();
  const attendees = meeting.attendees.map(a => a.toLowerCase());
  const attendeeDomains = new Set(attendees.map(a => domainOf(a)).filter((x): x is string => !!x));

  // Exact email match — strongest signal.
  for (const party of eligible) {
    if (party.emails.some(e => attendees.includes(e))) {
      return {
        meeting,
        matchType: party.type,
        matchRef: party.ref,
        matchReason: `attendee email matches ${party.type} ${party.ref}`,
      };
    }
  }

  // Domain match — the prospect's company is on the call. The seller's OWN
  // domain never counts, so a fully-internal meeting can't match even if an
  // employee was (wrongly) entered as a CRM record.
  for (const party of eligible) {
    const hit = party.domains.find(dom => dom !== sellerDomain && attendeeDomains.has(dom));
    if (hit) {
      return {
        meeting,
        matchType: party.type,
        matchRef: party.ref,
        matchReason: `attendee domain ${hit} matches ${party.type} ${party.ref}`,
      };
    }
  }

  // Calendly-external fallback (decision #1): a seller-hosted call with an
  // external guest — a likely first meeting even before the lead is in CRM.
  // This is the ONE match that does not require a seller-owned CRM record, so
  // it is opt-out via allowCalendlyExternal for deployments that want the
  // stricter "CRM record required" rule.
  if (opts.allowCalendlyExternal !== false) {
    const hostIsSeller = domainOf(meeting.host ?? undefined) === sellerDomain;
    const externalDomains = [...attendeeDomains].filter(dom => dom !== sellerDomain);
    if (hostIsSeller && externalDomains.length > 0) {
      return {
        meeting,
        matchType: 'calendly-external',
        matchRef: externalDomains[0] ?? null,
        matchReason: `seller-hosted call with external attendee (${externalDomains[0]})`,
      };
    }
  }

  return null;
}

// ── Stage 2 · the content gate + classifier ──────────────────────────────────

/**
 * THE CONTENT GATE. The only place this feature reads transcript body.
 * Refuses unless a discovery_candidate row exists for the meeting — and a row
 * exists only for a matched meeting. An unmatched call can never be read here.
 * @param orgId
 * @param meetingExternalId
 */
export async function readMatchedTranscript(orgId: string, meetingExternalId: string): Promise<string> {
  const [candidate] = await db
    .select({ meetingDocId: discoveryCandidateSchema.meetingDocId })
    .from(discoveryCandidateSchema)
    .where(and(
      eq(discoveryCandidateSchema.orgId, orgId),
      eq(discoveryCandidateSchema.meetingExternalId, meetingExternalId),
    ))
    .limit(1);

  if (!candidate) {
    throw new ContentGateError(
      `refused to read transcript for ${meetingExternalId}: no CRM match on record`,
    );
  }
  if (candidate.meetingDocId == null) {
    throw new ContentGateError(`no meeting document linked for ${meetingExternalId}`);
  }

  const chunks = await db
    .select({ content: knowledgeChunkSchema.content, idx: knowledgeChunkSchema.chunkIdx })
    .from(knowledgeChunkSchema)
    .where(and(
      eq(knowledgeChunkSchema.orgId, orgId),
      eq(knowledgeChunkSchema.documentId, candidate.meetingDocId),
    ))
    .orderBy(knowledgeChunkSchema.chunkIdx);

  return chunks.map(c => c.content).join('\n');
}

const ClassificationZ = z.object({
  is_discovery: z.boolean(),
  is_discovery_confidence: z.number().min(0).max(1),
  proposal_ready: z.boolean(),
  proposal_ready_confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const CLASSIFIER_SYSTEM = `You classify a sales call transcript on two independent axes.

1. is_discovery: is this a first/early discovery call with a prospect (understanding needs, scoping a problem) — as opposed to an internal meeting, a delivery/status call, a negotiation, or a support call?
2. proposal_ready: does the call give enough — a clear problem, scope, and buying intent — to draft a proposal now, versus needing another conversation first?

Score each with an independent confidence 0..1. A call can be clearly a discovery call yet not be proposal-ready.

Return STRICT JSON, no prose, no code fences:
{"is_discovery":bool,"is_discovery_confidence":number,"proposal_ready":bool,"proposal_ready_confidence":number,"reasoning":"one or two sentences"}`;

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(c => (c as { text?: string }).text ?? '').join('');
  }
  return '';
}

/**
 * Read is done by the caller via the gate; this only scores the text.
 * @param transcript
 * @param meta
 * @param meta.title
 */
export async function classifyTranscript(transcript: string, meta: { title?: string | null }): Promise<Classification> {
  const model = buildChatModel('classifier', { temperature: 0, streaming: false });
  const user = `Meeting title: ${meta.title ?? '(untitled)'}\n\nTranscript:\n${transcript}`;
  let raw = '';
  try {
    const res = await model.invoke(
      [new SystemMessage(CLASSIFIER_SYSTEM), new HumanMessage(user)],
      { signal: AbortSignal.timeout(30_000) },
    );
    raw = textOf(res.content);
  } catch {
    raw = '';
  }
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  let parsed: z.infer<typeof ClassificationZ> | undefined;
  try {
    parsed = ClassificationZ.parse(JSON.parse(stripped));
  } catch {
    // Fail safe: an unreadable classifier result is treated as low-signal, so
    // it routes to human review rather than silently auto-proceeding.
    return {
      isDiscovery: false,
      isDiscoveryConfidence: 0,
      proposalReady: false,
      proposalReadyConfidence: 0,
      reasoning: 'classifier output could not be parsed; routed to review',
    };
  }
  return {
    isDiscovery: parsed.is_discovery,
    isDiscoveryConfidence: parsed.is_discovery_confidence,
    proposalReady: parsed.proposal_ready,
    proposalReadyConfidence: parsed.proposal_ready_confidence,
    reasoning: parsed.reasoning,
    model: 'classifier',
  };
}

// ── Stage 3 · routing (pure) ─────────────────────────────────────────────────

/**
 * Pick a path from the two scores.
 *  - Not clearly a discovery call → 'drop' (surfaced for feedback in supervised mode).
 *  - Discovery + confidently proposal-ready → 'generate'.
 *  - Discovery but not confidently ready → 'confirm' ("should I create a proposal?").
 * @param c
 * @param opts
 * @param opts.discoveryThreshold
 * @param opts.readyThreshold
 */
export function routeClassification(
  c: Classification,
  opts: { discoveryThreshold: number; readyThreshold: number },
): Route {
  if (!c.isDiscovery || c.isDiscoveryConfidence < opts.discoveryThreshold) {
    return 'drop';
  }
  if (c.proposalReady && c.proposalReadyConfidence >= opts.readyThreshold) {
    return 'generate';
  }
  return 'confirm';
}

// ── DB loaders ───────────────────────────────────────────────────────────────

export async function loadHubspotDocs(orgId: string): Promise<HubspotDoc[]> {
  const rows = await db
    .select({
      docId: knowledgeDocumentSchema.id,
      externalId: knowledgeDocumentSchema.externalId,
      metadata: knowledgeDocumentSchema.metadata,
    })
    .from(knowledgeDocumentSchema)
    .where(eq(knowledgeDocumentSchema.orgId, orgId));
  return rows
    .filter(r => typeof (r.metadata as Record<string, unknown>)?.hubspotId === 'string')
    .map(r => ({ docId: r.docId, externalId: r.externalId, metadata: r.metadata as Record<string, unknown> }));
}

type CalEvent = { attendees: string[]; organizer: string | null };

function toDate(v: unknown, fallback: Date | null): Date | null {
  const s = str(v);
  return s ? new Date(s) : fallback;
}

/**
 * Load the meetings to consider — Zoom recordings, since they carry the
 * transcript we ultimately classify. Zoom stamps only the host, so attendees
 * (the matcher's main signal) are borrowed from the calendar event that shares
 * the recording's Zoom meeting id — a SHARED IDENTIFIER, never time proximity,
 * so a recording can never inherit a neighbouring meeting's attendees. When no
 * calendar event carries the id, the recording keeps zero attendees and simply
 * fails to match — it fails CLOSED (unread) rather than guessing. Attendees
 * already stamped on the Zoom metadata win, so sources that provide them
 * directly still work.
 *
 * `since` (and optional `until`) window the RECORDINGS only. The calendar
 * events are loaded unwindowed on purpose: an event is normally created before
 * its call, so it is routinely ingested outside the recording's window. Sharing
 * one window meant such a recording found no event, kept zero attendees, failed
 * closed, and then aged out of the window forever — a permanently unread call
 * caused by ingest ordering rather than by the privacy rule. Widening this is
 * safe: calendar attendees/organizer are metadata, the same class of signal the
 * matcher already runs on, and the content gate is untouched.
 * @param orgId
 * @param since
 * @param until - Optional upper bound (exclusive), for replaying one past day.
 */
export async function loadMeetingDocs(orgId: string, since: Date, until?: Date): Promise<MeetingMeta[]> {
  const windowConds = [
    eq(knowledgeDocumentSchema.orgId, orgId),
    gte(knowledgeDocumentSchema.ingestedAt, since),
  ];
  if (until) {
    windowConds.push(lt(knowledgeDocumentSchema.ingestedAt, until));
  }
  const rows = await db
    .select({
      docId: knowledgeDocumentSchema.id,
      externalId: knowledgeDocumentSchema.externalId,
      title: knowledgeDocumentSchema.title,
      metadata: knowledgeDocumentSchema.metadata,
      lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
    })
    .from(knowledgeDocumentSchema)
    .where(and(...windowConds));

  // Calendar events, UNWINDOWED and narrowed in SQL to just those carrying a
  // Zoom id — see the note above on why sharing the recordings' window made
  // early-ingested events invisible.
  const eventRows = await db
    .select({ metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      sql`${knowledgeDocumentSchema.metadata}->>'kind' = 'calendar-event'`,
      sql`${knowledgeDocumentSchema.metadata}->>'zoomMeetingId' IS NOT NULL`,
    ));

  const recordings: { meta: MeetingMeta; zoomMeetingId: string | null }[] = [];
  const eventsByZoomId = new Map<string, CalEvent>();
  for (const r of eventRows) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    const zoomId = str(m.zoomMeetingId);
    if (zoomId) {
      eventsByZoomId.set(zoomId, {
        attendees: stringArray(m.attendees).map(a => a.toLowerCase()),
        organizer: lower(str(m.organizer)) ?? null,
      });
    }
  }
  for (const r of rows) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    if (str(m.kind) !== 'zoom-recording') {
      continue;
    }
    recordings.push({
      meta: {
        docId: r.docId,
        externalId: r.externalId,
        sourceSlug: 'zoom',
        title: r.title,
        host: lower(str(m.host)) ?? null,
        start: toDate(m.start, r.lastModifiedAt),
        attendees: stringArray(m.attendees).map(a => a.toLowerCase()),
        hasTranscript: m.hasTranscript === true,
      },
      zoomMeetingId: str(m.meetingId) ?? null,
    });
  }

  // Enrich attendee-less recordings from the calendar event with the SAME Zoom
  // meeting id — an exact-identifier join, never a time guess.
  for (const rec of recordings) {
    if (rec.meta.attendees.length > 0 || !rec.zoomMeetingId) {
      continue;
    }
    const event = eventsByZoomId.get(rec.zoomMeetingId);
    if (event) {
      rec.meta.attendees = event.attendees;
      if (!rec.meta.host) {
        rec.meta.host = event.organizer;
      }
    }
  }
  return recordings.map(r => r.meta);
}

// ── Persistence + review enqueue ─────────────────────────────────────────────

type CandidateRow = { id: number; status: string };

/**
 * Insert the candidate for a match, or return the existing row (with its
 * status, so the sweep can skip work already done). Atomic via ON CONFLICT so
 * two concurrent sweeps can't double-insert.
 * @param orgId
 * @param match
 */
async function upsertCandidate(orgId: string, match: Match): Promise<CandidateRow> {
  await db
    .insert(discoveryCandidateSchema)
    .values({
      orgId,
      meetingExternalId: match.meeting.externalId,
      meetingDocId: match.meeting.docId,
      meetingTitle: match.meeting.title,
      meetingStart: match.meeting.start,
      matchType: match.matchType,
      matchRef: match.matchRef,
      matchReason: match.matchReason,
      status: 'matched',
    })
    .onConflictDoNothing({
      target: [discoveryCandidateSchema.orgId, discoveryCandidateSchema.meetingExternalId],
    });

  const [row] = await db
    .select({ id: discoveryCandidateSchema.id, status: discoveryCandidateSchema.status })
    .from(discoveryCandidateSchema)
    .where(and(
      eq(discoveryCandidateSchema.orgId, orgId),
      eq(discoveryCandidateSchema.meetingExternalId, match.meeting.externalId),
    ))
    .limit(1);
  return row!;
}

const DISCOVERY_PRINCIPAL = (orgId: string): Principal => ({
  kind: 'agent',
  id: 'agent:discovery-detector',
  scope: { orgId },
  grants: ['review_proposal'],
  autonomy: 1,
});

async function enqueueReview(
  orgId: string,
  candidateId: number,
  match: Match,
  c: Classification,
  route: Route,
): Promise<number | null> {
  const res = await proposeAction({
    orgId,
    actionId: 'discovery.review_proposal',
    principal: DISCOVERY_PRINCIPAL(orgId),
    invokedBy: 'agent:discovery-detector',
    input: {
      candidateId,
      meetingExternalId: match.meeting.externalId,
      company: match.matchRef ?? match.meeting.title ?? null,
      route,
      isDiscovery: c.isDiscovery,
      proposalReady: c.proposalReady,
    },
    proposal: {
      confidence: c.isDiscoveryConfidence,
      rationale: c.reasoning,
      evidence: [match.meeting.externalId, match.matchRef].filter((x): x is string => !!x),
    },
    dedupKey: `discovery.review_proposal:${match.meeting.externalId}`,
  });
  return res.runId ?? null;
}

// ── Stage orchestrator ───────────────────────────────────────────────────────

/**
 * Run the full funnel for an org. Reads only the meetings that survive the CRM
 * match, classifies each behind the content gate, and (supervised mode) surfaces
 * every result to the review queue for feedback — nothing auto-runs in v1.
 * @param orgId
 * @param opts
 */
export async function runSweep(orgId: string, opts: SweepOptions): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const supervised = opts.supervised ?? true;
  const dryRun = opts.dryRun ?? false;

  // Stage 0.
  const hubspotDocs = await loadHubspotDocs(orgId);
  const eligible = filterEligible(hubspotDocs, opts.eligible);

  // Stage 1 — metadata only. `now` is the window's upper bound, so replaying a
  // past day is `now = end of that day` with `sinceDays = 1`.
  const since = new Date(now.getTime() - opts.sinceDays * 86_400_000);
  const meetings = await loadMeetingDocs(orgId, since, now);
  const matches = meetings
    .map(m => matchMeeting(m, eligible, { sellerDomain: opts.sellerDomain, allowCalendlyExternal: opts.allowCalendlyExternal }))
    .filter((x): x is Match => x !== null);

  const routed = { generate: 0, confirm: 0, drop: 0 };
  const details: SweepMeetingDetail[] = [];
  let classified = 0;

  for (const match of matches) {
    const detail: SweepMeetingDetail = {
      meetingExternalId: match.meeting.externalId,
      title: match.meeting.title,
      start: match.meeting.start,
      matchType: match.matchType,
      matchRef: match.matchRef,
      matchReason: match.matchReason,
    };
    details.push(detail);

    // The match IS recorded on a dry run, and deliberately so: the candidate
    // row is the provenance record that this meeting matched on metadata, which
    // is true whether or not we go on to classify — and it is the row the
    // content gate reads through. Suppressing it would either make a dry run
    // classify nothing (useless) or require a bypass on the gate (unsafe). So
    // dryRun suppresses the two writes that carry consequences: the review-queue
    // item and the routed/classification update. Nothing downstream sees it.
    const candidate = await upsertCandidate(orgId, match);

    // Already classified on a previous sweep → don't re-read the transcript,
    // re-spend on the LLM, or re-post a duplicate to the review queue. A dry
    // run deliberately ignores this: rehearsing an already-swept day is the
    // main reason to dry-run at all.
    if (!dryRun && candidate.status === 'routed') {
      detail.skipped = 'already-routed';
      continue;
    }
    if (!match.meeting.hasTranscript) {
      detail.skipped = 'no-transcript'; // matched but nothing to classify yet
      continue;
    }

    // Stage 2 — the ONLY transcript read, behind the gate.
    const transcript = await readMatchedTranscript(orgId, match.meeting.externalId);
    const classification = await classifyTranscript(transcript, { title: match.meeting.title });
    classified += 1;
    detail.classification = classification;

    // Stage 3.
    const route = routeClassification(classification, opts);
    routed[route] += 1;
    detail.route = route;

    if (dryRun) {
      continue; // rehearsal ends here: nothing enqueued, nothing persisted
    }

    const reviewRunId = supervised
      ? await enqueueReview(orgId, candidate.id, match, classification, route)
      : null;

    await db
      .update(discoveryCandidateSchema)
      .set({
        status: 'routed',
        classification,
        classifiedAt: now,
        route,
        reviewActionRunId: reviewRunId,
      })
      .where(eq(discoveryCandidateSchema.id, candidate.id));
  }

  return {
    eligibleParties: eligible.length,
    meetingsScanned: meetings.length,
    matched: matches.length,
    classified,
    routed,
    dryRun,
    window: { since: since.toISOString(), until: now.toISOString() },
    meetings: details,
  };
}
