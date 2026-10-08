/**
 * Google Meet connector — recorded meetings, their transcripts and Gemini
 * notes, through the workspace's Google login (`libs/googleMeet/client.ts`).
 *
 * Auth: the shared `google` credential (a "Log in with Google" for Google Meet
 * asks for calendar.readonly + drive.readonly only), resolved the way every
 * Google connector resolves it (`googleAuth.ts`). No second Google client.
 *
 * A full sync walks meetings that already happened in the last `pastDays`; an
 * incremental one asks Calendar only for events changed since the watermark
 * (`updatedMin`). Meet attaching a transcript to an event changes the event,
 * so a transcript that lands after the call is picked up by the next run. An
 * event with nothing from Meet on it yields nothing — the Google Calendar
 * connector already indexes plain events. Recordings are links, never bytes.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { hasMeetFiles, isMeetEvent, listEventsPage, meetingToDoc, probeDrive, readMeeting } from '@/libs/googleMeet/client';
import { resolveGoogleAccessToken } from './googleAuth';
import { InspectInputError } from './inspect';

const googleMeetConfigSchema = z.object({
  /** Calendar whose Meet meetings are read — `primary` or a calendar id. */
  calendarId: z.string().min(1).default('primary'),
  /** How far back a full sync reads meetings. */
  pastDays: z.number().int().positive().default(60),
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the login resolves, Calendar lists Meet meetings, Drive
 * answers. Read-only and free. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config.
 * @param input.credentials - The credential values.
 * @param orgId - The workspace, for finding the login app a login was made on.
 */
export async function inspectGoogleMeet(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, orgId: string): Promise<ConnectorInspection> {
  const cfg = googleMeetConfigSchema.parse(input.config ?? {});
  let token: string;
  try {
    token = await resolveGoogleAccessToken(input.credentials, orgId);
  } catch (error) {
    throw new InspectInputError(error instanceof Error ? error.message : 'The Google login could not be used.');
  }
  const checks: ConnectorCheck[] = [];
  const now = new Date();
  const events = await listEventsPage({ token, calendarId: cfg.calendarId, from: new Date(now.getTime() - cfg.pastDays * 86_400_000), to: now });
  if (!events.ok) {
    checks.push(check('calendar', 'Reads the calendar\'s meetings', false, events.message));
    return { reachable: events.status !== null, authorized: false, checks, note: null, error: events.message };
  }
  const meet = (events.data.items ?? []).filter(isMeetEvent);
  const recorded = meet.filter(hasMeetFiles);
  checks.push(check('calendar', 'Reads the calendar\'s meetings', true, `${meet.length} Google Meet meeting(s) in the last ${cfg.pastDays} days on the first page, ${recorded.length} with a transcript, notes or recording.`));
  const drive = await probeDrive(token);
  checks.push(check('drive', 'Reads Drive (where Meet keeps transcripts)', drive.ok, drive.ok ? null : drive.message));
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: recorded.length === 0 ? 'No meeting on this calendar carries a Meet transcript yet. Transcripts need a Google Workspace edition that supports them, turned on in the meeting.' : null,
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const googleMeetConnector: SourceConnector<typeof googleMeetConfigSchema> = {
  slug: 'google-meet',
  name: 'Google Meet',
  brand: 'googlemeet',
  description: 'Recorded Google Meet meetings: the transcript and Gemini notes Meet attached to each calendar event, read from Drive. Recordings are kept as links.',
  icon: 'Video',
  authKind: 'oauth',
  configSchema: googleMeetConfigSchema,
  // Incremental runs cannot see a deleted event or transcript; a weekly full
  // walk lets the tombstone pass retire them.
  defaultReconcileCron: '0 4 * * 0',
  inspectNote: 'Reads one page of the calendar\'s meetings and checks Drive answers. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials, savedSource }) {
    return inspectGoogleMeet({ config, credentials }, savedSource?.orgId ?? '');
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = googleMeetConfigSchema.parse(ctx.config);
    const token = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const now = new Date();
    const from = new Date(now.getTime() - cfg.pastDays * 86_400_000);
    let pageToken: string | undefined;
    do {
      const page = await listEventsPage({ token, calendarId: cfg.calendarId, from, to: now, updatedMin: ctx.since ?? null, pageToken });
      if (!page.ok) {
        throw new Error(`Google Meet meetings could not be listed: ${page.message}`);
      }
      for (const ev of page.data.items ?? []) {
        if (!isMeetEvent(ev) || !hasMeetFiles(ev)) {
          ctx.onProgress?.({ kind: 'skipped', uri: ev.id });
          continue;
        }
        const meeting = await readMeeting(token, ev, (fileId, message) => ctx.onProgress?.({ kind: 'error', uri: ev.id, message: `Meet file ${fileId}: ${message}` }));
        ctx.onProgress?.({ kind: 'fetched', uri: ev.id });
        yield meetingToDoc(meeting);
      }
      pageToken = page.data.nextPageToken;
    } while (pageToken);
  },
};
