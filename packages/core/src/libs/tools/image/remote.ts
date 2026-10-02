/**
 * Fetch one image from the public internet and make it small enough to live
 * inside a document.
 *
 * A client document is self-contained HTML that prints to PDF, so the only
 * form of an image it can hold is a data URI. Getting one used to be
 * impossible: `fetch_url` is a prose reader, and pointing it at a PNG
 * returned mojibake, which is how a live proposal came to carry a fabricated
 * text wordmark where the client's logo belongs (2026-09-19).
 *
 * The rules here are the ones that make a fetched byte stream safe to inline:
 *
 *   - the address is public (`libs/net/publicUrl.ts`), on every redirect hop,
 *     so a URL cannot reach the metadata service or an internal page;
 *   - the bytes are really an image (`inspect.ts`), by magic number — an
 *     extension and a `Content-Type` are both claims;
 *   - the body is capped while it is being read, not after, so a 2 GB
 *     response costs a megabyte and a refusal;
 *   - a raster is downscaled to a sane edge and re-encoded, because a logo
 *     in a document is 200 px wide and a hero PNG is not;
 *   - an SVG carrying script is refused rather than sanitised.
 */

import type { ImageKind } from './inspect';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { resolvesPublicly } from '@/libs/net/publicUrl';
import { CONTENT_TYPES, RASTER_KINDS, svgDimensions, svgIsInert, validateImageBytes } from './inspect';

/** The most we will pull off the wire before refusing. */
export const MAX_FETCH_BYTES = 8 * 1024 * 1024;
/** The most a data URI may be, so a document stays a document. */
export const MAX_DATA_URI_BYTES = 256 * 1024;
/** Longest edge a fetched image is scaled down to unless asked otherwise. */
export const DEFAULT_MAX_EDGE = 480;

/**
 * Why a fetch was refused, for a caller that has to decide whether to try
 * again: `blocked` (not a public address), `not_image` and `too_large` will
 * refuse the same way next time; `http` and `network` might not.
 */
export type ImageFetchErrorCode = 'blocked' | 'not_image' | 'too_large' | 'http' | 'network';

