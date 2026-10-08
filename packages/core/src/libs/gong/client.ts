/**
 * Shared Gong API client — the one place that knows how to talk to a Gong
 * account. The `gong` connector's sync and Test connection and the meetings
 * family's Gong provider all go through it, so the Basic header, the
 * account-specific base URL, the batching and the rendering of a call exist
 * exactly once.
 *
 * Read-only. Gong's API keys come from Company settings → Ecosystem → API
 * (an admin page): an access key and its secret, sent as HTTP Basic against
 * the base URL that same page shows (`https://us-NNNN.api.gong.io`, or the
 * generic `https://api.gong.io`).
 *
 * Gong allows 3 requests a second and 10,000 a day, so a walk paces itself
 * and asks for parties, briefs and transcripts in batches of call ids.
 */

import type { VendorResult } from '@/libs/connectors/vendorFetch';
import type { MeetingTranscript } from '@/services/meetings/provider';
import { Buffer } from 'node:buffer';
import { credentialString, pace, vendorRequest } from '@/libs/connectors/vendorFetch';
import { foldTurns } from '@/services/meetings/provider';

export const GONG_DEFAULT_BASE_URL = 'https://api.gong.io';
/** Gong's limit is 3 requests a second; stay under it. */
export const GONG_PACE_MS = 350;
/** Call ids per extensive/transcript request. */
export const GONG_BATCH = 50;

export type GongCredentials = { baseUrl: string; accessKey: string; accessKeySecret: string };

const AUTH_HINT = 'Check the access key and secret on Gong\'s Company settings → Ecosystem → API page, and that the base URL is the one shown there.';

/**
 * The vaulted credential, or the reason it cannot be used. The three field
 * names are the storage contract with the `gong` platform descriptor.
 * @param values - The decrypted credential bag.
 */
export function gongCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: GongCredentials } | { ok: false; message: string } {
  const accessKey = credentialString(values, 'accessKey');
  const accessKeySecret = credentialString(values, 'accessKeySecret');
  const rawBase = credentialString(values, 'baseUrl') || GONG_DEFAULT_BASE_URL;
  const baseUrl = rawBase.replace(/\/+$/, '').replace(/\/v2$/i, '');
  if (!accessKey || !accessKeySecret) {
    return { ok: false, message: 'No Gong access key and secret are stored for this workspace. An admin makes them in Gong under Company settings → Ecosystem → API, and pastes both on the Connectors page.' };
  }
  if (!/^https:\/\/[^\s/]+$/i.test(baseUrl)) {
    return { ok: false, message: 'The Gong base URL must be an https:// address such as https://api.gong.io, as shown on Gong\'s API settings page.' };
  }
  return { ok: true, credentials: { baseUrl, accessKey, accessKeySecret } };
}

function headers(c: GongCredentials): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${c.accessKey}:${c.accessKeySecret}`).toString('base64')}` };
}

async function gong<T>(c: GongCredentials, path: string, init: { method?: 'GET' | 'POST'; json?: unknown } = {}): Promise<VendorResult<T>> {
  return vendorRequest<T>({ vendor: 'Gong', url: `${c.baseUrl}${path}`, method: init.method ?? 'GET', json: init.json, headers: headers(c), authHint: AUTH_HINT });
}

export type GongWorkspace = { id: string; name?: string; description?: string };

/**
 * Test connection's read: the workspaces the key sees. Free and read-only.
 * @param c - The credentials.
 */
export async function readGongWorkspaces(c: GongCredentials): Promise<VendorResult<GongWorkspace[]>> {
  const res = await gong<{ workspaces?: GongWorkspace[] }>(c, '/v2/workspaces');
  return res.ok ? { ok: true, status: res.status, data: res.data?.workspaces ?? [] } : res;
}

export type GongCall = {
  id: string;
  url?: string;
  title?: string;
  started?: string;
  scheduled?: string;
  duration?: number;
  isPrivate?: boolean;
};

type GongCallsPage = { calls?: GongCall[]; records?: { cursor?: string } };

/**
 * Calls that started inside the window, private ones left out. Follows the
 * cursor to the end; a failed page is returned as the failure.
 * @param c - The credentials.
 * @param window - The window.
 * @param window.from - Start, inclusive.
 * @param window.to - End.
 */
export async function listGongCalls(c: GongCredentials, window: { from: Date; to: Date }): Promise<VendorResult<GongCall[]>> {
  const out: GongCall[] = [];
  let cursor: string | undefined;
  let first = true;
  do {
    if (!first) {
      await pace(GONG_PACE_MS);
    }
    first = false;
    const params = new URLSearchParams({ fromDateTime: window.from.toISOString(), toDateTime: window.to.toISOString() });
    if (cursor) {
      params.set('cursor', cursor);
    }
    const res = await gong<GongCallsPage>(c, `/v2/calls?${params.toString()}`);
    if (!res.ok) {
      // Gong answers 404 "No calls found" for an empty window.
      if (res.error === 'not_found') {
        return { ok: true, status: 200, data: out };
      }
      return res;
    }
    for (const call of res.data?.calls ?? []) {
      if (!call.isPrivate) {
        out.push(call);
      }
    }
    cursor = res.data?.records?.cursor || undefined;
  } while (cursor);
  return { ok: true, status: 200, data: out };
}

