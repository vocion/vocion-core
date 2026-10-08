/**
 * FIREFLIES — a provider of the meetings family (`../provider.ts`).
 *
 * One client per call, on the source's own stored key, rendering through the
 * same function its sync does (`libs/fireflies/client.ts`). Fireflies' free
 * and Pro plans allow 50 API requests a day, which is why the family's read
 * tool answers from the synced copy first.
 */

import type { MeetingProvider } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import { familySourceCredentials } from '@/libs/connectors/familyCredentials';
import { orThrow } from '@/libs/connectors/vendorFetch';
import { firefliesCredentialsFrom, firefliesMeeting, listFirefliesTranscripts, readFirefliesTranscript } from '@/libs/fireflies/client';

/**
 * The Fireflies provider for one source.
 * @param orgId - The workspace.
 * @param source - The fireflies source.
 */
export async function firefliesMeetingProvider(orgId: string, source: FamilySource): Promise<MeetingProvider> {
  const parsed = firefliesCredentialsFrom(await familySourceCredentials(orgId, source));
  if (!parsed.ok) {
    throw new Error(`${source.slug}: ${parsed.message}`);
  }
  const { token } = parsed;
  return {
    kind: 'fireflies',
    sourceSlug: source.slug,
    externalId: id => `fireflies:${id}`,
    async findMeetings({ from, to, limit }) {
      const list = orThrow(await listFirefliesTranscripts(token, { from, to }, limit));
      return list
        .map((t) => {
          const { emails: _emails, summary: _summary, transcript: _transcript, ...summary } = firefliesMeeting(t);
          return summary;
        })
        .sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''))
        .slice(0, limit);
    },
    async readTranscript(id) {
      const t = orThrow(await readFirefliesTranscript(token, id));
      if (!t) {
        return null;
      }
      const { emails: _emails, ...meeting } = firefliesMeeting(t);
      return meeting;
    },
  };
}
