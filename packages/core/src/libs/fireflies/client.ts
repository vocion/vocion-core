/**
 * Shared Fireflies API client — the one place that knows how to talk to
 * Fireflies.ai. The `fireflies` connector's sync and Test connection and the
 * meetings family's Fireflies provider all go through it.
 *
 * Fireflies is GraphQL only: one endpoint, a Bearer API key (Settings →
 * Developer settings → API key). A GraphQL refusal arrives as HTTP 200 with
 * an `errors` list, so this client turns those into the same failures an
 * HTTP refusal would be.
 *
 * Read-only, and frugal: the free and Pro plans allow 50 API requests a DAY,
 * so a page of transcripts asks for their sentences and summaries in the same
 * request rather than one request per meeting, and pages are paced.
 */

import type { VendorFailure, VendorResult } from '@/libs/connectors/vendorFetch';
import type { MeetingTranscript } from '@/services/meetings/provider';
import { credentialString, pace, vendorRequest } from '@/libs/connectors/vendorFetch';
import { foldTurns } from '@/services/meetings/provider';

export const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql';
/** The most transcripts Fireflies returns in one page. */
export const FIREFLIES_PAGE = 50;
/** Business plans allow 60 requests a minute; stay under it. */
export const FIREFLIES_PACE_MS = 1100;

const AUTH_HINT = 'Check the API key under Fireflies Settings → Developer settings, and paste it again on the Connectors page.';

/**
 * The vaulted API key, or the reason it cannot be used. `token` is the
 * storage contract with the `fireflies` platform descriptor.
 * @param values - The decrypted credential bag.
 */
export function firefliesCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; token: string } | { ok: false; message: string } {
  const token = credentialString(values, 'token');
  if (!token) {
    return { ok: false, message: 'No Fireflies API key is stored for this workspace. Copy it from Fireflies Settings → Developer settings and paste it on the Connectors page.' };
  }
  return { ok: true, token };
}

type GraphqlError = { message?: string; code?: string; extensions?: { code?: string } };

/**
 * One GraphQL request, its `errors` shaped like an HTTP refusal.
 * @param token - The API key.
 * @param query - The query.
 * @param variables - Its variables.
 */
export async function firefliesQuery<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<VendorResult<T>> {
  const res = await vendorRequest<{ data?: T; errors?: GraphqlError[] }>({
    vendor: 'Fireflies',
    url: FIREFLIES_GRAPHQL_URL,
    method: 'POST',
    json: { query, variables },
    headers: { authorization: `Bearer ${token}` },
    authHint: AUTH_HINT,
  });
  if (!res.ok) {
    return res;
  }
  const first = res.data?.errors?.[0];
  if (first) {
    const code = String(first.extensions?.code ?? first.code ?? '').toLowerCase();
    const said = (first.message ?? 'an error').replace(/\s+/g, ' ').slice(0, 240);
    let failure: VendorFailure;
    if (code.includes('auth') || code.includes('forbidden') || code.includes('unauthenticated')) {
      failure = { ok: false, error: 'unauthorized', status: 401, message: `Fireflies refused the API key (${said}). ${AUTH_HINT}` };
    } else if (code.includes('too_many') || code.includes('rate')) {
      failure = { ok: false, error: 'rate_limited', status: 429, message: `Fireflies is rate limiting this workspace's key (${said}). The free and Pro plans allow 50 requests a day; try again later.` };
    } else if (code.includes('not_found') || code.includes('object_not_found')) {
      failure = { ok: false, error: 'not_found', status: 404, message: `Fireflies has no such transcript (${said}).` };
    } else {
      failure = { ok: false, error: 'vendor_error', status: res.status, message: `Fireflies answered with an error: ${said}.` };
    }
    return failure;
  }
  return { ok: true, status: res.status, data: res.data?.data as T };
}

export type FirefliesUser = { user_id?: string; email?: string; name?: string };

/**
 * Test connection's read: who the key belongs to. Spends one request.
 * @param token - The API key.
 */
export async function readFirefliesUser(token: string): Promise<VendorResult<FirefliesUser>> {
  const res = await firefliesQuery<{ user?: FirefliesUser }>(token, 'query { user { user_id email name } }');
  return res.ok ? { ok: true, status: res.status, data: res.data?.user ?? {} } : res;
}

