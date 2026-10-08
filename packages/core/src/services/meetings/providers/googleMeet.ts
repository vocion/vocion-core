/**
 * GOOGLE MEET — a provider of the meetings family (`../provider.ts`), read
 * through the workspace's Google login the way the `google-meet` source syncs
 * (`libs/googleMeet/client.ts`): Calendar for the meetings, Drive for the
 * transcript and Gemini notes Meet attached to each one.
 *
 * A meeting's id is its calendar event id, the same id its synced document
 * carries (`gmeet:<eventId>`).
 */

import type { MeetingProvider, MeetingSummary } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import { familySourceCredentials } from '@/libs/connectors/familyCredentials';
import { getEvent, hasMeetFiles, isMeetEvent, listEventsPage, meetingShell, readMeeting } from '@/libs/googleMeet/client';
import { resolveGoogleAccessToken } from '@/libs/sources/googleAuth';

/**
 * The meetings provider for one `google-meet` source.
 * @param orgId - The workspace.
 * @param source - The source, as `familySourcesForOrg` returned it.
 */
export async function googleMeetMeetingProvider(orgId: string, source: FamilySource): Promise<MeetingProvider> {
  const calendarId = typeof source.config.calendarId === 'string' && source.config.calendarId ? source.config.calendarId : 'primary';
  const credentials = await familySourceCredentials(orgId, source);
  if (!credentials) {
    throw new Error(`The ${source.slug} source has no Google login stored. An admin needs to log in with Google for Google Meet on the Connectors page.`);
  }
  const token = await resolveGoogleAccessToken(credentials, orgId);

  return {
    kind: 'google-meet',
    sourceSlug: source.slug,
    externalId: id => `gmeet:${id}`,

    async findMeetings({ from, to, limit }) {
      const found: MeetingSummary[] = [];
      let pageToken: string | undefined;
      do {
        const page = await listEventsPage({ token, calendarId, from, to, pageToken });
        if (!page.ok) {
          throw new Error(page.message);
        }
        for (const ev of page.data.items ?? []) {
          if (isMeetEvent(ev) && hasMeetFiles(ev)) {
            const { summary: _s, transcript: _t, conferenceId: _c, attendees: _a, recordingUrls: _r, htmlLink: _h, updated: _u, ...shell } = meetingShell(ev);
            found.push(shell);
          }
        }
        pageToken = page.data.nextPageToken;
      } while (pageToken);
      return found
        .sort((a, b) => Date.parse(b.started ?? '') - Date.parse(a.started ?? ''))
        .slice(0, limit);
    },

    async readTranscript(id) {
      const ev = await getEvent(token, calendarId, id);
      if (!ev || !isMeetEvent(ev)) {
        return null;
      }
      const meeting = await readMeeting(token, ev);
      const { conferenceId: _c, attendees: _a, recordingUrls: _r, htmlLink: _h, updated: _u, ...transcript } = meeting;
      return transcript;
    },
  };
}
