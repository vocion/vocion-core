/**
 * Fireflies connector — meeting transcripts and Fireflies' own summaries, as
 * retrievable documents. One document per meeting.
 *
 * Auth: a Fireflies API key (Settings → Developer settings), Bearer, against
 * the GraphQL API (`libs/fireflies/client.ts`).
 *
 * A full sync reads meetings held in the last `pastDays`; an incremental one
 * starts three days before the watermark, since a transcript lands after the
 * meeting. Each page of 50 carries its sentences and summaries, because the
 * free and Pro plans allow only 50 API requests a day. Deleted transcripts
 * fall out on the weekly full reconcile.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import type { MeetingTranscript } from '@/services/meetings/provider';
import { z } from 'zod';
import { firefliesCredentialsFrom, firefliesMeeting, listFirefliesTranscripts, readFirefliesUser } from '@/libs/fireflies/client';
import { meetingSyncWindow, renderMeeting } from '@/services/meetings/provider';
import { InspectInputError } from './inspect';

const firefliesConfigSchema = z.object({
  /** How far back a full sync reads meetings. */
  pastDays: z.number().int().positive().default(60),
});

/**
 * One Fireflies meeting as the document the index keeps.
 * @param m - The meeting, read whole.
 */
export function firefliesDoc(m: MeetingTranscript & { emails: string[] }): IngestDoc {
  return {
    externalId: `fireflies:${m.id}`,
    title: `${m.title}${m.started ? ` — ${m.started}` : ''}`,
    content: renderMeeting({ ...m, vendor: 'Fireflies' }),
    uri: m.url ?? undefined,
    lastModifiedAt: m.started ? new Date(m.started) : null,
    metadata: {
      kind: 'fireflies-transcript',
      started: m.started,
      durationMinutes: m.durationMinutes,
      participants: m.emails,
      url: m.url,
      hasTranscript: m.hasTranscript,
    },
  };
}

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: whose key it is. Spends one of the plan's API requests.
 * @param credentials - The credential values, as typed or as vaulted.
 */
export async function inspectFireflies(credentials: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = firefliesCredentialsFrom(credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const res = await readFirefliesUser(parsed.token);
  if (!res.ok) {
    return { reachable: res.status !== null, authorized: false, checks: [check('account', 'Key accepted', false, res.message)], note: null, error: res.message };
  }
  const who = res.data.name ? `${res.data.name}${res.data.email ? ` (${res.data.email})` : ''}` : (res.data.email ?? 'an account with no name');
  return {
    reachable: true,
    authorized: true,
    checks: [check('account', 'Key accepted', true, `The key belongs to ${who}.`)],
    note: 'Nothing was saved by this test.',
    error: null,
  };
}

export const firefliesConnector: SourceConnector<typeof firefliesConfigSchema> = {
  slug: 'fireflies',
  name: 'Fireflies',
  brand: 'fireflies',
  description: 'Meeting transcripts from Fireflies.ai. Who attended, Fireflies\' summary and action items, and the transcript by speaker.',
  icon: 'Mic',
  authKind: 'apikey',
  configSchema: firefliesConfigSchema,
  defaultReconcileCron: '0 5 * * 0',
  inspectNote: 'Reads whose key it is. Read-only, and spends one of the plan\'s daily API requests (50 a day on the free and Pro plans). Nothing is saved.',

  async inspect({ credentials }) {
    return inspectFireflies(credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = firefliesConfigSchema.parse(ctx.config);
    const parsed = firefliesCredentialsFrom(ctx.credentials);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const list = await listFirefliesTranscripts(parsed.token, meetingSyncWindow(ctx, cfg.pastDays));
    if (!list.ok) {
      throw new Error(list.message);
    }
    for (const t of list.data) {
      ctx.onProgress?.({ kind: 'fetched', uri: t.id });
      yield firefliesDoc(firefliesMeeting(t));
    }
  },
};
