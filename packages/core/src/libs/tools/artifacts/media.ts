/**
 * THE MEDIA STORE: where a recording is kept, and where it is served from.
 *
 * Why (Chris, 2026-10-03): "Keep a recording of the QA Playwright run and the
 * production browser-use run and save them to the Feature Request object.
 * Local dev on disk and in prod to S3." Screenshots already live in the
 * artifact store (`store.ts`); a recording is the same kind of evidence, two
 * orders of magnitude bigger, and a browser plays it only when the server
 * answers byte ranges. So this is one function that keeps a video and one that
 * finds it again:
 *
 *   - `VOCION_MEDIA_BUCKET` set (and `VOCION_MEDIA_REGION`, else the AWS
 *     region): the bytes go to S3 under `<org>/<record>/<name>-<hash>.<ext>`
 *     with the instance's own credentials. The worker never holds a bucket; it
 *     sends the bytes to Vocion, and Vocion keeps them.
 *   - unset: the bytes go to the artifact store's directory on disk
 *     (`<VOCION_ARTIFACTS_DIR>/media/<org>/<record>/…`) — local dev, and the box
 *     until a bucket exists.
 *
 * Either way the served URL is the same authenticated route,
 * `/api/media/<record>/<file>` (`app/api/media/[recordId]/[filename]`): the
 * caller's org is the first path segment of the key, so a member can only ever
 * reach their own org's recordings, and the artifact that claims the URL
 * decides its audience. A file on disk streams with byte ranges; one in S3 is a
 * redirect to a presigned GET that lasts minutes, never days. The copy kept
 * here is the one the feature page and the public share page play.
 */

