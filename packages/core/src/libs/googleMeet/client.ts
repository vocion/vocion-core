/**
 * Google Meet, read through the workspace's Google login — Calendar for the
 * meetings, Drive for what Meet wrote about them. No Meet API and no second
 * Google client: the shared `google` credential (calendar.readonly +
 * drive.readonly) is all it needs.
 *
 * When a meeting is transcribed, recorded or noted by Gemini, Meet saves the
 * file to the organizer's Drive and ATTACHES it to the calendar event
 * (`attachments[{ fileId, title, mimeType }]`). So a meeting is a calendar
 * event with Meet conference data, and its transcript is the Google Doc on
 * it. Which Doc is which is read off the file names Meet itself generates —
 * "<meeting> - Transcript" and "<meeting> - Notes by Gemini" — never off a
 * person's words; a Doc that is neither counts as the transcript, since that
 * is the one Meet attaches first.
 *
 * A video attachment (the recording) is kept as a link and never downloaded.
 * This module is the one mapping both the sync and the meetings provider use,
 * so a transcript read live and one read from the index say the same thing.
 */

import type { IngestDoc } from '@/services/IngestionService';
import type { MeetingTranscript } from '@/services/meetings/provider';
import { orThrow, vendorRequest } from '@/libs/connectors/vendorFetch';
import { renderMeeting } from '@/services/meetings/provider';

export const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
export const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const AUTH_HINT = 'Log in with Google again on the Connectors page, allowing Calendar and Drive (read-only).';

export type MeetAttachment = { fileId?: string; fileUrl?: string; title?: string; mimeType?: string };

export type MeetEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
  attachments?: MeetAttachment[];
  conferenceData?: { conferenceId?: string; conferenceSolution?: { key?: { type?: string } } };
};

type EventsPage = { items?: MeetEvent[]; nextPageToken?: string };

/**
 * Whether an event is a Google Meet meeting that took place.
 * @param ev - The calendar event.
 */
export function isMeetEvent(ev: MeetEvent): boolean {
  if (ev.status === 'cancelled') {
    return false;
  }
  return ev.conferenceData?.conferenceSolution?.key?.type === 'hangoutsMeet' || Boolean(ev.hangoutLink);
}

/** What Meet attached to the event, sorted by what it is. */
export type MeetFiles = { transcript: MeetAttachment[]; notes: MeetAttachment[]; recordings: MeetAttachment[] };

/**
 * The event's attachments by kind: transcript and Gemini-notes Docs, and the
 * recording videos. Anything else attached by a person is left out.
 * @param ev - The calendar event.
 */
export function meetFiles(ev: MeetEvent): MeetFiles {
  const files: MeetFiles = { transcript: [], notes: [], recordings: [] };
  for (const a of ev.attachments ?? []) {
    if (a.mimeType === GOOGLE_DOC && a.fileId) {
      // Meet's own generated file names: "<meeting> - Notes by Gemini".
      if (/notes by gemini/i.test(a.title ?? '')) {
        files.notes.push(a);
      } else {
        files.transcript.push(a);
      }
    } else if (a.mimeType?.startsWith('video/')) {
      files.recordings.push(a);
    }
  }
  return files;
}

/**
 * Whether Meet left anything on the event worth a document.
 * @param ev - The calendar event.
 */
export function hasMeetFiles(ev: MeetEvent): boolean {
  const f = meetFiles(ev);
  return f.transcript.length + f.notes.length + f.recordings.length > 0;
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * One page of the calendar's events in a window.
 * @param input - Who, which calendar, which window.
 * @param input.token - A Google access token.
 * @param input.calendarId - `primary` or a calendar id.
 * @param input.from - Window start.
 * @param input.to - Window end.
 * @param input.updatedMin - Only events changed since, when incremental.
 * @param input.pageToken - The page to read.
 * @param input.maxResults - Page size.
 */
export async function listEventsPage(input: { token: string; calendarId: string; from: Date; to: Date; updatedMin?: Date | null; pageToken?: string; maxResults?: number }) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    maxResults: String(input.maxResults ?? 250),
    timeMin: input.from.toISOString(),
    timeMax: input.to.toISOString(),
  });
  if (input.updatedMin) {
    params.set('updatedMin', input.updatedMin.toISOString());
  }
  if (input.pageToken) {
    params.set('pageToken', input.pageToken);
  }
  return vendorRequest<EventsPage>({
    vendor: 'Google Calendar',
    url: `${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
    headers: headers(input.token),
    authHint: AUTH_HINT,
  });
}

/**
 * One event by id, or null when the calendar has none.
 * @param token - A Google access token.
 * @param calendarId - `primary` or a calendar id.
 * @param eventId - The event id.
 */
export async function getEvent(token: string, calendarId: string, eventId: string): Promise<MeetEvent | null> {
  const res = await vendorRequest<MeetEvent>({
    vendor: 'Google Calendar',
    url: `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    headers: headers(token),
    authHint: AUTH_HINT,
  });
  if (!res.ok && (res.status === 404 || res.status === 410)) {
    return null;
  }
  return orThrow(res);
}

