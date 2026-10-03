/**
 * Shared Slate API client — the one place that knows how to talk to Slate
 * (MetaCTO's screen-recording product). The `slate` connector's Test
 * connection and the video host (`libs/slate/videoHost.ts`) both go through
 * it, so the bearer header, the upload protocol and the error shaping exist
 * exactly once. Nothing outside `libs/slate/` and the connector names Slate:
 * callers ask for a video host (`services/videoHost`).
 *
 * The protocol, as Slate's own API serves it (read from its source, 2026-10-03):
 *
 *   GET   /v1/me                         who the token is (and `paidSeat`)
 *   POST  /v1/videos                     open an upload: { contentType, title, partCount,
 *                                        source, visibility } → { videoId, shareId, uploadId,
 *                                        parts: [{ partNumber, url }] } (presigned S3 PUTs)
 *   PUT   <part url>                     the bytes; S3 answers an ETag per part
 *   POST  /v1/videos/:id/complete        { parts: [{ partNumber, etag }], title } → it
 *                                        processes like a web upload (transcript, AI title)
 *   PATCH /v1/videos/:id                 { title, summary, visibility }
 *
 * The player is `<web origin>/embed/:shareId` and the watch page
 * `<web origin>/v/:shareId`. Who may watch is the recording's `visibility`:
 * `team` (the uploader's Slate organization) unless a workspace configures
 * otherwise; never `public` unless configured.
 *
 * Auth today is a pasted session token (`slt_…`, ~90 days, from Slate's device
 * flow). TODO(oauth): Slate is also an OAuth 2.1 authorization server with
 * PKCE and dynamic client registration — discovery at
 * {@link SLATE_OAUTH_DISCOVERY} names `/oauth/register`, `/oauth/authorize` and
 * `/oauth/token`; the access token is the same `slt_` bearer and the refresh
 * token (`slr_…`) rotates on each use. Vocion has no outbound OAuth-client
 * flow for a connector yet (OAuthService is Vocion AS the server), so the
 * credential bag already carries `refreshToken` / `expiresAt` slots and
 * {@link slateCredentialsFrom} reads them; a refresh step belongs in
 * {@link slateFetchJson} once a connect flow writes them.
 *
 * Errors are DATA, never throws: every failure is a sentence a person acts on,
 * with whether trying again could help.
 */

import type { Buffer } from 'node:buffer';

export const SLATE_API_BASE = 'https://api.slatevideo.com';
export const SLATE_WEB_ORIGIN = 'https://slatevideo.com';
export const SLATE_OAUTH_DISCOVERY = `${SLATE_API_BASE}/.well-known/oauth-authorization-server`;

/** The visibilities a workspace may choose for what it uploads. `invited` needs a list of people, so it is not offered. */
export const SLATE_VISIBILITIES = ['team', 'signedIn', 'private', 'public'] as const;
export type SlateVisibility = typeof SLATE_VISIBILITIES[number];
export const SLATE_DEFAULT_VISIBILITY: SlateVisibility = 'team';

/** The content types Slate takes as a screen recording. */
const SLATE_VIDEO_TYPES = new Set(['video/webm', 'video/mp4', 'video/quicktime']);

/** One part per this many bytes. S3 needs at least 5 MB for every part but the last. */
export const SLATE_PART_BYTES = 8 * 1024 * 1024;
/** Slate signs at most 100 parts per request. */
const MAX_PARTS = 100;
const TIMEOUT_MS = 30_000;
const PART_TIMEOUT_MS = 5 * 60_000;

export type SlateCredentials = {
  token: string;
  apiBase: string;
  webOrigin: string;
  /** OAuth refresh token (`slr_…`), once a connect flow writes one. Unused until then. */
  refreshToken?: string;
  /** When the access token lapses (ISO), once OAuth writes it. */
  expiresAt?: string;
};

export type SlateFailure = { ok: false; status: number | null; message: string; retryable: boolean };
export type SlateResult<T> = { ok: true; data: T } | SlateFailure;

/** What a fetch looks like to this client, so a test can stand in for the network. */
export type SlateFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}>;

function origin(raw: unknown, fallback: string): string | null {
  const s = typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\/+$/, '') : fallback;
  return /^https?:\/\/[^\s/]+$/i.test(s) ? s : null;
}

/**
 * The vaulted credential (and the connector's optional hosts), or the reason
 * it cannot be used. `token` is the storage contract with the `slate`
 * platform descriptor in `libs/platforms/registry.ts`.
 * @param values - The decrypted credential bag.
 * @param config - The connector row's config (`apiBase`, `webOrigin`), when one.
 */