import type { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { artifactsDir } from './store';

/** Where the media route is mounted. */
export const MEDIA_ROUTE_BASE = '/api/media';

/** A few minutes of a 1440×900 browser is a few MB; this is the ceiling, said when hit. */
export const DEFAULT_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

/** The video types kept, and the extension each is stored under. */
const KEPT_VIDEO: Record<string, string> = { 'video/webm': 'webm', 'video/mp4': 'mp4' };
const EXT_TYPE: Record<string, string> = { webm: 'video/webm', mp4: 'video/mp4' };

const SAFE_SEGMENT = /^[\w-]{1,120}$/;
const SAFE_FILE = /^[\w-]{1,160}\.(?:webm|mp4)$/;

export function mediaMaxBytes(): number {
  const n = Number(process.env.VOCION_MEDIA_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MEDIA_MAX_BYTES;
}

/** The bucket recordings go to, or null when they stay on disk. */
export function mediaBucket(): { bucket: string; region: string | undefined } | null {
  const bucket = process.env.VOCION_MEDIA_BUCKET?.trim();
  if (!bucket) {
    return null;
  }
  return { bucket, region: process.env.VOCION_MEDIA_REGION?.trim() || undefined };
}

/**
 * `video/webm; codecs=vp8` → `webm`; anything that is not a kept video → null.
 * @param contentType - The declared type.
 */
export function videoExt(contentType: string | null | undefined): string | null {
  const base = String(contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return KEPT_VIDEO[base] ?? null;
}

/**
 * The type a stored file is served as, from its extension.
 * @param filename - `<name>-<hash>.webm`.
 */
export function mediaContentType(filename: string): string {
  return EXT_TYPE[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/**
 * An org id as a key segment: the id itself when it is plain, else its hash.
 * @param orgId - The workspace.
 */
function orgSegment(orgId: string): string {
  return SAFE_SEGMENT.test(orgId) ? orgId : `o${createHash('sha256').update(orgId).digest('hex').slice(0, 24)}`;
}

function nameSegment(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recording';
}

/**
 * Whether a record segment and a file name are ones this store could have written.
 * @param recordId - The record segment.
 * @param filename - The file segment.
 */
export function isSafeMediaPath(recordId: string, filename: string): boolean {
  return SAFE_SEGMENT.test(recordId) && SAFE_FILE.test(filename) && !filename.includes('..');
}

/**
 * The served URL of a stored recording.
 * @param recordId - The record it was kept under.
 * @param filename - The stored file.
 */
export function mediaUrl(recordId: string | number, filename: string): string {
  return `${MEDIA_ROUTE_BASE}/${encodeURIComponent(String(recordId))}/${encodeURIComponent(filename)}`;
}

/**
 * The object key in the bucket.
 * @param orgId - The workspace.
 * @param recordId - The record.
 * @param filename - The file.
 */
export function mediaKey(orgId: string, recordId: string | number, filename: string): string {
  return `${orgSegment(orgId)}/${String(recordId)}/${filename}`;
}

/** The directory on disk, under the artifact store. */
export function mediaDir(): string {
  return path.join(artifactsDir(), 'media');
}

export type KeptMedia = {
  ok: true;
  /** `/api/media/<record>/<file>` — what an artifact's `url` and `spec.url` carry. */
  url: string;
  filename: string;
  contentType: string;
  bytes: number;
  store: 's3' | 'disk';
  /** The S3 key or the path under the media directory. */
  key: string;
};
export type MediaRefusal = { ok: false; reason: string; tooLarge?: boolean };

export type MediaDeps = {
  put?: (opts: { bucket: string; key: string; body: Uint8Array; contentType: string; region?: string }) => Promise<void>;
  dir?: string;
  bucket?: { bucket: string; region: string | undefined } | null;
  maxBytes?: number;
};

/**
 * Keep a video and say where it is served from. Never throws: a refusal (not a
 * video, too large, the write failed) is a sentence for a person.
 * @param input - What to keep.
 * @param input.orgId - The workspace (the key's first segment).
 * @param input.recordId - The record it belongs to (the key's second).
 * @param input.name - A few words for the file name (`live-check-desktop`).
 * @param input.data - The bytes.
 * @param input.contentType - `video/webm` or `video/mp4`.
 * @param deps - Seams for tests.
 */
export async function keepMedia(input: { orgId: string; recordId: string | number; name: string; data: Buffer; contentType: string }, deps: MediaDeps = {}): Promise<KeptMedia | MediaRefusal> {
  const ext = videoExt(input.contentType);
  if (!ext) {
    return { ok: false, reason: `${input.contentType || 'an untyped file'} is not kept: recordings are WebM or MP4 video.` };
  }
  const recordId = String(input.recordId);
  if (!SAFE_SEGMENT.test(recordId)) {
    return { ok: false, reason: `"${recordId.slice(0, 40)}" is not a record id.` };
  }
  const max = deps.maxBytes ?? mediaMaxBytes();
  if (input.data.byteLength === 0) {
    return { ok: false, reason: 'the recording is empty.' };
  }
  if (input.data.byteLength > max) {
    return { ok: false, tooLarge: true, reason: `the recording is ${(input.data.byteLength / 1024 / 1024).toFixed(1)} MB, over the ${Math.round(max / 1024 / 1024)} MB a recording may be.` };
  }
  const hash = createHash('sha256').update(input.data).digest('hex').slice(0, 16);
  const filename = `${nameSegment(input.name)}-${hash}.${ext}`;
  const contentType = EXT_TYPE[ext]!;
  const key = mediaKey(input.orgId, recordId, filename);
  const bucket = deps.bucket === undefined ? mediaBucket() : deps.bucket;
  try {
    if (bucket) {
      const put = deps.put ?? (await import('@/libs/aws/s3')).putObject;
      await put({ bucket: bucket.bucket, key, body: input.data, contentType, region: bucket.region });
    } else {
      const abs = path.join(deps.dir ?? mediaDir(), key);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, input.data);
    }
  } catch (err) {
    return { ok: false, reason: `the recording could not be written to ${bucket ? 'the media bucket' : 'the media store'} (${(err as Error)?.message?.slice(0, 200) ?? 'unknown error'}).` };
  }
  return { ok: true, url: mediaUrl(recordId, filename), filename, contentType, bytes: input.data.byteLength, store: bucket ? 's3' : 'disk', key };
}

export type LocatedMedia
  = | { store: 'disk'; abs: string; size: number; contentType: string }
    | { store: 's3'; bucket: string; region: string | undefined; key: string; contentType: string };

/**
 * Where a recording the caller's org owns lives: on disk when the file is
 * there (written before a bucket was set, or with none), else in the bucket
 * when one is set. Null for a path this store could not have written, or for
 * a file that is in neither.
 * @param orgId - The CALLER's org: the key is built from it, so another org's file is unreachable.
 * @param recordId - The record segment.
 * @param filename - The file segment.
 * @param deps - Seams for tests.
 */
export async function locateMedia(orgId: string, recordId: string, filename: string, deps: Pick<MediaDeps, 'dir' | 'bucket'> = {}): Promise<LocatedMedia | null> {
  if (!isSafeMediaPath(recordId, filename)) {
    return null;
  }
  const key = mediaKey(orgId, recordId, filename);
  // turbopackIgnore: the media folder is only known at runtime; traced, it
  // pulls the whole project into the build's trace (next.config.ts, #832).
  const dir = path.resolve(/* turbopackIgnore: true */ deps.dir ?? mediaDir());
  const abs = path.resolve(dir, key);
  const contentType = mediaContentType(filename);
  if (abs.startsWith(dir + path.sep)) {
    try {
      const s = await stat(abs);
      if (s.isFile()) {
        return { store: 'disk', abs, size: s.size, contentType };
      }
    } catch { /* not on disk */ }
  }
  const bucket = deps.bucket === undefined ? mediaBucket() : deps.bucket;
  return bucket ? { store: 's3', bucket: bucket.bucket, region: bucket.region, key, contentType } : null;
}

/**
 * A `Range: bytes=a-b` header, against a file of `size` bytes: the slice to
 * send, `'unsatisfiable'`, or null to send the whole file.
 * @param header - The header, or null.
 * @param size - The file's size.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return null;
  }
  let start: number;
  let end: number;
  if (m[1] === '') {
    // The last N bytes.
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return 'unsatisfiable';
  }
  return { start, end };
}

/** A recording read back for another channel (a Slack upload) is capped here; a demo is a few megabytes. */
export const MEDIA_READ_MAX_BYTES = 60 * 1024 * 1024;

/**
 * The bytes behind a media URL this store wrote (`/api/media/<record>/<file>`),
 * for a caller that hands the file to another channel rather than streaming
 * it — a Slack upload. Null for a URL that is not this store's, a file that is
 * not there, or one over the cap; never throws.
 * @param orgId - The owning org: the key is built from it.
 * @param url - The artifact's `url` / `spec.url`.
 * @param deps - Seams for tests.
 * @param deps.maxBytes - The cap.
 */
export async function readMediaBytes(orgId: string, url: string, deps: Pick<MediaDeps, 'dir' | 'bucket'> & { maxBytes?: number } = {}): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  const m = new RegExp(`^${MEDIA_ROUTE_BASE}/([^/?#]+)/([^/?#]+)$`).exec(url.trim());
  if (!m) {
    return null;
  }
  const recordId = decodeURIComponent(m[1]!);
  const filename = decodeURIComponent(m[2]!);
  const max = deps.maxBytes ?? MEDIA_READ_MAX_BYTES;
  try {
    const found = await locateMedia(orgId, recordId, filename, deps);
    if (!found) {
      return null;
    }
    if (found.store === 'disk') {
      if (found.size > max) {
        return null;
      }
      return { bytes: new Uint8Array(await readFile(found.abs)), contentType: found.contentType, filename };
    }
    const { getObjectBytes } = await import('@/libs/aws/s3');
    const got = await getObjectBytes({ bucket: found.bucket, key: found.key, region: found.region });
    return got.bytes.byteLength > max ? null : { bytes: new Uint8Array(got.bytes), contentType: got.contentType ?? found.contentType, filename };
  } catch {
    return null;
  }
}

/*
 * ── An Org's brand files ─────────────────────────────────────────────────
 *
 * The same store keeps an Org's logo and mark (`services/branding`), under
 * `brand/<org>/<name>-<hash>.<svg|png>`. Unlike a recording they are served
 * to anyone: the sign-in page shows the logo before anybody has signed in,
 * and mail shows it in a client that has no session. So their route,
 * `/api/media/brand/<org>/<file>`, needs no session and no artifact claims
 * it; what keeps it safe is what may be stored there — a PNG, or an SVG
 * rebuilt from an allowlist (`libs/branding/svg.ts`) — and the name, which
 * carries the content hash, so a file never changes under its URL.
 */

/** Where brand files are served from. */
export const BRAND_MEDIA_BASE = `${MEDIA_ROUTE_BASE}/brand`;

/** A logo is kilobytes; this is the ceiling, said when hit. */
export const BRAND_ASSET_MAX_BYTES = 512 * 1024;

const BRAND_TYPES: Record<string, 'svg' | 'png'> = { 'image/svg+xml': 'svg', 'image/png': 'png' };
const BRAND_EXT_TYPE: Record<'svg' | 'png', string> = { svg: 'image/svg+xml', png: 'image/png' };
const SAFE_BRAND_FILE = /^[\w-]{1,160}\.(?:svg|png)$/;
const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/**
 * Whether these bytes are what they say: a PNG's signature, or text with an `<svg` element.
 * @param bytes - The file.
 * @param ext - What it claims to be.
 */
function looksLike(bytes: Uint8Array, ext: 'svg' | 'png'): boolean {
  if (ext === 'png') {
    return PNG_MAGIC.every((b, i) => bytes[i] === b);
  }
  return /<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 64 * 1024)));
}