export type FirefliesTranscript = {
  id: string;
  title?: string | null;
  /** Milliseconds since the epoch. */
  date?: number | null;
  dateString?: string | null;
  /** Minutes. */
  duration?: number | null;
  organizer_email?: string | null;
  participants?: string[] | null;
  transcript_url?: string | null;
  meeting_link?: string | null;
  sentences?: Array<{ speaker_name?: string | null; text?: string | null; start_time?: number | null }> | null;
  summary?: { overview?: string | null; short_summary?: string | null; action_items?: string | null; keywords?: string[] | null } | null;
};

const TRANSCRIPT_FIELDS = 'id title date dateString duration organizer_email participants transcript_url meeting_link sentences { speaker_name text start_time } summary { overview short_summary action_items keywords }';

/**
 * Transcripts of meetings held inside the window, newest first, sentences
 * and summary included, following `skip` to the end (or `max`).
 * @param token - The API key.
 * @param window - The window.
 * @param window.from - Start.
 * @param window.to - End.
 * @param max - Stop after this many.
 */
export async function listFirefliesTranscripts(token: string, window: { from: Date; to: Date }, max = Number.POSITIVE_INFINITY): Promise<VendorResult<FirefliesTranscript[]>> {
  const query = `query Transcripts($limit: Int, $skip: Int, $fromDate: DateTime, $toDate: DateTime) { transcripts(limit: $limit, skip: $skip, fromDate: $fromDate, toDate: $toDate) { ${TRANSCRIPT_FIELDS} } }`;
  const out: FirefliesTranscript[] = [];
  for (let skip = 0; out.length < max; skip += FIREFLIES_PAGE) {
    if (skip > 0) {
      await pace(FIREFLIES_PACE_MS);
    }
    const res = await firefliesQuery<{ transcripts?: FirefliesTranscript[] }>(token, query, {
      limit: FIREFLIES_PAGE,
      skip,
      fromDate: window.from.toISOString(),
      toDate: window.to.toISOString(),
    });
    if (!res.ok) {
      return res;
    }
    const page = res.data?.transcripts ?? [];
    out.push(...page);
    if (page.length < FIREFLIES_PAGE) {
      break;
    }
  }
  return { ok: true, status: 200, data: out.slice(0, max) };
}

/**
 * One transcript by id, or null when Fireflies has none by that id.
 * @param token - The API key.
 * @param id - The transcript id.
 */
export async function readFirefliesTranscript(token: string, id: string): Promise<VendorResult<FirefliesTranscript | null>> {
  const res = await firefliesQuery<{ transcript?: FirefliesTranscript | null }>(token, `query Transcript($id: String!) { transcript(id: $id) { ${TRANSCRIPT_FIELDS} } }`, { id });
  if (!res.ok && res.error === 'not_found') {
    return { ok: true, status: 200, data: null };
  }
  return res.ok ? { ok: true, status: res.status, data: res.data?.transcript ?? null } : res;
}

/**
 * When a transcript's meeting started, ISO.
 * @param t - The transcript.
 */
function startedOf(t: FirefliesTranscript): string | null {
  if (typeof t.date === 'number' && Number.isFinite(t.date)) {
    return new Date(t.date).toISOString();
  }
  return t.dateString ?? null;
}

/**
 * One transcript as the meetings family reads it. The sync and the live read
 * both render through this.
 * @param t - The transcript.
 */
export function firefliesMeeting(t: FirefliesTranscript): MeetingTranscript & { emails: string[] } {
  const text = foldTurns((t.sentences ?? []).map(s => ({ speaker: s.speaker_name?.trim() || 'Speaker', text: s.text ?? '' })));
  const s = t.summary;
  const summary = [
    s?.overview?.trim() || s?.short_summary?.trim(),
    s?.action_items?.trim() ? `Action items:\n${s.action_items.trim()}` : '',
    s?.keywords?.length ? `Keywords: ${s.keywords.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');
  const emails = [...new Set([t.organizer_email ?? '', ...(t.participants ?? [])].map(e => e.trim()).filter(e => e.includes('@')))];
  return {
    id: t.id,
    title: t.title?.trim() || '(untitled meeting)',
    started: startedOf(t),
    durationMinutes: typeof t.duration === 'number' ? t.duration : null,
    participants: emails,
    emails,
    url: t.transcript_url ?? null,
    hasTranscript: text !== '',
    summary: summary || null,
    transcript: text,
  };
}
