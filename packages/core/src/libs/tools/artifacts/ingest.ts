/**
 * Keep an image artifact's bytes in Vocion, not behind someone else's link.
 *
 * WHY (2026-09-28): the factory worker records QA screenshots as artifacts
 * whose URL is an S3 presigned GET in the product's own AWS account. SigV4
 * caps a presigned URL at seven days, so a week after every run each
 * release's thumbnails, each feature page's proof, each verdict's evidence
 * link and the recording pass's `fetch_image` all broke at once — evidence
 * that should last as long as the release lasted a week.
 *
 * So an image artifact that arrives with an external http(s) URL has its
 * bytes copied into the artifact store (`store.ts`, the same place generated
 * images and uploaded files live) as it is written, and from then on it is
 * served from Vocion's own authenticated route. The link it arrived with is
 * kept as `sourceUrl`, because where evidence came from is part of it.
 *
 * The fetch is the one `fetch_image` uses (`libs/tools/image/remote.ts`):
 * public addresses only, on every redirect hop, so an artifact URL cannot be
 * used to reach the metadata service or anything else on the box's network;
 * the body is capped while it is read; and the bytes must be an image by
 * magic number. Only rasters a browser draws are kept — an SVG can carry
 * script, and it would be served from the app's own origin.
 *
 * An ingest that fails keeps the external URL and says why. A failure that
 * might go the other way next time (a timeout, a 5xx) is retried by the sweep
 * (`services/artifacts/imageIngest.ts`) while the link is still valid; one
 * that will not (not an image, not public, too large, expired) is not.
 */

import type { FetchedImage, FetchedImageBytes } from '@/libs/tools/image/remote';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { CONTENT_TYPES, sniffImage } from '@/libs/tools/image/inspect';
import { fetchImage, fetchImageBytes, ImageFetchError, shrinkImage } from '@/libs/tools/image/remote';
import { artifactsDir, saveArtifact } from './store';
import { isExternalHttpUrl, isSafeArtifactFilename, isStoredArtifactUrl, parseArtifactFilename } from './url';

/** A full-page screenshot of a long page is a few MB; a video is not an image. */
export const DEFAULT_INGEST_MAX_BYTES = 20 * 1024 * 1024;

/** The rasters kept as they are, and the extension each is stored under. */
const KEPT: Record<string, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' };

/** How many times the sweep tries a retryable failure before leaving it. */
export const MAX_INGEST_ATTEMPTS = 5;

export function ingestMaxBytes(): number {
  const n = Number(process.env.VOCION_ARTIFACT_INGEST_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INGEST_MAX_BYTES;
}

/**
 * What happened when Vocion tried to keep a copy, stored on the artifact's
 * `ingest` column. `stored` is the end state; `failed` is retried by the
 * sweep; `refused` and `expired` are not.
 */
export type ArtifactIngest = {
  status: 'stored' | 'failed' | 'refused' | 'expired';
  /** One sentence, for a person, when it is not `stored`. */
  reason?: string;
  attempts: number;
  /** ISO time of the last attempt. */
  at: string;
  bytes?: number;
  contentType?: string;
  /** When the source link stops working, if it says (a presigned URL does). */
  sourceExpiresAt?: string | null;
};

export type IngestOutcome
  = | { ok: true; url: string; filename: string; contentType: string; bytes: number; sourceUrl: string }
    | { ok: false; status: 'failed' | 'refused' | 'expired'; reason: string; sourceUrl: string };

/**
 * When a presigned link stops working, read from the link itself: SigV4's
 * `X-Amz-Date` + `X-Amz-Expires`, or GCS's `X-Goog-Date` + `X-Goog-Expires`.
 * Null when the link does not say, which is most links.
 * @param url - The link.
 */
export function presignedExpiry(url: string): Date | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const q = u.searchParams;
  const date = q.get('X-Amz-Date') ?? q.get('X-Goog-Date');
  const expires = Number(q.get('X-Amz-Expires') ?? q.get('X-Goog-Expires'));
  const m = date ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date) : null;
  if (!m || !Number.isFinite(expires) || expires <= 0) {
    return null;
  }
  const signed = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return new Date(signed + expires * 1000);
}

export type IngestDeps = {
  fetchBytes?: (url: string, opts: { maxFetchBytes: number }) => Promise<FetchedImageBytes>;
  save?: typeof saveArtifact;
  now?: Date;
};

/**
 * Fetch an external image and keep it in the artifact store.
 *
 * Never throws: every refusal comes back as a sentence and a status, so the
 * caller can record it on the artifact and still write the artifact.
 * @param input - The workspace and the link.
 * @param input.orgId - Whose store the copy goes in (the file id is prefixed with it).
 * @param input.url - The external link.
 * @param deps - Seams for tests.
 */