export class ImageFetchError extends Error {
  constructor(message: string, public readonly code: ImageFetchErrorCode = 'http', public readonly status: number | null = null) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

export type FetchedImage = {
  kind: ImageKind;
  /** `data:image/png;base64,…` — ready to inline. */
  dataUri: string;
  /** The bytes as stored, after any downscale. */
  bytes: Buffer;
  contentType: string;
  width: number | null;
  height: number | null;
  /** The size the source was, before the downscale. */
  sourceBytes: number;
  /** The URL finally fetched, after redirects. */
  url: string;
};

/**
 * Read a capped body. The cap is enforced chunk by chunk so an enormous
 * response is abandoned rather than buffered.
 * @param res - The response.
 * @param maxBytes - The cap.
 */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ImageFetchError(`it is ${Math.round(declared / 1024)} KB, over the ${Math.round(maxBytes / 1024)} KB cap.`, 'too_large');
  }
  const body = res.body;
  if (!body) {
    throw new ImageFetchError('the response had no body.');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ImageFetchError(`it is over the ${Math.round(maxBytes / 1024)} KB cap.`, 'too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Follow up to `hops` redirects by hand, checking each destination is still
 * a public address. `redirect: 'follow'` would do the hops inside fetch,
 * where the guard cannot see them.
 * @param raw - The URL to fetch.
 * @param hops - How many redirects to follow.
 */
async function fetchGuarded(raw: string, hops = 4): Promise<Response> {
  let target = raw;
  for (let i = 0; i <= hops; i++) {
    const verdict = await resolvesPublicly(target);
    if (!verdict.ok) {
      throw new ImageFetchError(verdict.reason, 'blocked');
    }
    let res: Response;
    try {
      res = await fetch(verdict.url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'VocionBot/1.0 (+https://vocion.com)', 'Accept': 'image/*' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ImageFetchError(`${verdict.url.host} did not answer (${(err as Error).message || 'network error'}).`, 'network');
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) {
        throw new ImageFetchError(`the server redirected (HTTP ${res.status}) with no destination.`);
      }
      await res.body?.cancel().catch(() => {});
      target = new URL(next, verdict.url).toString();
      continue;
    }
    if (!res.ok) {
      throw new ImageFetchError(`HTTP ${res.status} from ${verdict.url.host}.`, 'http', res.status);
    }
    return res;
  }
  throw new ImageFetchError('too many redirects.');
}

/** The bytes of one image, verified and untouched. */
export type FetchedImageBytes = {
  kind: ImageKind;
  bytes: Buffer;
  contentType: string;
  /** The URL finally fetched, after redirects. */
  url: string;
};

/**
 * Fetch one image and verify it is one, without changing a byte: the address
 * is public on every hop, the body is capped while it is read, and the bytes
 * are an image by magic number. `fetchImage` shrinks these for a document;
 * an artifact keeps them as they are (`libs/tools/artifacts/ingest.ts`).
 * @param url - Where the image is.
 * @param opts - Limits.
 * @param opts.maxFetchBytes - The wire cap.
 */
export async function fetchImageBytes(url: string, opts: { maxFetchBytes?: number } = {}): Promise<FetchedImageBytes> {
  const maxFetch = opts.maxFetchBytes ?? MAX_FETCH_BYTES;
  const res = await fetchGuarded(url);
  const raw = await readCapped(res, maxFetch);
  const verdict = validateImageBytes({ bytes: raw, contentType: res.headers.get('content-type'), maxBytes: maxFetch });
  if (!verdict.ok) {
    throw new ImageFetchError(verdict.reason, 'not_image');
  }
  return { kind: verdict.kind, bytes: raw, contentType: CONTENT_TYPES[verdict.kind], url: res.url || url };
}

/**
 * Fetch, verify and shrink one image.
 *
 * Throws `ImageFetchError` with a sentence for every refusal, so a caller
 * can hand the reason straight to whoever asked without inventing one.
 * @param url - Where the image is.
 * @param opts - Limits.
 * @param opts.maxEdge - Longest edge after the downscale (rasters only).
 * @param opts.maxFetchBytes - The wire cap.
 * @param opts.maxDataUriBytes - The cap on the result.
 */
export async function fetchImage(url: string, opts: { maxEdge?: number; maxFetchBytes?: number; maxDataUriBytes?: number } = {}): Promise<FetchedImage> {
  return shrinkImage(await fetchImageBytes(url, { maxFetchBytes: opts.maxFetchBytes }), opts);
}

/**
 * Shrink verified image bytes to something a document can inline — the half
 * of `fetchImage` that never touches the network, so bytes Vocion already
 * holds (an artifact's stored copy) take the same path as bytes just fetched.
 * @param got - Verified bytes, from `fetchImageBytes` or the artifact store.
 * @param opts - Limits.
 * @param opts.maxEdge - Longest edge after the downscale (rasters only).
 * @param opts.maxDataUriBytes - The cap on the result.
 */
export async function shrinkImage(got: FetchedImageBytes, opts: { maxEdge?: number; maxDataUriBytes?: number } = {}): Promise<FetchedImage> {
  const maxEdge = Math.max(16, Math.min(2048, opts.maxEdge ?? DEFAULT_MAX_EDGE));
  const maxDataUri = opts.maxDataUriBytes ?? MAX_DATA_URI_BYTES;
  const raw = got.bytes;
  const finalUrl = got.url;

  if (got.kind === 'svg') {
    const svg = raw.toString('utf8');
    if (!svgIsInert(svg)) {
      throw new ImageFetchError('that SVG carries script or an event handler, so it is not a logo — it is code that would run wherever the document is opened. Ask for a PNG.');
    }
    const dims = svgDimensions(svg);
    const dataUri = `data:image/svg+xml;base64,${raw.toString('base64')}`;
    if (dataUri.length > maxDataUri) {
      throw new ImageFetchError(`that SVG is ${Math.round(raw.length / 1024)} KB, too big to inline. Ask for a simpler mark or a PNG.`);
    }
    return { kind: 'svg', dataUri, bytes: raw, contentType: CONTENT_TYPES.svg, width: dims?.width ?? null, height: dims?.height ?? null, sourceBytes: raw.length, url: finalUrl };
  }

  if (!RASTER_KINDS.has(got.kind)) {
    // ICO: multi-image container, decoded by nothing here. Honest refusal
    // beats a favicon stretched across a cover.
    throw new ImageFetchError(`${got.kind.toUpperCase()} is not inlined — it is a favicon container, not a logo. Ask for the PNG or SVG mark.`);
  }

  let edge = maxEdge;
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await sharp(raw, { failOn: 'error' })
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer({ resolveWithObject: true })
      .catch((err: Error) => {
        throw new ImageFetchError(`that image could not be decoded (${err.message.split('\n')[0]}).`);
      });
    const dataUri = `data:image/png;base64,${out.data.toString('base64')}`;
    if (dataUri.length <= maxDataUri) {
      return { kind: 'png', dataUri, bytes: out.data, contentType: CONTENT_TYPES.png, width: out.info.width, height: out.info.height, sourceBytes: raw.length, url: finalUrl };
    }
    edge = Math.max(64, Math.round(edge / 2));
  }
  throw new ImageFetchError(`that image is still over ${Math.round(maxDataUri / 1024)} KB after downscaling. It is a photograph, not a mark — use a logo file.`);
}