/**
 * The served URL of a brand file.
 * @param accountId - The Org (`tenant_account.id`).
 * @param filename - The stored file.
 */
export function brandAssetUrl(accountId: string, filename: string): string {
  return `${BRAND_MEDIA_BASE}/${encodeURIComponent(accountId)}/${encodeURIComponent(filename)}`;
}

/**
 * The Org and file a brand URL names, or null when it is not one this store writes.
 * @param url - `/api/media/brand/<org>/<file>`, relative or absolute.
 */
export function parseBrandAssetUrl(url: string): { accountId: string; filename: string } | null {
  const path = url.trim().replace(/^https?:\/\/[^/]+/i, '');
  const m = new RegExp(`^${BRAND_MEDIA_BASE}/([^/?#]+)/([^/?#]+)$`).exec(path);
  if (!m) {
    return null;
  }
  const accountId = decodeURIComponent(m[1]!);
  const filename = decodeURIComponent(m[2]!);
  return SAFE_SEGMENT.test(accountId) && SAFE_BRAND_FILE.test(filename) ? { accountId, filename } : null;
}

function brandKey(accountId: string, filename: string): string {
  return `brand/${orgSegment(accountId)}/${filename}`;
}

export type KeptBrandAsset = { ok: true; url: string; filename: string; contentType: string; bytes: number; store: 's3' | 'disk' };

