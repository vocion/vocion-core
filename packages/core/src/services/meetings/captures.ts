/**
 * MEETING CAPTURES — the record a call leaves behind, read from metadata.
 *
 * A call reaches Vocion as a captured document: a cloud recording with its
 * transcript (Zoom) or a note-taker's note (Granola). This module turns one of
 * those rows into the facts a follow-up needs — who owned it, who was on it,
 * which of them are outside the owner's domain — and, after a sync, raises
 * `meeting.transcript_ready` once for every capture that has settled.
 *
 * Nothing here reads what was said. Whether the call was with a client, and
 * whether something is owed after it, is a model's read in the subscriber
 * (`services/jobs/meetingFollowup.ts`); this side is metadata only, the same
 * class of signal the data-room collector and discovery matcher run on.
 *
 * "Settled" is what keeps a follow-up from being written off half a meeting:
 * a recording is settled once its transcript is in (Zoom publishes the
 * recording after the call ends), a note once it has stopped changing for
 * {@link NOTE_SETTLE_MS} — a note-taker writes while the call runs, and a
 * sync can land mid-call.
 */

import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeDocumentSchema } from '@/models/Schema';

/** Connectors whose documents are meeting captures, and the metadata kind each writes. */
export const MEETING_CAPTURE_KINDS: Readonly<Record<string, string>> = {
  'zoom-recording': 'zoom',
  'granola-note': 'granola',
};

/** A note that has not changed for this long is the finished note. */
export const NOTE_SETTLE_MS = 10 * 60_000;

/** How far back a sync looks for captures it has not announced. Older calls are not followed up on their own. */
export const ANNOUNCE_WINDOW_DAYS = 3;

