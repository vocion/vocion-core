/**
 * Zoom connector — ingest cloud recordings (meeting metadata + transcript)
 * as retrievable documents, company-wide.
 *
 * Auth: Server-to-Server OAuth (account-level, no per-user consent).
 * Credentials: { accountId, clientId, clientSecret } — mint an access token
 * per run (cached ~55 min; Zoom tokens live 1h).
 *
 * Walks active users, then each user's cloud recordings over a rolling
 * window (Zoom caps each list call at a 30-day span, so the window is
 * chunked). When a TRANSCRIPT file exists on a meeting, its VTT is
 * downloaded and flattened into readable "SPEAKER: text" lines.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

const zoomConfigSchema = z.object({
  /** How far back to index recordings. */
  pastDays: z.number().int().positive().default(30),
  /** Restrict to specific user emails; empty = every active user (company-wide). */
  users: z.array(z.string()).default([]),
  apiBaseUrl: z.string().url().default('https://api.zoom.us/v2'),
  authBaseUrl: z.string().url().default('https://zoom.us'),
});

type ZoomUserList = { users?: Array<{ id: string; email: string }>; next_page_token?: string };
type ZoomRecordingList = {
  meetings?: Array<{
    uuid: string;
    id: number;
    topic?: string;
    start_time?: string;
    duration?: number;
    host_email?: string;
    share_url?: string;
    recording_files?: Array<{
      id?: string;
      file_type?: string;
      download_url?: string;
      recording_start?: string;
    }>;
  }>;
  next_page_token?: string;
};

type ZoomMeeting = NonNullable<ZoomRecordingList['meetings']>[number];