/**
 * Keep one of an Org's brand files. Never throws: a refusal (not a PNG or an
 * SVG, too large, nothing drawable left once cleaned, the write failed) is a
 * sentence for a person.
 * @param input - What to keep.
 * @param input.accountId - The Org.
 * @param input.name - A few words for the file name (`logo`, `mark-dark`).
 * @param input.data - The bytes.
 * @param input.contentType - `image/svg+xml` or `image/png`.
 * @param deps - Seams for tests.
 */
export async function keepBrandAsset(input: { accountId: string; name: string; data: Uint8Array; contentType: string }, deps: MediaDeps = {}): Promise<KeptBrandAsset | MediaRefusal> {
  const declared = String(input.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const ext = BRAND_TYPES[declared];
  if (!ext) {
    return { ok: false, reason: `${declared || 'That file'} can't be a logo here: upload an SVG or a PNG.` };
  }
  if (!SAFE_SEGMENT.test(input.accountId)) {
    return { ok: false, reason: 'that Org could not be found.' };
  }
  const max = deps.maxBytes ?? BRAND_ASSET_MAX_BYTES;
  if (input.data.byteLength === 0) {
    return { ok: false, reason: 'the file is empty.' };
  }
  if (input.data.byteLength > max) {
    return { ok: false, tooLarge: true, reason: `the file is ${Math.ceil(input.data.byteLength / 1024)} KB; a logo can be at most ${Math.round(max / 1024)} KB.` };
  }
  if (!looksLike(input.data, ext)) {
    return { ok: false, reason: `that file is not ${ext === 'png' ? 'a PNG' : 'an SVG'} image.` };
  }
  let data = input.data;
  if (ext === 'svg') {
    const { sanitizeSvg } = await import('@/libs/branding/svg');
    const clean = sanitizeSvg(new TextDecoder().decode(input.data));
    if (!clean) {
      return { ok: false, reason: 'nothing drawable was left in that SVG once scripts and outside references were taken out.' };
    }
    data = new TextEncoder().encode(clean);
  }
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  const filename = `${nameSegment(input.name)}-${hash}.${ext}`;
  const contentType = BRAND_EXT_TYPE[ext];
  const key = brandKey(input.accountId, filename);
  const bucket = deps.bucket === undefined ? mediaBucket() : deps.bucket;
  try {
    if (bucket) {
      const put = deps.put ?? (await import('@/libs/aws/s3')).putObject;
      await put({ bucket: bucket.bucket, key, body: data, contentType, region: bucket.region });
    } else {
      const abs = path.join(deps.dir ?? mediaDir(), key);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, data);
    }
  } catch (err) {
    return { ok: false, reason: `the file could not be written to ${bucket ? 'the media bucket' : 'the media store'} (${(err as Error)?.message?.slice(0, 200) ?? 'unknown error'}).` };
  }
  return { ok: true, url: brandAssetUrl(input.accountId, filename), filename, contentType, bytes: data.byteLength, store: bucket ? 's3' : 'disk' };
}