/**
 * A Google Doc as plain text.
 * @param token - A Google access token.
 * @param fileId - The Doc's Drive id.
 */
export async function exportDocText(token: string, fileId: string) {
  return vendorRequest<string>({
    vendor: 'Google Drive',
    url: `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`,
    headers: headers(token),
    text: true,
    authHint: AUTH_HINT,
  });
}

/**
 * Whether Drive answers this token at all: one file, any file.
 * @param token - A Google access token.
 */
export async function probeDrive(token: string) {
  return vendorRequest<{ files?: unknown[] }>({
    vendor: 'Google Drive',
    url: `${DRIVE_BASE}/files?pageSize=1&fields=files(id)`,
    headers: headers(token),
    authHint: AUTH_HINT,
  });
}

/** The meeting read whole, plus what the document's metadata needs. */
export type MeetMeeting = MeetingTranscript & { conferenceId: string | null; attendees: string[]; recordingUrls: string[]; htmlLink: string | null; updated: string | null };

function startOf(ev: MeetEvent): string | null {
  return ev.start?.dateTime ?? ev.start?.date ?? null;
}

function minutesOf(ev: MeetEvent): number | null {
  const s = Date.parse(ev.start?.dateTime ?? '');
  const e = Date.parse(ev.end?.dateTime ?? '');
  return Number.isNaN(s) || Number.isNaN(e) ? null : Math.round((e - s) / 60_000);
}

/**
 * The event as a meeting with no Docs read: what a listing shows.
 * @param ev - The calendar event.
 */
export function meetingShell(ev: MeetEvent): MeetMeeting {
  const files = meetFiles(ev);
  const attendees = (ev.attendees ?? []).map(a => a.email).filter((e): e is string => Boolean(e));
  return {
    id: ev.id,
    title: ev.summary ?? '(untitled meeting)',
    started: startOf(ev),
    durationMinutes: minutesOf(ev),
    participants: (ev.attendees ?? []).map(a => a.displayName ?? a.email ?? '').filter(Boolean),
    url: ev.htmlLink ?? null,
    hasTranscript: files.transcript.length > 0 || files.notes.length > 0,
    summary: null,
    transcript: '',
    conferenceId: ev.conferenceData?.conferenceId ?? null,
    attendees,
    recordingUrls: files.recordings.map(r => r.fileUrl).filter((u): u is string => Boolean(u)),
    htmlLink: ev.htmlLink ?? null,
    updated: ev.updated ?? null,
  };
}

/**
 * The event with its transcript and notes Docs read. A Doc that cannot be
 * exported is reported through `onError` and left out; the rest still count.
 * @param token - A Google access token.
 * @param ev - The calendar event.
 * @param onError - Told about each Doc that could not be read.
 */
export async function readMeeting(token: string, ev: MeetEvent, onError?: (fileId: string, message: string) => void): Promise<MeetMeeting> {
  const files = meetFiles(ev);
  const read = async (list: MeetAttachment[]) => {
    const texts: string[] = [];
    for (const a of list) {
      const res = await exportDocText(token, a.fileId!);
      if (res.ok) {
        const text = (res.data ?? '').trim();
        if (text) {
          texts.push(text);
        }
      } else {
        onError?.(a.fileId!, res.message);
      }
    }
    return texts.join('\n\n');
  };
  const transcript = await read(files.transcript);
  const notes = await read(files.notes);
  return { ...meetingShell(ev), summary: notes || null, transcript, hasTranscript: Boolean(transcript || notes) };
}

/**
 * The meeting as the document the sync stores.
 * @param m - The meeting read whole.
 */
export function meetingToDoc(m: MeetMeeting): IngestDoc {
  const content = [
    renderMeeting({ ...m, vendor: 'Google Meet' }),
    m.recordingUrls.length > 0 ? `\nRecording: ${m.recordingUrls.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return {
    externalId: `gmeet:${m.id}`,
    title: `${m.title}${m.started ? ` — ${m.started}` : ''}`,
    content,
    uri: m.htmlLink ?? undefined,
    lastModifiedAt: m.updated ? new Date(m.updated) : null,
    metadata: {
      kind: 'meet-meeting',
      conferenceId: m.conferenceId,
      started: m.started,
      attendees: m.attendees,
      recordingUrls: m.recordingUrls,
      hasTranscript: m.hasTranscript,
    },
  };
}