/** The granular scopes a Server-to-Server OAuth app needs for this connector's reads. */
export const ZOOM_REQUIRED_SCOPES: readonly string[] = [
  'user:read:list_users:admin',
  'cloud_recording:read:list_user_recordings:admin',
  'cloud_recording:read:list_recording_files:admin',
];

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function mintToken(authBaseUrl: string, credentials: Record<string, unknown> | undefined): Promise<string> {
  const accountId = credentials?.accountId as string | undefined;
  const clientId = credentials?.clientId as string | undefined;
  const clientSecret = credentials?.clientSecret as string | undefined;
  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom credentials missing — store { accountId, clientId, clientSecret } from a Server-to-Server OAuth app.');
  }
  const cacheKey = `${accountId}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return cached.token;
  }
  const res = await fetch(`${authBaseUrl}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
  });
  if (!res.ok) {
    throw new Error(`Zoom token mint failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

/**
 * Flatten a Zoom VTT transcript into "SPEAKER: text" lines.
 * @param vtt
 */
function vttToText(vtt: string): string {
  return vtt
    .split('\n')
    .filter(line => line.trim() !== '' && line.trim() !== 'WEBVTT' && !/^\d+$/.test(line.trim()) && !line.includes('-->'))
    .join('\n');
}

/**
 * Build the IngestDoc for one recorded meeting. Shared by the sync loop and
 * the targeted fetch below so tool-upserted transcripts are byte-identical to
 * sync-ingested ones — a later scheduled sync re-ingest is then a
 * hash-unchanged no-op instead of a pointless re-embed.
 * @param mtg
 * @param transcript
 * @param fallbackHostEmail
 */
export function recordingToDoc(mtg: ZoomMeeting, transcript: string, fallbackHostEmail: string): IngestDoc {
  return {
    externalId: `zoom:${mtg.uuid}`,
    title: `${mtg.topic ?? 'Zoom meeting'} — ${mtg.start_time ?? ''}`,
    content: [
      `Meeting: ${mtg.topic ?? '(untitled)'}`,
      `When: ${mtg.start_time ?? 'unknown'} (${mtg.duration ?? '?'} min)`,
      `Host: ${mtg.host_email ?? fallbackHostEmail}`,
      transcript ? `\nTranscript:\n${transcript}` : '\n(no transcript available)',
    ].join('\n'),
    lastModifiedAt: mtg.start_time ? new Date(mtg.start_time) : null,
    metadata: {
      kind: 'zoom-recording',
      meetingId: mtg.id,
      host: mtg.host_email ?? fallbackHostEmail,
      start: mtg.start_time ?? null,
      durationMin: mtg.duration ?? null,
      hasTranscript: !!transcript,
      // Deep link for review surfaces (the discovery card's "Meeting").
      shareUrl: mtg.share_url ?? null,
    },
  };
}

/**
 * Fetch one meeting's cloud recording + transcript on demand (the read-through
 * miss path of `get_zoom_transcript`). Returns `null` when Zoom has no
 * recording for the id; `hasTranscript: false` when the recording exists but
 * the transcript file isn't ready yet (Zoom processes them asynchronously).
 * @param opts
 * @param opts.credentials
 * @param opts.meetingId
 * @param opts.apiBaseUrl
 * @param opts.authBaseUrl
 */
export async function fetchZoomMeetingTranscript(opts: {
  credentials: Record<string, unknown> | undefined;
  /** Meeting UUID (preferred) or numeric meeting id. */
  meetingId: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
}): Promise<{ doc: IngestDoc; hasTranscript: boolean } | null> {
  const api = opts.apiBaseUrl ?? 'https://api.zoom.us/v2';
  const token = await mintToken(opts.authBaseUrl ?? 'https://zoom.us', opts.credentials);
  const headers = { authorization: `Bearer ${token}` };

  // Zoom API rule: a UUID that begins with '/' or contains '//' must be
  // DOUBLE URL-encoded in the path; anything else single-encodes.
  const needsDouble = opts.meetingId.startsWith('/') || opts.meetingId.includes('//');
  const encoded = needsDouble
    ? encodeURIComponent(encodeURIComponent(opts.meetingId))
    : encodeURIComponent(opts.meetingId);

  const res = await fetch(`${api}/meetings/${encoded}/recordings`, { headers });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Zoom recordings fetch failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const mtg = (await res.json()) as ZoomMeeting;

  const transcriptFile = (mtg.recording_files ?? []).find(f => f.file_type === 'TRANSCRIPT');
  let transcript = '';
  if (transcriptFile?.download_url) {
    const tRes = await fetch(`${transcriptFile.download_url}?access_token=${encodeURIComponent(token)}`);
    if (tRes.ok) {
      transcript = vttToText(await tRes.text());
    }
  }
  return { doc: recordingToDoc(mtg, transcript, mtg.host_email ?? ''), hasTranscript: !!transcript };
}

function* dayWindows(fromMs: number, toMs: number): Generator<{ from: string; to: string }> {
  // Zoom caps recording lists at a 30-day span per request.
  const span = 30 * 86_400_000;
  for (let start = fromMs; start < toMs; start += span) {
    const end = Math.min(start + span, toMs);
    yield {
      from: new Date(start).toISOString().slice(0, 10),
      to: new Date(end).toISOString().slice(0, 10),
    };
  }
}

export const zoomConnector: SourceConnector<typeof zoomConfigSchema> = {
  slug: 'zoom',
  name: 'Zoom',
  description: 'Ingest cloud-recording meetings + transcripts, company-wide (Server-to-Server OAuth).',
  icon: 'Video',
  authKind: 'oauth',
  configSchema: zoomConfigSchema,
  // What the Server-to-Server app must be granted. Zoom's own error names the
  // missing ones by these ids (code 4711, 2026-09-18 on prod), so the page can
  // mark exactly which to add.
  requiredScopes: ZOOM_REQUIRED_SCOPES,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = zoomConfigSchema.parse(ctx.config);
    const token = await mintToken(cfg.authBaseUrl, ctx.credentials);
    const headers = { authorization: `Bearer ${token}` };

    // Incremental: only fetch from the watermark forward (bounded below by
    // the configured window so the index never grows unbounded).
    const now = Date.now();
    const windowStart = now - cfg.pastDays * 86_400_000;
    const fromMs = ctx.since ? Math.max(ctx.since.getTime(), windowStart) : windowStart;

    // Resolve the user set: explicit list, or every active user.
    const userIds: Array<{ id: string; email: string }> = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ status: 'active', page_size: '300' });
      if (pageToken) {
        params.set('next_page_token', pageToken);
      }
      const res = await fetch(`${cfg.apiBaseUrl}/users?${params.toString()}`, { headers });
      if (!res.ok) {
        throw new Error(`Zoom user list failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const list = (await res.json()) as ZoomUserList;
      for (const u of list.users ?? []) {
        if (cfg.users.length === 0 || cfg.users.includes(u.email)) {
          userIds.push(u);
        }
      }
      pageToken = list.next_page_token || undefined;
    } while (pageToken);

    for (const user of userIds) {
      for (const window of dayWindows(fromMs, now)) {
        let recPageToken: string | undefined;
        do {
          const params = new URLSearchParams({ from: window.from, to: window.to, page_size: '300' });
          if (recPageToken) {
            params.set('next_page_token', recPageToken);
          }
          const res = await fetch(`${cfg.apiBaseUrl}/users/${encodeURIComponent(user.id)}/recordings?${params.toString()}`, { headers });
          if (!res.ok) {
            ctx.onProgress?.({ kind: 'error', uri: user.email, message: `recordings ${user.email}: ${res.status}` });
            break;
          }
          const list = (await res.json()) as ZoomRecordingList;
          for (const mtg of list.meetings ?? []) {
            const transcriptFile = (mtg.recording_files ?? []).find(f => f.file_type === 'TRANSCRIPT');
            let transcript = '';
            if (transcriptFile?.download_url) {
              const tRes = await fetch(`${transcriptFile.download_url}?access_token=${encodeURIComponent(token)}`);
              if (tRes.ok) {
                transcript = vttToText(await tRes.text());
              } else {
                ctx.onProgress?.({ kind: 'error', uri: mtg.uuid, message: `transcript ${mtg.uuid}: ${tRes.status}` });
              }
            }
            ctx.onProgress?.({ kind: 'fetched', uri: mtg.uuid });
            yield recordingToDoc(mtg, transcript, user.email);
          }
          recPageToken = list.next_page_token || undefined;
        } while (recPageToken);
      }
    }
  },
};

