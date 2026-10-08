/**
 * Gong connector — recorded calls, with who was on them, Gong's brief and the
 * transcript, as retrievable documents. One document per call.
 *
 * Auth: a Gong API access key and secret (Company settings → Ecosystem → API),
 * HTTP Basic, against the account's base URL (`libs/gong/client.ts`).
 *
 * A full sync walks calls that started in the last `pastDays`; an incremental
 * one starts three days before the watermark, because Gong lists calls by
 * when they started and a transcript lands after the call ends. Private calls
 * are never read. Deleted calls fall out on the weekly full reconcile.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import type { MeetingTranscript } from '@/services/meetings/provider';
import { z } from 'zod';
import { gongCredentialsFrom, listGongCalls, readGongMeetings, readGongWorkspaces } from '@/libs/gong/client';
import { meetingSyncWindow, renderMeeting } from '@/services/meetings/provider';
import { InspectInputError } from './inspect';

const gongConfigSchema = z.object({
  /** How far back a full sync reads calls. */
  pastDays: z.number().int().positive().default(60),
});

/**
 * One Gong call as the document the index keeps.
 * @param m - The call, read whole.
 */
export function gongDoc(m: MeetingTranscript & { emails: string[] }): IngestDoc {
  return {
    externalId: `gong:${m.id}`,
    title: `${m.title}${m.started ? ` — ${m.started}` : ''}`,
    content: renderMeeting({ ...m, vendor: 'Gong' }),
    uri: m.url ?? undefined,
    lastModifiedAt: m.started ? new Date(m.started) : null,
    metadata: {
      kind: 'gong-call',
      started: m.started,
      durationMinutes: m.durationMinutes,
      participants: m.emails.length > 0 ? m.emails : m.participants,
      url: m.url,
      hasTranscript: m.hasTranscript,
    },
  };
}

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the workspaces the key sees. Read-only and free.
 * @param credentials - The credential values, as typed or as vaulted.
 */
export async function inspectGong(credentials: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = gongCredentialsFrom(credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const res = await readGongWorkspaces(parsed.credentials);
  if (!res.ok) {
    return { reachable: res.status !== null, authorized: false, checks: [check('account', 'Key accepted', false, res.message)], note: null, error: res.message };
  }
  const names = res.data.map(w => w.name || w.id).filter(Boolean);
  return {
    reachable: true,
    authorized: true,
    checks: [check('account', 'Key accepted', true, names.length > 0 ? `Gong workspaces: ${names.join(', ')}.` : 'The key works; Gong listed no workspace.')],
    note: 'Nothing was saved by this test.',
    error: null,
  };
}

export const gongConnector: SourceConnector<typeof gongConfigSchema> = {
  slug: 'gong',
  name: 'Gong',
  brand: 'gong',
  description: 'Recorded calls from Gong. Who was on each call, Gong\'s brief and key points, and the transcript.',
  icon: 'PhoneCall',
  authKind: 'apikey',
  configSchema: gongConfigSchema,
  defaultReconcileCron: '0 5 * * 0',
  inspectNote: 'Reads the Gong workspaces the key sees. Read-only and free. Nothing is saved.',

  async inspect({ credentials }) {
    return inspectGong(credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = gongConfigSchema.parse(ctx.config);
    const parsed = gongCredentialsFrom(ctx.credentials);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const calls = await listGongCalls(parsed.credentials, meetingSyncWindow(ctx, cfg.pastDays));
    if (!calls.ok) {
      throw new Error(calls.message);
    }
    for await (const meeting of readGongMeetings(parsed.credentials, calls.data, message => ctx.onProgress?.({ kind: 'error', message }))) {
      ctx.onProgress?.({ kind: 'fetched', uri: meeting.id });
      yield gongDoc(meeting);
    }
  },
};