export async function ingestExternalImage(input: { orgId: string; url: string }, deps: IngestDeps = {}): Promise<IngestOutcome> {
  const sourceUrl = input.url.trim();
  const now = deps.now ?? new Date();
  if (!isExternalHttpUrl(sourceUrl)) {
    return { ok: false, status: 'refused', reason: 'only an http or https link is copied.', sourceUrl };
  }
  const expiry = presignedExpiry(sourceUrl);
  if (expiry && expiry.getTime() <= now.getTime()) {
    return { ok: false, status: 'expired', reason: `the link expired on ${expiry.toISOString()}, before a copy was kept.`, sourceUrl };
  }
  let got: FetchedImageBytes;
  try {
    got = await (deps.fetchBytes ?? fetchImageBytes)(sourceUrl, { maxFetchBytes: ingestMaxBytes() });
  } catch (err) {
    return { ...classify(err, expiry, now), sourceUrl };
  }
  const ext = KEPT[got.kind];
  if (!ext) {
    return { ok: false, status: 'refused', reason: `it is ${got.kind.toUpperCase()}, which is not kept — only PNG, JPEG, GIF and WebP are served from the store.`, sourceUrl };
  }
  try {
    const saved = await (deps.save ?? saveArtifact)({ orgId: input.orgId, data: got.bytes, ext, contentType: got.contentType });
    return { ok: true, url: saved.url, filename: saved.filename, contentType: got.contentType, bytes: saved.bytes, sourceUrl };
  } catch (err) {
    return { ok: false, status: 'failed', reason: `the copy could not be written to the artifact store (${(err as Error).message ?? 'unknown error'}).`, sourceUrl };
  }
}

function classify(err: unknown, expiry: Date | null, now: Date): { ok: false; status: 'failed' | 'refused' | 'expired'; reason: string } {
  if (!(err instanceof ImageFetchError)) {
    return { ok: false, status: 'failed', reason: `the fetch failed (${(err as Error)?.message ?? 'unknown error'}).` };
  }
  const reason = err.message.replace(/^(\w)/, c => c.toLowerCase());
  if (err.code === 'blocked' || err.code === 'not_image' || err.code === 'too_large') {
    return { ok: false, status: 'refused', reason };
  }
  // A presigned GET that answers 403 near its end is expired, whatever the
  // clock says: S3 checks the signature against its own clock.
  if (err.code === 'http' && err.status === 403 && expiry && expiry.getTime() - now.getTime() < 60_000) {
    return { ok: false, status: 'expired', reason };
  }
  return { ok: false, status: 'failed', reason };
}

/**
 * The outcome as the `ingest` column records it.
 * @param outcome - What `ingestExternalImage` returned.
 * @param previous - The column as it was, for the attempt count.
 * @param now - The attempt's time.
 */
export function ingestRecord(outcome: IngestOutcome, previous: ArtifactIngest | null | undefined, now: Date = new Date()): ArtifactIngest {
  const attempts = (previous?.attempts ?? 0) + 1;
  const sourceExpiresAt = presignedExpiry(outcome.sourceUrl)?.toISOString() ?? null;
  if (outcome.ok) {
    return { status: 'stored', attempts, at: now.toISOString(), bytes: outcome.bytes, contentType: outcome.contentType, sourceExpiresAt };
  }
  return { status: outcome.status, reason: outcome.reason, attempts, at: now.toISOString(), sourceExpiresAt };
}

/**
 * Whether the sweep should try this one again: a retryable failure, under
 * the attempt cap, whose link has not expired.
 * @param ingest - The column.
 * @param now - The sweep's time.
 */
export function shouldRetryIngest(ingest: ArtifactIngest | null | undefined, now: Date = new Date()): boolean {
  if (!ingest || ingest.status !== 'failed' || ingest.attempts >= MAX_INGEST_ATTEMPTS) {
    return false;
  }
  return !ingest.sourceExpiresAt || new Date(ingest.sourceExpiresAt).getTime() > now.getTime();
}

/**
 * A link that names a video: the worker's recordings are evidence too, but they are not images.
 * @param url
 */
function namesVideo(url: string): boolean {
  try {
    const u = new URL(url);
    return /\.(?:webm|mp4|mov|m4v)$/i.test(u.pathname) || /^video\//i.test(u.searchParams.get('response-content-type') ?? '');
  } catch {
    return false;
  }
}

/** What an artifact write carries once the copy has been tried. */
export type KeptImage = {
  url: string;
  spec: Record<string, unknown>;
  sourceUrl: string;
  ingest: ArtifactIngest;
};