/** One captured meeting, as metadata says it. */
export type MeetingCapture = {
  documentId: number;
  /** The document's external id (`zoom:<uuid>`, `granola:<id>`) — the discovery ledger's key for the call. */
  externalId: string;
  /** `zoom` | `granola` — the capture's connector. */
  connector: string;
  title: string | null;
  /** When the meeting started, ISO, when the capture says. */
  start: string | null;
  /** The person on our side who owned the capture: the host, or the note's owner. Lowercased. */
  owner: string | null;
  /** Everyone the capture lists, lowercased addresses. Empty when it lists nobody. */
  attendees: string[];
  /** The attendees outside the owner's domain. */
  external: string[];
  /** Whether the capture carries a transcript. */
  hasTranscript: boolean;
  /** When the capture last changed. */
  changedAt: Date | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

/**
 * One address, lowercased, from however the connector wrote it, or null for
 * something that is not an address (a name, a calendar resource).
 * @param raw - The value as written.
 */
export function addressOf(raw: string): string | null {
  const inAngles = /<([^<>]+)>/.exec(raw);
  const bare = (inAngles ? inAngles[1]! : raw).trim().replace(/^[\s"']+|[\s"',;]+$/g, '').toLowerCase();
  if (!bare.includes('@') || bare.endsWith('.calendar.google.com')) {
    return null;
  }
  return bare;
}

/**
 * The attendees outside the owner's domain. With no owner there is no "our
 * side" to compare against, so nobody is called external.
 * @param owner - The owner's address.
 * @param attendees - Everyone listed.
 */
export function externalOf(owner: string | null, attendees: readonly string[]): string[] {
  const home = owner?.split('@')[1]?.toLowerCase();
  if (!home) {
    return [];
  }
  return [...new Set(attendees.filter(a => a.split('@')[1] !== home && a !== owner))];
}

/**
 * A capture from one knowledge document's row, or null when the row is not a
 * meeting capture. Pure.
 * @param row - The document.
 * @param row.id - Its id.
 * @param row.externalId - Its external id.
 * @param row.title - Its title.
 * @param row.metadata - Its metadata, as the connector wrote it.
 * @param row.lastModifiedAt - When it last changed.
 * @param calendarAttendees - Attendees of the calendar event carrying the same
 * Zoom meeting id, for a recording that lists none (Zoom's recording API
 * carries the host only) — an exact-identifier join, never a time guess.
 */
export function captureOf(
  row: { id: number; externalId?: string | null; title: string | null; metadata: Record<string, unknown> | null; lastModifiedAt: Date | null },
  calendarAttendees?: (zoomMeetingId: string) => { attendees: string[]; organizer: string | null } | null,
): MeetingCapture | null {
  const m = row.metadata ?? {};
  const connector = MEETING_CAPTURE_KINDS[str(m.kind) ?? ''];
  if (!connector) {
    return null;
  }
  let owner = addressOf(str(connector === 'granola' ? m.owner : m.host) ?? '');
  let attendees = strs(m.attendees).map(addressOf).filter((a): a is string => a !== null);
  if (connector === 'zoom' && attendees.length === 0) {
    const zoomId = str(m.meetingId) ?? (typeof m.meetingId === 'number' ? String(m.meetingId) : null);
    const event = zoomId ? calendarAttendees?.(zoomId) ?? null : null;
    if (event) {
      attendees = event.attendees.map(addressOf).filter((a): a is string => a !== null);
      owner ??= addressOf(event.organizer ?? '');
    }
  }
  attendees = [...new Set(attendees)];
  return {
    documentId: row.id,
    externalId: row.externalId ?? '',
    connector,
    title: row.title,
    start: str(connector === 'granola' ? m.when : m.start),
    owner,
    attendees,
    external: externalOf(owner, attendees),
    hasTranscript: m.hasTranscript === true,
    changedAt: row.lastModifiedAt,
  };
}

/**
 * Whether a capture is the finished record of its call. Pure.
 * @param capture - The capture.
 * @param now - The clock.
 */
export function isSettled(capture: MeetingCapture, now: Date): boolean {
  if (capture.connector === 'zoom') {
    return capture.hasTranscript;
  }
  // A note with no change time cannot be shown to have stopped changing.
  return capture.changedAt !== null && now.getTime() - capture.changedAt.getTime() >= NOTE_SETTLE_MS;
}

/**
 * Whether a capture could be a call with someone outside. Only a capture that
 * lists attendees and lists nobody outside is known to be internal; one that
 * lists nobody is unknown, and the model read decides.
 * @param capture - The capture.
 */
export function mayBeExternal(capture: MeetingCapture): boolean {
  return capture.attendees.length === 0 || capture.external.length > 0;
}

/** A start is bucketed to this, so two captures of one call agree on it. */
const START_BUCKET_MS = 30 * 60_000;

/**
 * What makes two captures one meeting — a recording and a note of the same
 * call: its owner and its start, to the half hour. A capture with neither is
 * its own meeting. Pure.
 * @param capture - The capture.
 * @param capture.documentId - Its document.
 * @param capture.owner - Its owner.
 * @param capture.start - Its start.
 */
export function meetingKey(capture: Pick<MeetingCapture, 'documentId' | 'owner' | 'start'>): string {
  const at = capture.start ? Date.parse(capture.start) : Number.NaN;
  if (!capture.owner || Number.isNaN(at)) {
    return `doc:${capture.documentId}`;
  }
  return `${capture.owner}:${new Date(Math.floor(at / START_BUCKET_MS) * START_BUCKET_MS).toISOString()}`;
}

/** The `meeting.transcript_ready` payload: scalars only, so any field can be filtered on. */
export type MeetingTranscriptReadyPayload = {
  documentId: number;
  externalId: string;
  connector: string;
  title: string;
  start: string;
  owner: string;
  attendees: string;
  externalAttendees: string;
  externalCount: number;
};

/**
 * The event payload for a capture. Pure.
 * @param capture - The capture.
 */
export function transcriptReadyPayload(capture: MeetingCapture): MeetingTranscriptReadyPayload {
  return {
    documentId: capture.documentId,
    externalId: capture.externalId,
    connector: capture.connector,
    title: capture.title ?? '',
    start: capture.start ?? '',
    owner: capture.owner ?? '',
    attendees: capture.attendees.join(', '),
    externalAttendees: capture.external.join(', '),
    externalCount: capture.external.length,
  };
}

/**
 * The calendar events that carry a Zoom meeting id, keyed by it — the join
 * that gives an attendee-less recording its people.
 * @param orgId - The workspace.
 * @param zoomIds - The ids wanted.
 */
async function calendarByZoomId(orgId: string, zoomIds: string[]): Promise<Map<string, { attendees: string[]; organizer: string | null }>> {
  const out = new Map<string, { attendees: string[]; organizer: string | null }>();
  if (zoomIds.length === 0) {
    return out;
  }
  const rows = await db
    .select({ metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      sql`${knowledgeDocumentSchema.metadata}->>'kind' = 'calendar-event'`,
      inArray(sql<string>`${knowledgeDocumentSchema.metadata}->>'zoomMeetingId'`, zoomIds),
    ));
  for (const r of rows) {
    const m = r.metadata ?? {};
    const id = str(m.zoomMeetingId);
    if (id) {
      out.set(id, { attendees: strs(m.attendees), organizer: str(m.organizer) });
    }
  }
  return out;
}

type CaptureRow = { id: number; externalId: string; title: string | null; metadata: Record<string, unknown>; lastModifiedAt: Date | null };

/**
 * Captures for a set of document rows, with the calendar join done once.
 * @param orgId - The workspace.
 * @param rows - The documents.
 */
async function capturesFor(orgId: string, rows: CaptureRow[]): Promise<MeetingCapture[]> {
  const zoomIds = rows
    .filter(r => r.metadata?.kind === 'zoom-recording' && strs(r.metadata?.attendees).length === 0)
    .map(r => (r.metadata.meetingId === undefined || r.metadata.meetingId === null ? null : String(r.metadata.meetingId)))
    .filter((id): id is string => id !== null);
  const calendar = await calendarByZoomId(orgId, zoomIds);
  return rows.map(r => captureOf(r, id => calendar.get(id) ?? null)).filter((c): c is MeetingCapture => c !== null);
}

/**
 * One capture by its document id, read fresh. Null when the document is gone
 * or is not a meeting capture.
 * @param orgId - The workspace.
 * @param documentId - The knowledge document.
 */
export async function loadCapture(orgId: string, documentId: number): Promise<MeetingCapture | null> {
  const rows = await db
    .select({ id: knowledgeDocumentSchema.id, externalId: knowledgeDocumentSchema.externalId, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata, lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), eq(knowledgeDocumentSchema.id, documentId)))
    .limit(1);
  return (await capturesFor(orgId, rows))[0] ?? null;
}

/**
 * After a sync of a meeting source: raise `meeting.transcript_ready` once for
 * every capture of that source from the last {@link ANNOUNCE_WINDOW_DAYS}
 * that has settled. The window is read whole rather than only what this run
 * touched, so a note ingested mid-call and finished later is announced by the
 * first sync after it settles. Each event is deduped on its document, so a
 * capture is announced once however many syncs see it. Never throws.
 * @param orgId - The workspace.
 * @param sourceId - The source that synced.
 * @param now - The clock.
 * @returns How many captures were announced this time.
 */
export async function announceMeetingCaptures(orgId: string, sourceId: number, now: Date = new Date()): Promise<number> {
  try {
    const since = new Date(now.getTime() - ANNOUNCE_WINDOW_DAYS * 86_400_000);
    const rows = await db
      .select({ id: knowledgeDocumentSchema.id, externalId: knowledgeDocumentSchema.externalId, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata, lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt })
      .from(knowledgeDocumentSchema)
      .where(and(
        eq(knowledgeDocumentSchema.orgId, orgId),
        eq(knowledgeDocumentSchema.sourceId, sourceId),
        inArray(sql<string>`${knowledgeDocumentSchema.metadata}->>'kind'`, Object.keys(MEETING_CAPTURE_KINDS)),
        or(gte(knowledgeDocumentSchema.ingestedAt, since), gte(knowledgeDocumentSchema.lastModifiedAt, since)),
      ))
      .limit(200);
    const { emitEvent } = await import('@/services/EventService');
    const { MEETING_TRANSCRIPT_READY } = await import('@/services/eventNames');
    let announced = 0;
    for (const capture of await capturesFor(orgId, rows)) {
      if (!isSettled(capture, now)) {
        continue;
      }
      const res = await emitEvent({
        orgId,
        type: MEETING_TRANSCRIPT_READY,
        payload: transcriptReadyPayload(capture),
        dedupeKey: `${MEETING_TRANSCRIPT_READY}:${capture.documentId}`,
        invokedBy: 'source-sync',
      }).catch((err: unknown) => {
        console.warn('[meetings] could not announce a capture', { orgId, documentId: capture.documentId, error: err instanceof Error ? err.message : String(err) });
        return null;
      });
      if (res && !res.deduped) {
        announced += 1;
      }
    }
    return announced;
  } catch (err) {
    console.warn('[meetings] announcing captures failed', { orgId, sourceId, error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