type GongParty = { id?: string; speakerId?: string | null; name?: string; emailAddress?: string; affiliation?: string };
export type GongExtensive = {
  metaData?: GongCall;
  parties?: GongParty[];
  content?: {
    brief?: string;
    keyPoints?: Array<{ text?: string }>;
    outline?: Array<{ section?: string; items?: Array<{ text?: string }> }>;
    callOutcome?: { name?: string } | null;
  };
};
export type GongCallTranscript = { callId: string; transcript?: Array<{ speakerId?: string; sentences?: Array<{ start?: number; end?: number; text?: string }> }> };

/**
 * Parties and Gong's brief for a batch of calls.
 * @param c - The credentials.
 * @param callIds - At most `GONG_BATCH` ids.
 */
export async function readGongExtensive(c: GongCredentials, callIds: string[]): Promise<VendorResult<GongExtensive[]>> {
  const res = await gong<{ calls?: GongExtensive[] }>(c, '/v2/calls/extensive', {
    method: 'POST',
    json: {
      filter: { callIds },
      contentSelector: { exposedFields: { parties: true, content: { brief: true, keyPoints: true, outline: true, callOutcome: true } } },
    },
  });
  // Gong answers 404 when none of the ids is a call it can show.
  if (!res.ok && res.error === 'not_found') {
    return { ok: true, status: 200, data: [] };
  }
  return res.ok ? { ok: true, status: res.status, data: res.data?.calls ?? [] } : res;
}

/**
 * Transcripts for a batch of calls.
 * @param c - The credentials.
 * @param callIds - At most `GONG_BATCH` ids.
 */
export async function readGongTranscripts(c: GongCredentials, callIds: string[]): Promise<VendorResult<GongCallTranscript[]>> {
  const res = await gong<{ callTranscripts?: GongCallTranscript[] }>(c, '/v2/calls/transcript', { method: 'POST', json: { filter: { callIds } } });
  if (!res.ok && res.error === 'not_found') {
    return { ok: true, status: 200, data: [] };
  }
  return res.ok ? { ok: true, status: res.status, data: res.data?.callTranscripts ?? [] } : res;
}

/**
 * One call as the meetings family reads it: parties named, the brief and key
 * points as the summary, the transcript folded by speaker. The sync and the
 * live read both render through this.
 * @param call - The call's metadata.
 * @param extensive - Its parties and content, if read.
 * @param transcript - Its transcript, if read.
 */
export function gongMeeting(call: GongCall, extensive?: GongExtensive, transcript?: GongCallTranscript): MeetingTranscript & { emails: string[] } {
  const meta = { ...call, ...extensive?.metaData, id: call.id };
  const parties = extensive?.parties ?? [];
  const bySpeaker = new Map(parties.filter(p => p.speakerId).map(p => [String(p.speakerId), p.name || p.emailAddress || 'Speaker']));
  const segments = (transcript?.transcript ?? []).flatMap(block => (block.sentences ?? []).map(s => ({ speaker: bySpeaker.get(String(block.speakerId)) ?? 'Speaker', text: s.text ?? '' })));
  const text = foldTurns(segments);
  const content = extensive?.content;
  const summary = [
    content?.brief?.trim(),
    content?.keyPoints?.length ? `Key points:\n${content.keyPoints.map(k => `- ${k.text ?? ''}`).join('\n')}` : '',
    content?.callOutcome?.name ? `Outcome: ${content.callOutcome.name}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    id: call.id,
    title: meta.title?.trim() || '(untitled call)',
    started: meta.started ?? meta.scheduled ?? null,
    durationMinutes: typeof meta.duration === 'number' ? meta.duration / 60 : null,
    participants: parties.map(p => p.name || p.emailAddress || '').filter(Boolean),
    emails: parties.map(p => p.emailAddress ?? '').filter(Boolean),
    url: meta.url ?? null,
    hasTranscript: text !== '',
    summary: summary || null,
    transcript: text,
  };
}

/**
 * Calls read whole, in batches: parties, brief and transcript for each. A
 * batch whose details fail is reported and skipped, never yielded bare: a
 * bare call would overwrite the transcript the index already holds, and the
 * reported failure holds the sync's watermark so the next run reads it again.
 * @param c - The credentials.
 * @param calls - The calls to read.
 * @param onBatchError - Called with the sentence when a batch's details fail.
 * @yields {MeetingTranscript} Each call that was read whole.
 */
export async function* readGongMeetings(c: GongCredentials, calls: GongCall[], onBatchError?: (message: string) => void): AsyncIterable<MeetingTranscript & { emails: string[] }> {
  for (let i = 0; i < calls.length; i += GONG_BATCH) {
    const batch = calls.slice(i, i + GONG_BATCH);
    const ids = batch.map(call => call.id);
    await pace(GONG_PACE_MS);
    const ext = await readGongExtensive(c, ids);
    await pace(GONG_PACE_MS);
    const tr = await readGongTranscripts(c, ids);
    if (!ext.ok || !tr.ok) {
      onBatchError?.(`Gong calls ${ids.join(', ')}: ${!ext.ok ? ext.message : (tr as { message: string }).message}`);
      continue;
    }
    const extById = new Map(ext.data.map(e => [String(e.metaData?.id), e]));
    const trById = new Map(tr.data.map(t => [String(t.callId), t]));
    for (const call of batch) {
      yield gongMeeting(call, extById.get(call.id), trById.get(call.id));
    }
  }
}