/**
 * The one decision every artifact write makes about its image: when `url` is
 * an external http(s) link, copy the bytes into the store, point `url` at the
 * copy, and point every top-level spec field that carried the same link
 * (`href` on a link artifact, `url` on a file) at the copy too — so the card,
 * the page, the thumbnail and the reports all read the one Vocion serves.
 * On failure nothing moves but the record of why.
 *
 * Null when there is nothing to keep: no URL, one already in the store, a
 * `data:` URL, or a link that names a video.
 * @param input - The write.
 * @param input.orgId - The workspace.
 * @param input.url - The artifact's `url`.
 * @param input.spec - The validated spec.
 * @param input.previous - The `ingest` column as it was, when this is a retry.
 * @param deps - Seams for tests.
 */
export async function keepImageInVocion(
  input: { orgId: string; url: string | null | undefined; spec: Record<string, unknown>; previous?: ArtifactIngest | null },
  deps: IngestDeps = {},
): Promise<KeptImage | null> {
  if (!isExternalHttpUrl(input.url) || namesVideo(input.url)) {
    return null;
  }
  const now = deps.now ?? new Date();
  const outcome = await ingestExternalImage({ orgId: input.orgId, url: input.url }, { ...deps, now });
  const ingest = ingestRecord(outcome, input.previous, now);
  if (!outcome.ok) {
    return { url: outcome.sourceUrl, spec: input.spec, sourceUrl: outcome.sourceUrl, ingest };
  }
  const spec: Record<string, unknown> = { ...input.spec };
  for (const key of Object.keys(spec)) {
    if (typeof spec[key] === 'string' && (spec[key] as string).trim() === outcome.sourceUrl) {
      spec[key] = outcome.url;
    }
  }
  return { url: outcome.url, spec, sourceUrl: outcome.sourceUrl, ingest };
}

/**
 * Open an image for a server-side reader — `fetch_image` and the recording
 * pass — whether it is Vocion's stored copy or a link out. A stored copy is
 * read from the store and shrunk exactly as a fetched image is; anything else
 * is fetched under the usual guard.
 * @param orgId - The workspace the reader runs in.
 * @param url - A stored `/api/artifacts/…` URL, or an external link.
 * @param opts - What `fetchImage` takes.
 * @param opts.maxEdge - Longest edge after the downscale.
 */
export async function openImage(orgId: string, url: string, opts: { maxEdge?: number } = {}): Promise<FetchedImage> {
  // AN IMAGE HELD INLINE ON THE ARTIFACT (Walk 18): a worker with no evidence
  // bucket files its screenshots as `data:` images; they are read from the row,
  // never fetched (a fetch of the artifact's page needs a session and is 401).
  const inline = /^data:image\/[\w.+-]+;base64,([\s\S]*)$/.exec(url);
  if (inline) {
    const bytes = Buffer.from(inline[1]!, 'base64');
    const kind = sniffImage(bytes);
    if (!kind) {
      throw new ImageFetchError('the image held on that artifact is not an image.', 'not_image');
    }
    return shrinkImage({ kind, bytes, contentType: CONTENT_TYPES[kind], url: url.slice(0, 64) }, opts);
  }
  if (!isStoredArtifactUrl(url)) {
    return fetchImage(url, opts);
  }
  const bytes = await readStoredArtifact(orgId, url);
  if (!bytes) {
    throw new ImageFetchError('the stored copy of that image is not in the artifact store.', 'http');
  }
  const kind = sniffImage(bytes);
  if (!kind) {
    throw new ImageFetchError('the stored copy of that artifact is not an image.', 'not_image');
  }
  return shrinkImage({ kind, bytes, contentType: CONTENT_TYPES[kind], url }, opts);
}

/**
 * The bytes behind a URL the built-in route serves, read straight from the
 * store — for a server-side reader (`fetch_image`) that holds no session to
 * call its own route with. The caller has already scoped the artifact to its
 * workspace; the file id must carry that workspace's prefix too.
 * @param orgId - The workspace.
 * @param url - `/api/artifacts/<orgId>-<hash>/<orgId>-<hash>.<ext>`.
 * @param dir - The store, for tests.
 */
export async function readStoredArtifact(orgId: string, url: string, dir: string = artifactsDir()): Promise<Buffer | null> {
  if (!isStoredArtifactUrl(url)) {
    return null;
  }
  const filename = url.split('?')[0]!.split('/').pop() ?? '';
  const parsed = parseArtifactFilename(filename);
  if (!parsed || !isSafeArtifactFilename(filename) || !parsed.id.startsWith(`${orgId}-`)) {
    return null;
  }
  const abs = path.resolve(dir, filename);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) {
    return null;
  }
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}
