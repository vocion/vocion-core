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
 *
 * Detection is agent-driven (the RevOps Lead orchestrates via tools —
 * `services/agents/tools/discovery.ts`); the deterministic `discovery-sweep`
 * job is gone. The stages compose into three service entry points:
 *   matchWindow     — stages 0–1, records every match on the ledger
 *   classifyCall    — stage 2+3 for ONE candidate: gated read, one fixed model
 *                     call, audit write. Read/classify/persist are one function,
 *                     so the transcript never enters agent-steered context and
 *                     an unlogged assessment is not a reachable state.
 *   reconcileWindow — recompute matches vs the ledger; the coverage check that
 *                     replaces the loop's visit-every-meeting guarantee.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { buildChatModel, resolvedModelId } from '@/libs/llm';
import {
  discoveryCandidateSchema,
  knowledgeChunkSchema,
  knowledgeDocumentSchema,
} from '@/models/Schema';

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
  externalId: string; // 'zoom:<uuid>' | 'granola:<noteId>' | 'gcal:<eventId>'
  sourceSlug: string; // 'zoom' | 'granola' | 'google-calendar'
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

/** The metadata window the matcher (and the reconciler) operate over. */
export type DiscoveryWindowOptions = {
  eligible: EligibleFilter;
  /** The seller's own email domain, e.g. 'metacto.com' — anything else is external. */
  sellerDomain: string;
  sinceDays: number;
  /**
   * Allow the Calendly-external fallback (seller-hosted call with an external
   * guest, no CRM record required — decision #1). Default true.
   */
  allowCalendlyExternal?: boolean;
  /**
   * Injectable clock. Also how a past day is replayed: pass the end of the day
   * as `now` with `sinceDays: 1` and the window is that day.
   */
  now?: Date;
};

/** Route thresholds — defaults used when the caller passes none. Recorded per row either way. */
export const DEFAULT_DISCOVERY_THRESHOLD = 0.6;
export const DEFAULT_READY_THRESHOLD = 0.75;

/**
 * The classifier prompt's version stamp. Bump on ANY change to
 * `CLASSIFIER_SYSTEM` or the output schema — scores are only comparable
 * within one version, and calibration (020) reports per version.
 */
export const DISCOVERY_CLASSIFIER_PROMPT_VERSION = 'discovery-v1';

/** Model id + prompt version — the `classifier_version` audit stamp. */
export function discoveryClassifierVersion(): string {
  return `${resolvedModelId('classifier')}#${DISCOVERY_CLASSIFIER_PROMPT_VERSION}`;
}

/** Raised when the content gate refuses a transcript read. */
export class ContentGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentGateError';
  }
}

/**
 * Typed refusal from `classifyCall` — the tool surfaces `code` verbatim so an
 * agent (and a test) can tell "no such candidate" from "nothing to read yet".
 */
