/**
 * Twilio Voice connector — the account's calls as searchable documents: who called whom, when,
 * how long, how it ended, and the words of any recording Twilio transcribed. An agent asked
 * "what did the Northwind buyer say when they called on Tuesday" finds the call and cites it.
 *
 * Auth: the account's SID and auth token (`twilio` platform), the same pair texts and WhatsApp
 * spend. Read-only: placing a call is an action (`phone.place_call`), always behind approval.
 *
 * Incremental: Twilio filters calls by start day, so a run with a watermark reads from that day
 * on (a call is re-read once at most). A full run (the weekly reconcile) re-reads the window, so
 * a call deleted from Twilio is tombstoned.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { TwilioCall, TwilioRecording } from '@/libs/twilio/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { listTwilioCalls, listTwilioNumbers, orThrow, readTwilioAccount, twilioCredentialsFrom, twilioRecordingsFor } from '@/libs/twilio/client';
import { InspectInputError } from './inspect';

const twilioVoiceConfigSchema = z.object({
  /** How far back a full run reads. */
  pastDays: z.number().int().positive().max(395).default(30),
  /** Read each call's recordings and their transcriptions (one more request per call). */
  includeRecordings: z.boolean().default(true),
});

/** At most this many pages of 100 calls per run. */
const MAX_PAGES = 50;

/**
 * A call as the words a reader searches.
 * @param call - The call.
 * @param recordings - Its recordings, with transcripts when Twilio made them.
 */
export function callDocument(call: TwilioCall, recordings: readonly TwilioRecording[]): string {
  const lines = [
    `Call ${call.direction ?? ''} from ${call.from ?? 'unknown'}${call.callerName ? ` (${call.callerName})` : ''} to ${call.to ?? 'unknown'}`.replace(/\s+/g, ' '),
    `Started ${call.startTime ?? 'unknown'}; ${call.durationSeconds !== null ? `${call.durationSeconds} seconds` : 'duration unknown'}; status ${call.status ?? 'unknown'}${call.answeredBy ? `; answered by ${call.answeredBy}` : ''}.`,
  ];
  for (const r of recordings) {
    lines.push(r.transcript ? `Transcript of recording ${r.sid}:\n${r.transcript}` : `Recording ${r.sid} (${r.durationSeconds ?? '?'} seconds), not transcribed.`);
  }
  return lines.join('\n');
}

/**
 * Every call in scope, as documents.
 * @param ctx - The run.
 * @param fetchImpl - Injectable for tests.
 * @yields Each document in scope.
 */
export async function* syncTwilioVoice(ctx: SourceContext, fetchImpl: typeof fetch = fetch): AsyncIterable<IngestDoc> {
  const creds = twilioCredentialsFrom(ctx.credentials);
  if (!creds) {
    throw new Error('No Twilio account. Connect Twilio with the Account SID and auth token from the console home.');
  }
  const config = twilioVoiceConfigSchema.parse(ctx.config ?? {});
  const floor = new Date(Date.now() - config.pastDays * 86_400_000);
  const since = ctx.since && ctx.since > floor ? ctx.since : floor;
  let pageUrl: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed: { calls: TwilioCall[]; nextPage: string | null } = orThrow(await listTwilioCalls(creds, { since, pageSize: 100, pageUrl }, fetchImpl));
    const { calls, nextPage } = listed;
    for (const call of calls) {
      const recordings = config.includeRecordings ? await twilioRecordingsFor(creds, call.sid, fetchImpl) : { ok: true as const, data: [] };
      if (!recordings.ok) {
        ctx.onProgress?.({ kind: 'error', uri: `twilio:${call.sid}`, message: recordings.message });
      }
      const recs = recordings.ok ? recordings.data : [];
      ctx.onProgress?.({ kind: 'fetched', uri: `twilio:${call.sid}` });
      yield {
        externalId: `twilio:call:${call.sid}`,
        title: `Call ${call.from ?? '?'} → ${call.to ?? '?'} · ${call.startTime?.slice(0, 16).replace('T', ' ') ?? call.sid}`,
        content: callDocument(call, recs),
        uri: `https://console.twilio.com/us1/monitor/logs/calls?frameUrl=%2Fconsole%2Fvoice%2Fcalls%2Flogs%2F${call.sid}`,
        etag: `${call.status}:${call.durationSeconds}:${recs.length}:${recs.filter(r => r.transcript).length}`,
        lastModifiedAt: call.endTime ? new Date(call.endTime) : call.startTime ? new Date(call.startTime) : null,
        metadata: { callSid: call.sid, from: call.from, to: call.to, direction: call.direction, status: call.status, durationSeconds: call.durationSeconds, recordings: recs.map(r => r.sid) },
      };
    }
    if (!nextPage) {
      break;
    }
    pageUrl = nextPage;
  }
}

/**
 * Test connection: the account, its numbers, and one page of its call log.
 * @param input - The credential as typed or as vaulted.
 * @param input.credentials - The credential values.
 * @param fetchImpl - Injectable for tests.
 */
export async function inspectTwilio(input: { credentials: Record<string, unknown> }, fetchImpl: typeof fetch = fetch): Promise<ConnectorInspection> {
  const creds = twilioCredentialsFrom(input.credentials);
  if (!creds) {
    throw new InspectInputError('No Twilio account. Paste the Account SID and auth token from the console home.');
  }
  const checks: ConnectorCheck[] = [];
  const account = await readTwilioAccount(creds, fetchImpl);
  checks.push({ key: 'account', label: 'Reads the account', ok: account.ok, detail: account.ok ? [account.data.name, account.data.status, account.data.type].filter(Boolean).join(' · ') || null : account.message });
  if (!account.ok) {
    return { reachable: account.status !== null, authorized: account.status !== 401 && account.status !== 403, checks, note: null, error: account.message };
  }
  const numbers = await listTwilioNumbers(creds, fetchImpl);
  checks.push({ key: 'numbers', label: 'Lists its phone numbers', ok: numbers.ok && numbers.data.length > 0, detail: numbers.ok ? (numbers.data.length > 0 ? numbers.data.slice(0, 5).join(', ') : 'The account has no phone number yet; texting and calling need one.') : numbers.message });
  const calls = await listTwilioCalls(creds, { pageSize: 5 }, fetchImpl);
  checks.push({ key: 'calls', label: 'Reads the call log', ok: calls.ok, detail: calls.ok ? `${calls.data.calls.length === 0 ? 'No calls yet' : `Latest call ${calls.data.calls[0]!.startTime ?? ''}`}` : calls.message });
  const failed = checks.filter(c => !c.ok && c.key !== 'numbers');
  return { reachable: true, authorized: true, checks, note: 'Read-only: a test sends nothing and places no call.', error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null };
}

export const twilioVoiceConnector: SourceConnector<typeof twilioVoiceConfigSchema> = {
  slug: 'twilio-voice',
  name: 'Twilio Voice',
  description: 'Your Twilio call log, with recordings\' transcripts, searchable and cited. Agents list and read calls, and can place a call once a person approves it.',
  icon: 'PhoneCall',
  authKind: 'apikey',
  configSchema: twilioVoiceConfigSchema,
  defaultReconcileCron: '30 4 * * 0',
  inspectNote: 'Reads the account, its numbers and its latest calls. Nothing is sent and no call is placed.',
  async inspect({ credentials }) {
    return inspectTwilio({ credentials });
  },
  sync: ctx => syncTwilioVoice(ctx),
};