/**
 * One of an Org's brand files, read back: from disk when it is there, else
 * from the bucket. Null for a name this store could not have written or a file
 * that is in neither; never throws.
 * @param accountId - The Org: the key is built from it, so a name cannot reach another Org's files.
 * @param filename - The stored file.
 * @param deps - Seams for tests.
 */
export async function readBrandAsset(accountId: string, filename: string, deps: Pick<MediaDeps, 'dir' | 'bucket'> & { get?: (opts: { bucket: string; key: string; region?: string }) => Promise<{ bytes: Uint8Array; contentType: string | null }> } = {}): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!SAFE_SEGMENT.test(accountId) || !SAFE_BRAND_FILE.test(filename)) {
    return null;
  }
  const contentType = BRAND_EXT_TYPE[filename.endsWith('.png') ? 'png' : 'svg'];
  const key = brandKey(accountId, filename);
  // turbopackIgnore: the media folder is only known at runtime; traced, it
  // pulls the whole project into the build's trace (next.config.ts, #832).
  const dir = path.resolve(/* turbopackIgnore: true */ deps.dir ?? mediaDir());
  const abs = path.resolve(dir, key);
  if (abs.startsWith(dir + path.sep)) {
    try {
      return { bytes: new Uint8Array(await readFile(abs)), contentType };
    } catch { /* not on disk */ }
  }
  const bucket = deps.bucket === undefined ? mediaBucket() : deps.bucket;
  if (!bucket) {
    return null;
  }
  try {
    const get = deps.get ?? (await import('@/libs/aws/s3')).getObjectBytes;
    const got = await get({ bucket: bucket.bucket, key, region: bucket.region });
    return got.bytes.byteLength > BRAND_ASSET_MAX_BYTES ? null : { bytes: new Uint8Array(got.bytes), contentType };
  } catch {
    return null;
  }
}
