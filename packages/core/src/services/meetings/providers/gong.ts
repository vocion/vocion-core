/**
 * GONG — a provider of the meetings family (`../provider.ts`).
 *
 * One client per call, on the source's own stored key, the same key and the
 * same rendering its sync uses (`libs/gong/client.ts`), so a call read live
 * says what the synced copy says.
 */

import type { MeetingProvider } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { gongMeeting as gongMeetingOf } from '@/libs/gong/client';
import { familySourceCredentials } from '@/libs/connectors/familyCredentials';
import { orThrow } from '@/libs/connectors/vendorFetch';
import { gongCredentialsFrom, listGongCalls, readGongMeetings } from '@/libs/gong/client';

/**
 * The Gong provider for one source.
 * @param orgId - The workspace.
 * @param source - The gong source.
 */
export async function gongMeetingProvider(orgId: string, source: FamilySource): Promise<MeetingProvider> {
  const parsed = gongCredentialsFrom(await familySourceCredentials(orgId, source));
  if (!parsed.ok) {
    throw new Error(`${source.slug}: ${parsed.message}`);
  }
  const c = parsed.credentials;
  return {
    kind: 'gong',
    sourceSlug: source.slug,
    externalId: id => `gong:${id}`,
    async findMeetings({ from, to, limit }) {
      const calls = orThrow(await listGongCalls(c, { from, to }));
      return calls
        .map(call => ({
          id: call.id,
          title: call.title?.trim() || '(untitled call)',
          started: call.started ?? call.scheduled ?? null,
          durationMinutes: typeof call.duration === 'number' ? call.duration / 60 : null,
          participants: [],
          url: call.url ?? null,
          // Gong's call list does not say; the read does.
          hasTranscript: true,
        }))
        .sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''))
        .slice(0, limit);
    },
    async readTranscript(id) {
      if (!/^\d{1,30}$/.test(id)) {
        throw new Error(`${id} is not a Gong call id (a number, from meeting_find_recordings).`);
      }
      let failure: string | null = null;
      const read: Array<Awaited<ReturnType<typeof gongMeetingOf>>> = [];
      for await (const meeting of readGongMeetings(c, [{ id }], (message) => {
        failure = message;
      })) {
        read.push(meeting);
      }
      if (failure) {
        throw new Error(failure);
      }
      const meeting = read[0];
      // A call Gong cannot show comes back with nothing but its id.
      if (!meeting || (!meeting.hasTranscript && !meeting.summary && meeting.title === '(untitled call)')) {
        return null;
      }
      const { emails: _emails, ...rest } = meeting;
      return rest;
    },
  };
}