export type ZoomRecordingHit = {
  uuid: string;
  topic: string;
  startTime: string;
  hostEmail: string;
  durationMinutes: number | null;
  hasTranscript: boolean;
};

/**
 * The cloud recordings in a date window, across the account's users — the
 * lookup `get_zoom_transcript` never had. On 2026-09-18 the agent, asked for a
 * call by name, declared "no Zoom recording exists" because the only tool it
 * had wanted a UUID; the person then pasted the recording link and it was
 * there all along. A missing scope (Zoom error 4711) is reported as such, so
 * the answer can point at the connector rather than at the calendar.
 * @param opts
 * @param opts.credentials - The Zoom source's stored credentials.
 * @param opts.from - `YYYY-MM-DD`, inclusive.
 * @param opts.to - `YYYY-MM-DD`, inclusive.
 * @param opts.apiBaseUrl
 * @param opts.authBaseUrl
 * @param opts.users - Restrict to these host emails; empty = every user.
 */
export async function listZoomRecordings(opts: {
  credentials: Record<string, unknown> | undefined;
  from: string;
  to: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
  users?: string[];
}): Promise<{ hits: ZoomRecordingHit[]; missingScopes: string[] }> {
  const api = opts.apiBaseUrl ?? 'https://api.zoom.us/v2';
  const token = await mintToken(opts.authBaseUrl ?? 'https://zoom.us', opts.credentials);
  const headers = { authorization: `Bearer ${token}` };
  const missing = (body: string): string[] => {
    const m = /scopes:\[([^\]]+)\]/.exec(body);
    return m ? m[1]!.split(',').map(x => x.trim()).filter(Boolean) : [];
  };
  const users: Array<{ id: string; email: string }> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ status: 'active', page_size: '300' });
    if (pageToken) {
      params.set('next_page_token', pageToken);
    }
    const res = await fetch(`${api}/users?${params.toString()}`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const scopes = missing(body);
      if (scopes.length > 0) {
        return { hits: [], missingScopes: scopes };
      }
      throw new Error(`Zoom user list failed: ${res.status} ${body}`);
    }
    const list = (await res.json()) as ZoomUserList;
    for (const u of list.users ?? []) {
      if (!opts.users || opts.users.length === 0 || opts.users.includes(u.email)) {
        users.push({ id: u.id, email: u.email });
      }
    }
    pageToken = list.next_page_token || undefined;
  } while (pageToken);

  const hits: ZoomRecordingHit[] = [];
  for (const user of users) {
    const params = new URLSearchParams({ from: opts.from, to: opts.to, page_size: '300' });
    const res = await fetch(`${api}/users/${encodeURIComponent(user.id)}/recordings?${params.toString()}`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const scopes = missing(body);
      if (scopes.length > 0) {
        return { hits, missingScopes: scopes };
      }
      continue;
    }
    const list = (await res.json()) as ZoomRecordingList;
    for (const mtg of list.meetings ?? []) {
      hits.push({
        uuid: mtg.uuid,
        topic: mtg.topic ?? '(untitled)',
        startTime: mtg.start_time ?? '',
        hostEmail: user.email,
        durationMinutes: typeof mtg.duration === 'number' ? mtg.duration : null,
        hasTranscript: (mtg.recording_files ?? []).some(f => f.file_type === 'TRANSCRIPT'),
      });
    }
  }
  hits.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { hits, missingScopes: [] };
}