export class ClassifyCallError extends Error {
  constructor(public readonly code: 'no_candidate' | 'no_transcript', message: string) {
    super(message);
    this.name = 'ClassifyCallError';
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
 * A contact label usable for name-in-title matching: a full name (2+ words,
 * each with 2+ word characters). Single tokens ("Chris") would match far too
 * many titles, so they never title-match.
 * @param label
 */
function titleMatchableName(label: string | undefined): string | null {
  const name = label?.trim();
  if (!name) {
    return null;
  }
  const words = name.split(/\s+/);
  if (words.length < 2 || words.some(w => w.replace(/[^\p{L}\p{N}]/gu, '').length < 2)) {
    return null;
  }
  return name;
}

/**
 * Whole-word, case-insensitive "does the title name this person".
 * @param title
 * @param name
 */
function titleNames(title: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(title);
}

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

  // Name-in-title match — the rescue for meetings with NO attendee metadata.
  // Zoom stamps only the host; with no calendar event sharing the meeting id
  // the recording carries zero emails and every rule above is blind to it,
  // even when the title literally names the prospect ("Brayden Cruz: intro")
  // and that person is in the CRM. Gated on empty attendees so a call whose
  // participants ARE known (e.g. an internal debrief titled with a prospect's
  // name) keeps the strict email/domain rules. Contacts only, full names only.
  if (attendees.length === 0 && meeting.title) {
    for (const party of eligible) {
      if (party.type !== 'hubspot-contact') {
        continue;
      }
      const name = titleMatchableName(party.label);
      if (name && titleNames(meeting.title, name)) {
        return {
          meeting,
          matchType: party.type,
          matchRef: party.ref,
          matchReason: `meeting title names contact ${name} (${party.ref}); no attendee metadata on the recording`,
        };
      }
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
    model: resolvedModelId('classifier'),
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

/**
 * Load the org's CRM records for the matcher's allow-list.
 *
 * Scoped in SQL to documents carrying a stamped `hubspotId`, which is exactly
 * the set the old JS-side filter produced — but as a predicate the partial
 * index in `0054_crm_records_idx.sql` can serve, instead of reading every
 * knowledge_document in the org into memory and filtering afterwards.
 * @param orgId
 */
export async function loadHubspotDocs(orgId: string): Promise<HubspotDoc[]> {
  const rows = await db
    .select({
      docId: knowledgeDocumentSchema.id,
      externalId: knowledgeDocumentSchema.externalId,
      metadata: knowledgeDocumentSchema.metadata,
    })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      sql`${knowledgeDocumentSchema.metadata} ->> 'hubspotId' IS NOT NULL`,
    ));
  return rows.map(r => ({
    docId: r.docId,
    externalId: r.externalId,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));
}

type CalEvent = { attendees: string[]; organizer: string | null };

function toDate(v: unknown, fallback: Date | null): Date | null {
  const s = str(v);
  return s ? new Date(s) : fallback;
}

/**
 * Load the meetings to consider — Zoom recordings AND Granola notes, since
 * both carry the transcript we ultimately classify. Granola matters because it
 * captures calls held on the prospect's platform (Teams, Meet, anything the
 * seller joined), which Zoom cloud recordings never see; its notes stamp
 * attendee emails and the note owner directly, so they enter the matcher
 * as-is. Zoom stamps only the host, so attendees
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
  const notes: MeetingMeta[] = [];
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
    const kind = str(m.kind);
    if (kind === 'granola-note') {
      // The note owner is the seller-side recorder — the host, for the
      // seller-hosted external fallback.
      notes.push({
        docId: r.docId,
        externalId: r.externalId,
        sourceSlug: 'granola',
        title: r.title,
        host: lower(str(m.owner)) ?? null,
        start: toDate(m.when, r.lastModifiedAt),
        attendees: stringArray(m.attendees).map(a => a.toLowerCase()),
        hasTranscript: m.hasTranscript === true,
      });
      continue;
    }
    if (kind !== 'zoom-recording') {
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
  return [...recordings.map(r => r.meta), ...notes];
}

// ── Double-capture dedup (pure) ──────────────────────────────────────────────

/** A capture suppressed because another capture of the same call also matched. */
export type DroppedCapture = {
  meetingExternalId: string;
  title: string | null;
  keptExternalId: string;
  reason: string;
};

const DOUBLE_CAPTURE_WINDOW_MS = 20 * 60_000;

/**
 * A call the seller holds on Zoom while also running Granola is captured twice
 * (recording + note); assessing both would double the model spend and put two
 * review cards for one call in front of the human. Dedup runs on MATCHES only,
 * keyed on the matched party (`matchRef`, a shared identifier) plus a tight
 * start window — never on raw meetings, so it can only ever pick between two
 * captures that would BOTH be assessed, and can never suppress a meeting whose
 * other capture failed to match. The Zoom recording wins: its transcript is
 * diarized with names, Granola's is Me/Them.
 * @param matches
 */
export function dedupeDoubleCaptures(matches: Match[]): { matches: Match[]; dropped: DroppedCapture[] } {
  const zooms = matches.filter(m => m.meeting.sourceSlug === 'zoom');
  const dropped: DroppedCapture[] = [];
  const kept = matches.filter((m) => {
    if (m.meeting.sourceSlug !== 'granola' || !m.matchRef || !m.meeting.start) {
      return true;
    }
    const twin = zooms.find(z =>
      z.matchRef === m.matchRef
      && z.meeting.start
      && Math.abs(z.meeting.start.getTime() - m.meeting.start!.getTime()) <= DOUBLE_CAPTURE_WINDOW_MS);
    if (!twin) {
      return true;
    }
    dropped.push({
      meetingExternalId: m.meeting.externalId,
      title: m.meeting.title,
      keptExternalId: twin.meeting.externalId,
      reason: `same matched party (${m.matchRef}) within 20 min of ${twin.meeting.externalId} — Zoom capture kept`,
    });
    return false;
  });
  return { matches: kept, dropped };
}

// ── Persistence ──────────────────────────────────────────────────────────────

type CandidateRow = { id: number; status: string; skippedReason: string | null; route: string | null };

/**
 * Insert the candidate for a match, or return the existing row (with its
 * status, so callers can skip work already done). Atomic via ON CONFLICT so
 * two concurrent matchers can't double-insert.
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
    .select({
      id: discoveryCandidateSchema.id,
      status: discoveryCandidateSchema.status,
      skippedReason: discoveryCandidateSchema.skippedReason,
      route: discoveryCandidateSchema.route,
    })
    .from(discoveryCandidateSchema)
    .where(and(
      eq(discoveryCandidateSchema.orgId, orgId),
      eq(discoveryCandidateSchema.meetingExternalId, match.meeting.externalId),
    ))
    .limit(1);
  return row!;
}

// ── The matcher (agent tool body) ────────────────────────────────────────────

/**
 * A meeting the matcher structurally CANNOT match: it carries no attendee
 * metadata (Zoom stamps only the host; attendees come from a calendar event
 * sharing the recording's meeting id, and none was ingested). It fails closed
 * by design — the transcript stays unread — but the failure must be VISIBLE:
 * a real discovery call in this state looks identical to full coverage
 * ("0 gaps") because both match and reconcile compute from the same metadata.
 * Everything here is metadata the matcher already sees, never content.
 */
export type UnmatchableMeeting = {
  meetingExternalId: string;
  title: string | null;
  start: Date | null;
  host: string | null;
  hasTranscript: boolean;
  reason: string;
};

function unmatchableOf(meetings: MeetingMeta[], matchedExternalIds: Set<string>): UnmatchableMeeting[] {
  return meetings
    .filter(m => m.attendees.length === 0 && !matchedExternalIds.has(m.externalId))
    .map(m => ({
      meetingExternalId: m.externalId,
      title: m.title,
      start: m.start,
      host: m.host,
      hasTranscript: m.hasTranscript,
      reason: 'no attendee metadata — no calendar event shares this recording\'s meeting id, so it fails closed. It becomes matchable if a HubSpot contact\'s full name appears in the meeting title (add/complete the contact, then re-run match_meetings), or fix the calendar linkage / capture via Granola.',
    }));
}

export type MatchedCandidateSummary = {
  candidateId: number;
  meetingExternalId: string;
  title: string | null;
  start: Date | null;
  matchType: MatchType;
  matchRef: string | null;
  matchReason: string;
  hasTranscript: boolean;
  /** Ledger status: 'matched' | 'classified' | 'routed' | 'dropped'. */
  status: string;
  route: string | null;
  skippedReason: string | null;
};

/**
 * Match the window's meetings against the eligible set and RECORD every match
 * on the ledger — metadata only, no transcript is read here. Every matched but
 * not-yet-assessed row carries a `skipped_reason` ('no-transcript' or
 * 'not-reached'), which is the coverage record: `classifyCall` clears it, so a
 * window where the agent stopped early is visibly different from one where
 * nothing was classifiable.
 * @param orgId
 * @param opts
 */
export async function matchWindow(orgId: string, opts: DiscoveryWindowOptions): Promise<{
  window: { since: string; until: string };
  eligibleParties: number;
  meetingsScanned: number;
  meetingsBySource: Record<string, number>;
  matchedCount: number;
  unmatchableCount: number;
  unmatchable: UnmatchableMeeting[];
  candidates: MatchedCandidateSummary[];
  doubleCapturesDropped: DroppedCapture[];
}> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.sinceDays * 86_400_000);

  const hubspotDocs = await loadHubspotDocs(orgId);
  const eligible = filterEligible(hubspotDocs, opts.eligible);
  const meetings = await loadMeetingDocs(orgId, since, now);
  const { matches, dropped } = dedupeDoubleCaptures(meetings
    .map(m => matchMeeting(m, eligible, { sellerDomain: opts.sellerDomain, allowCalendlyExternal: opts.allowCalendlyExternal }))
    .filter((x): x is Match => x !== null));

  const candidates: MatchedCandidateSummary[] = [];
  for (const match of matches) {
    const row = await upsertCandidate(orgId, match);
    let skippedReason = row.skippedReason;
    // Stamp coverage on rows not yet assessed. A transcript can arrive after
    // the first match, so re-stamp on every pass until classification.
    if (row.status === 'matched') {
      skippedReason = match.meeting.hasTranscript ? 'not-reached' : 'no-transcript';
      if (skippedReason !== row.skippedReason) {
        await db
          .update(discoveryCandidateSchema)
          .set({ skippedReason })
          .where(eq(discoveryCandidateSchema.id, row.id));
      }
    }
    candidates.push({
      candidateId: row.id,
      meetingExternalId: match.meeting.externalId,
      title: match.meeting.title,
      start: match.meeting.start,
      matchType: match.matchType,
      matchRef: match.matchRef,
      matchReason: match.matchReason,
      hasTranscript: match.meeting.hasTranscript,
      status: row.status,
      route: row.route,
      skippedReason,
    });
  }

  const unmatchable = unmatchableOf(meetings, new Set(matches.map(m => m.meeting.externalId)));
  return {
    window: { since: since.toISOString(), until: now.toISOString() },
    eligibleParties: eligible.length,
    meetingsScanned: meetings.length,
    meetingsBySource: countBySource(meetings),
    matchedCount: candidates.length,
    unmatchableCount: unmatchable.length,
    unmatchable,
    candidates,
    doubleCapturesDropped: dropped,
  };
}

function countBySource(meetings: MeetingMeta[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of meetings) {
    counts[m.sourceSlug] = (counts[m.sourceSlug] ?? 0) + 1;
  }
  return counts;
}

// ── classifyCall — read, classify, persist: ONE function ─────────────────────

export type ClassifyCallResult = {
  candidateId: number;
  meetingExternalId: string;
  meetingTitle: string | null;
  isDiscovery: boolean;
  isDiscoveryConfidence: number;
  proposalReady: boolean;
  proposalReadyConfidence: number;
  reasoning: string;
  route: Route;
  thresholds: { discovery: number; ready: number };
  transcriptHash: string | null;
  classifierVersion: string;
};

/**
 * Assess one matched call. Reads the transcript through the content gate,
 * makes ONE fixed model call, and writes the verdict plus its full provenance
 * to the ledger row — reading and recording are the same function, so an
 * assessment that "forgot" to log is not a reachable state. Returns only the
 * structured scores; the transcript body never leaves this function.
 *
 * Atomicity: the audit write is the single side effect after the model call.
 * If it fails the caller gets the error and the call is safely retryable
 * (a re-run re-reads and re-scores) — never silently assessed-but-unlogged.
 * @param orgId
 * @param candidateId
 * @param opts
 * @param opts.discoveryThreshold
 * @param opts.readyThreshold
 * @param opts.assessedBy
 * @param opts.assessedBy.agentSlug
 * @param opts.assessedBy.missionRunId
 * @param opts.assessedBy.userId
 * @param opts.now
 */
export async function classifyCall(
  orgId: string,
  candidateId: number,
  opts: {
    discoveryThreshold?: number;
    readyThreshold?: number;
    /** Who ordered the assessment — stamps `assessed_by` and the activity event. */
    assessedBy: { agentSlug?: string; missionRunId?: number; userId?: string };
    now?: Date;
  },
): Promise<ClassifyCallResult> {
  const thresholds = {
    discovery: opts.discoveryThreshold ?? DEFAULT_DISCOVERY_THRESHOLD,
    ready: opts.readyThreshold ?? DEFAULT_READY_THRESHOLD,
  };

  const [candidate] = await db
    .select()
    .from(discoveryCandidateSchema)
    .where(and(
      eq(discoveryCandidateSchema.orgId, orgId),
      eq(discoveryCandidateSchema.id, candidateId),
    ))
    .limit(1);
  if (!candidate) {
    throw new ClassifyCallError(
      'no_candidate',
      `no discovery_candidate ${candidateId} in this org — only meetings recorded by match_meetings can be assessed`,
    );
  }

  // The ONLY transcript read, behind the gate (which re-checks the row).
  const transcript = await readMatchedTranscript(orgId, candidate.meetingExternalId);
  if (transcript.trim().length === 0) {
    await db
      .update(discoveryCandidateSchema)
      .set({ skippedReason: 'no-transcript' })
      .where(eq(discoveryCandidateSchema.id, candidate.id));
    throw new ClassifyCallError(
      'no_transcript',
      `meeting ${candidate.meetingExternalId} has no transcript content yet — recorded as skipped_reason='no-transcript'`,
    );
  }

  // Which exact transcript version is being scored.
  const [doc] = candidate.meetingDocId == null
    ? []
    : await db
        .select({ contentHash: knowledgeDocumentSchema.contentHash })
        .from(knowledgeDocumentSchema)
        .where(and(
          eq(knowledgeDocumentSchema.orgId, orgId),
          eq(knowledgeDocumentSchema.id, candidate.meetingDocId),
        ))
        .limit(1);

  // The fixed call — one prompt, one schema, versioned. Never agent-steered.
  const classification = await classifyTranscript(transcript, { title: candidate.meetingTitle });
  const route = routeClassification(classification, {
    discoveryThreshold: thresholds.discovery,
    readyThreshold: thresholds.ready,
  });

  const { getCurrentWorkspaceSha } = await import('@/libs/workspace');
  const workspaceSha = await getCurrentWorkspaceSha(orgId).catch(() => null);
  const classifierVersion = discoveryClassifierVersion();
  const now = opts.now ?? new Date();

  await db
    .update(discoveryCandidateSchema)
    .set({
      status: 'classified',
      classification,
      classifiedAt: now,
      route,
      transcriptHash: doc?.contentHash ?? null,
      thresholds,
      classifierVersion,
      workspaceSha,
      assessedBy: opts.assessedBy,
      skippedReason: null,
    })
    .where(eq(discoveryCandidateSchema.id, candidate.id));

  // One event per assessment — the drill-down pointer to the ledger row.
  // Metadata stays enum-and-boolean; the reasoning lives on the row only.
  const { track } = await import('@/services/adoption/track');
  await track(
    {
      orgId,
      userId: opts.assessedBy.userId
        ?? (opts.assessedBy.agentSlug ? `agent:${opts.assessedBy.agentSlug}` : 'system'),
    },
    'discovery.classified',
    {
      agentSlug: opts.assessedBy.agentSlug ?? null,
      resource: ['discovery_candidate', candidate.id],
      meta: { route, isDiscovery: classification.isDiscovery, proposalReady: classification.proposalReady },
    },
  );

  return {
    candidateId: candidate.id,
    meetingExternalId: candidate.meetingExternalId,
    meetingTitle: candidate.meetingTitle,
    isDiscovery: classification.isDiscovery,
    isDiscoveryConfidence: classification.isDiscoveryConfidence,
    proposalReady: classification.proposalReady,
    proposalReadyConfidence: classification.proposalReadyConfidence,
    reasoning: classification.reasoning,
    route,
    thresholds,
    transcriptHash: doc?.contentHash ?? null,
    classifierVersion,
  };
}

// ── Reconciliation — the coverage guarantee the deterministic loop gave ──────

export type DiscoveryGap = {
  meetingExternalId: string;
  title: string | null;
  kind: 'unvisited' | 'not-reached' | 'no-transcript' | 'unassessed';
  detail: string;
};

export type DiscoveryReconciliation = {
  window: { since: string; until: string };
  meetingsScanned: number;
  meetingsBySource: Record<string, number>;
  matchedNow: number;
  assessed: number;
  gapCount: number;
  gaps: DiscoveryGap[];
  /**
   * Meetings scanned but structurally unmatchable (zero attendee metadata).
   * Reported here because "0 gaps" only covers MATCHED meetings — a real
   * discovery call in this state would otherwise be invisible to coverage.
   */
  unmatchableCount: number;
  unmatchable: UnmatchableMeeting[];
};

/**
 * Recompute the window's matches (metadata only, no LLM, no writes) and diff
 * them against the ledger. A deterministic loop visited every meeting; an
 * agent may stop early or mis-scope a window — this is the check that makes
 * that visible instead of silent.
 * @param orgId
 * @param opts
 */
export async function reconcileWindow(orgId: string, opts: DiscoveryWindowOptions): Promise<DiscoveryReconciliation> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.sinceDays * 86_400_000);

  const hubspotDocs = await loadHubspotDocs(orgId);
  const eligible = filterEligible(hubspotDocs, opts.eligible);
  const meetings = await loadMeetingDocs(orgId, since, now);
  // Same dedup as matchWindow, or every suppressed Granola twin would be
  // reported as an eternal 'unvisited' gap.
  const { matches } = dedupeDoubleCaptures(meetings
    .map(m => matchMeeting(m, eligible, { sellerDomain: opts.sellerDomain, allowCalendlyExternal: opts.allowCalendlyExternal }))
    .filter((x): x is Match => x !== null));

  const externalIds = matches.map(m => m.meeting.externalId);
  const rows = externalIds.length === 0
    ? []
    : await db
        .select({
          meetingExternalId: discoveryCandidateSchema.meetingExternalId,
          status: discoveryCandidateSchema.status,
          skippedReason: discoveryCandidateSchema.skippedReason,
        })
        .from(discoveryCandidateSchema)
        .where(and(
          eq(discoveryCandidateSchema.orgId, orgId),
          inArray(discoveryCandidateSchema.meetingExternalId, externalIds),
        ));
  const byExternalId = new Map(rows.map(r => [r.meetingExternalId, r]));

  let assessed = 0;
  const gaps: DiscoveryGap[] = [];
  for (const match of matches) {
    const row = byExternalId.get(match.meeting.externalId);
    if (!row) {
      gaps.push({
        meetingExternalId: match.meeting.externalId,
        title: match.meeting.title,
        kind: 'unvisited',
        detail: 'matches on metadata but has no ledger row — match_meetings has not covered this window',
      });
      continue;
    }
    if (row.status === 'matched') {
      const kind = row.skippedReason === 'no-transcript'
        ? 'no-transcript' as const
        : row.skippedReason === 'not-reached'
          ? 'not-reached' as const
          : 'unassessed' as const;
      gaps.push({
        meetingExternalId: match.meeting.externalId,
        title: match.meeting.title,
        kind,
        detail: kind === 'no-transcript'
          ? 'matched, but no transcript has arrived yet'
          : 'matched and classifiable, but never assessed',
      });
      continue;
    }
    assessed += 1;
  }

  const unmatchable = unmatchableOf(meetings, new Set(matches.map(m => m.meeting.externalId)));
  return {
    window: { since: since.toISOString(), until: now.toISOString() },
    meetingsScanned: meetings.length,
    meetingsBySource: countBySource(meetings),
    matchedNow: matches.length,
    assessed,
    gapCount: gaps.length,
    gaps,
    unmatchableCount: unmatchable.length,
    unmatchable,
  };
}