export function slateCredentialsFrom(values?: Record<string, unknown> | null, config?: Record<string, unknown> | null): { ok: true; credentials: SlateCredentials } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : '';
  if (!token) {
    return { ok: false, message: 'No Slate token is stored for this workspace. Connect Slate on the Connections page with a session token (slt_…).' };
  }
  const apiBase = origin(config?.apiBase, SLATE_API_BASE);
  const webOrigin = origin(config?.webOrigin, SLATE_WEB_ORIGIN);
  if (!apiBase || !webOrigin) {
    return { ok: false, message: `The Slate addresses must be origins such as ${SLATE_API_BASE} and ${SLATE_WEB_ORIGIN}.` };
  }
  return {
    ok: true,
    credentials: {
      token,
      apiBase,
      webOrigin,
      ...(typeof values?.refreshToken === 'string' ? { refreshToken: values.refreshToken } : {}),
      ...(typeof values?.expiresAt === 'string' ? { expiresAt: values.expiresAt } : {}),
    },
  };
}

/**
 * The visibility a config asks for, `team` when it asks for nothing usable.
 * @param raw - The configured value.
 */
export function slateVisibilityFrom(raw: unknown): SlateVisibility {
  return (SLATE_VISIBILITIES as readonly unknown[]).includes(raw) ? raw as SlateVisibility : SLATE_DEFAULT_VISIBILITY;
}

export function slateWatchUrl(webOrigin: string, shareId: string): string {
  return `${webOrigin}/v/${encodeURIComponent(shareId)}`;
}

export function slateEmbedUrl(webOrigin: string, shareId: string): string {
  return `${webOrigin}/embed/${encodeURIComponent(shareId)}`;
}

const defaultFetch: SlateFetch = (url, init) => fetch(url, init as RequestInit);

async function failureFrom(res: { status: number; text: () => Promise<string> }, what: string): Promise<SlateFailure> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body) as { message?: unknown; error?: unknown };
      detail = typeof j.message === 'string' ? j.message : typeof j.error === 'string' ? j.error : '';
    } catch {
      detail = body;
    }
  } catch { /* no body */ }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
  const said = detail ? ` Slate said: "${detail}"` : '';
  if (res.status === 401) {
    return { ok: false, status: 401, retryable: false, message: `Slate refused the token while trying to ${what}; it may have expired (session tokens last about 90 days). Paste a new one on the Connections page.${said}` };
  }
  if (res.status === 402 || res.status === 403) {
    return { ok: false, status: res.status, retryable: false, message: `Slate would not let this account ${what}.${said}` };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, retryable: false, message: `Slate found nothing to ${what}.${said}` };
  }
  return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500, message: `Slate answered ${res.status} while trying to ${what}.${said}` };
}

/**
 * One JSON call against the Slate API, its failure shaped.
 * @param c - Where and as whom.
 * @param method - The HTTP method.
 * @param path - `/v1/…`.
 * @param what - What the call does, for the failure sentence ("read the account").
 * @param body - A JSON body, when one.
 * @param doFetch - The network.
 */
export async function slateFetchJson<T>(c: SlateCredentials, method: string, path: string, what: string, body?: unknown, doFetch: SlateFetch = defaultFetch): Promise<SlateResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${c.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return failureFrom(res, what);
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return { ok: false, status: null, retryable: true, message: aborted ? `Slate did not answer within ${TIMEOUT_MS / 1000}s while trying to ${what}.` : `Slate could not be reached to ${what} (${(err as Error)?.message?.slice(0, 160) ?? 'network error'}).` };
  } finally {
    clearTimeout(timer);
  }
}

export type SlateMe = { id?: string; email?: string; name?: string | null; paidSeat?: boolean; orgId?: string | null };

/**
 * Who the token is.
 * @param c - The credential.
 * @param doFetch - The network.
 */
export function readSlateMe(c: SlateCredentials, doFetch?: SlateFetch): Promise<SlateResult<SlateMe>> {
  return slateFetchJson<SlateMe>(c, 'GET', '/v1/me', 'read the account', undefined, doFetch);
}

export type SlateUpload = {
  videoId: string;
  shareId: string;
  watchUrl: string;
  embedUrl: string;
  visibility: SlateVisibility;
};

/**
 * Upload one recording: open the upload, PUT each part to its presigned URL,
 * finish from the ETags S3 returned, then set the title, the summary and who
 * may watch. Never throws.
 *
 * `source: 'upload'` is Slate's honest door for a file that already exists
 * (its MCP `upload_video` uses the same); it needs a paid seat, and a refusal
 * says so rather than being retried through the free door.
 * @param c - The credential.
 * @param input - The recording.
 * @param input.data - The bytes.
 * @param input.contentType - `video/webm` or `video/mp4`.
 * @param input.title - Its title on Slate.
 * @param input.summary - The line under it on Slate.
 * @param input.visibility - Who may watch.
 * @param doFetch - The network.
 */
export async function uploadSlateVideo(c: SlateCredentials, input: { data: Buffer | Uint8Array; contentType: string; title: string; summary: string | null; visibility: SlateVisibility }, doFetch: SlateFetch = defaultFetch): Promise<SlateResult<SlateUpload>> {
  const contentType = input.contentType.split(';')[0]!.trim().toLowerCase();
  if (!SLATE_VIDEO_TYPES.has(contentType)) {
    return { ok: false, status: null, retryable: false, message: `Slate takes WebM, MP4 or QuickTime video; this is ${contentType || 'untyped'}.` };
  }
  if (input.data.byteLength === 0) {
    return { ok: false, status: null, retryable: false, message: 'The recording is empty.' };
  }
  const partCount = Math.ceil(input.data.byteLength / SLATE_PART_BYTES);
  if (partCount > MAX_PARTS) {
    return { ok: false, status: null, retryable: false, message: `The recording is ${(input.data.byteLength / 1024 / 1024).toFixed(0)} MB, more than one upload of ${MAX_PARTS} parts carries.` };
  }
  const title = input.title.trim().slice(0, 200) || 'Recording';
  const opened = await slateFetchJson<{ videoId: string; shareId: string; parts: Array<{ partNumber: number; url: string }> }>(
    c,
    'POST',
    '/v1/videos',
    'start an upload',
    { contentType, title, partCount, source: 'upload', visibility: input.visibility },
    doFetch,
  );
  if (!opened.ok) {
    return opened;
  }
  const { videoId, shareId } = opened.data;
  const urls = new Map((opened.data.parts ?? []).map(p => [p.partNumber, p.url]));
  const etags: Array<{ partNumber: number; etag: string }> = [];
  for (let n = 1; n <= partCount; n++) {
    const url = urls.get(n);
    if (!url) {
      return { ok: false, status: null, retryable: true, message: `Slate signed no URL for part ${n} of ${partCount}.` };
    }
    const slice = input.data.subarray((n - 1) * SLATE_PART_BYTES, Math.min(n * SLATE_PART_BYTES, input.data.byteLength));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PART_TIMEOUT_MS);
    try {
      // The part URL is presigned: no bearer goes to the storage host.
      const res = await doFetch(url, { method: 'PUT', headers: {}, body: new Uint8Array(slice), signal: controller.signal });
      if (!res.ok) {
        return { ok: false, status: res.status, retryable: res.status >= 500 || res.status === 403, message: `Slate's storage refused part ${n} of ${partCount} (${res.status}).` };
      }
      const etag = res.headers.get('etag') ?? res.headers.get('ETag');
      if (!etag) {
        return { ok: false, status: res.status, retryable: true, message: `Slate's storage stored part ${n} but returned no ETag to finish the upload with.` };
      }
      etags.push({ partNumber: n, etag });
    } catch (err) {
      return { ok: false, status: null, retryable: true, message: `Part ${n} of ${partCount} did not reach Slate's storage (${(err as Error)?.message?.slice(0, 160) ?? 'network error'}).` };
    } finally {
      clearTimeout(timer);
    }
  }
  const finished = await slateFetchJson<{ id: string; shareId: string; status: string }>(c, 'POST', `/v1/videos/${encodeURIComponent(videoId)}/complete`, 'finish the upload', { parts: etags, title }, doFetch);
  if (!finished.ok) {
    return finished;
  }
  // The title typed here is kept over the transcript's; the summary is the
  // caption Vocion filed it with. A refusal here leaves an uploaded recording
  // with Slate's own title, which is still worth its link.
  const patched = await slateFetchJson<{ visibility?: string }>(c, 'PATCH', `/v1/videos/${encodeURIComponent(videoId)}`, 'set the title and who may watch', {
    title,
    ...(input.summary ? { summary: input.summary.slice(0, 4000) } : {}),
    visibility: input.visibility,
  }, doFetch);
  const visibility = patched.ok ? slateVisibilityFrom(patched.data.visibility ?? input.visibility) : input.visibility;
  return {
    ok: true,
    data: { videoId, shareId, watchUrl: slateWatchUrl(c.webOrigin, shareId), embedUrl: slateEmbedUrl(c.webOrigin, shareId), visibility },
  };
}
