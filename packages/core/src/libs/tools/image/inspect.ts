/**
 * Is this really an image? — decided by the bytes, never by the name.
 *
 * An agent asked for a client's logo, called `fetch_url`, got the PNG back
 * as garbled text through a reader built for prose, and gave up and wrote a
 * text wordmark instead (production, 2026-09-19). The fix is a path that
 * handles bytes, and a path that handles bytes has to know what it received:
 * a URL ending `.png` that serves an HTML login page, a redirect to a
 * sign-in form, or a 4 MB hero shot are all things to refuse with a sentence
 * rather than inline into a client's proposal.
 *
 * Pure. The magic-byte table is the whole judgement, so it is testable with
 * a handful of byte arrays and no network.
 */

import type { Buffer } from 'node:buffer';

export const IMAGE_KINDS = ['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'] as const;
export type ImageKind = typeof IMAGE_KINDS[number];

/** Raster kinds sharp can decode, resize and re-encode. */
export const RASTER_KINDS: ReadonlySet<ImageKind> = new Set<ImageKind>(['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

export const CONTENT_TYPES: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

const starts = (b: Buffer, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);

/**
 * The kind these bytes actually are, or null for anything that is not an
 * image. SVG is text, so it is sniffed as text: a root `<svg` element
 * after any BOM, XML declaration, doctype or comment.
 * @param bytes - The first kilobytes are enough; the whole buffer is fine.
 */
export function sniffImage(bytes: Buffer): ImageKind | null {
  if (bytes.length < 4) {
    return null;
  }
  if (starts(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
    return 'png';
  }
  if (starts(bytes, [0xFF, 0xD8, 0xFF])) {
    return 'jpeg';
  }
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'gif';
  }
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  // ISO-BMFF: `ftyp` at offset 4, brand `avif`/`avis` at 8.
  if (starts(bytes, [0x66, 0x74, 0x79, 0x70], 4) && /^avi[fs]$/.test(bytes.subarray(8, 12).toString('latin1'))) {
    return 'avif';
  }
  if (starts(bytes, [0x42, 0x4D])) {
    return 'bmp';
  }
  if (starts(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return 'ico';
  }
  const head = bytes.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  const text = head.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').trimStart();
  return /^<svg[\s>]/i.test(text) ? 'svg' : null;
}

/**
 * The kind a `Content-Type` header claims, or null when it claims no image.
 * @param contentType - The header value, as served.
 */
export function kindFromContentType(contentType: string | null | undefined): ImageKind | null {
  const ct = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ct.startsWith('image/')) {
    return null;
  }
  const sub = ct.slice('image/'.length);
  if (sub === 'jpg' || sub === 'jpeg' || sub === 'pjpeg') {
    return 'jpeg';
  }
  if (sub === 'svg+xml' || sub === 'svg') {
    return 'svg';
  }
  if (sub === 'x-icon' || sub === 'vnd.microsoft.icon' || sub === 'ico') {
    return 'ico';
  }
  return (IMAGE_KINDS as readonly string[]).includes(sub) ? sub as ImageKind : null;
}

export type ImageVerdict = { ok: true; kind: ImageKind } | { ok: false; reason: string };

/**
 * Accept or refuse the bytes, with a sentence a person could read.
 *
 * Both signals have to agree before this is treated as an image, and the
 * BYTES decide what it is: a `Content-Type` is a claim by whoever served it,
 * and a file extension is not evidence of anything at all.
 * @param input - What arrived.
 * @param input.bytes - The body.
 * @param input.contentType - The `Content-Type` header, when there was one.
 * @param input.maxBytes - The cap; anything larger is refused unread.
 */
export function validateImageBytes(input: { bytes: Buffer; contentType?: string | null; maxBytes: number }): ImageVerdict {
  const { bytes, contentType, maxBytes } = input;
  if (bytes.length === 0) {
    return { ok: false, reason: 'the response was empty.' };
  }
  if (bytes.length > maxBytes) {
    return { ok: false, reason: `it is ${Math.round(bytes.length / 1024)} KB, over the ${Math.round(maxBytes / 1024)} KB cap. Ask for a smaller version of the image.` };
  }
  const claimed = kindFromContentType(contentType);
  const actual = sniffImage(bytes);
  if (!actual) {
    const what = (contentType ?? '').split(';')[0]!.trim() || 'no content type';
    const looksHtml = /^\s*(?:<!doctype html|<html)/i.test(bytes.subarray(0, 200).toString('utf8'));
    return { ok: false, reason: looksHtml ? `that URL serves an HTML page, not an image (${what}). It is probably a page the logo sits ON — find the image's own URL.` : `those bytes are not an image (${what}).` };
  }
  if (contentType && !claimed) {
    return { ok: false, reason: `the server called it ${(contentType.split(';')[0] ?? '').trim()}, not an image.` };
  }
  return { ok: true, kind: actual };
}

/**
 * An SVG's declared size: `width`/`height` when they are plain numbers,
 * else the `viewBox`. Null when it says neither — an SVG scales, so a
 * missing size is a fact about the file, not an error.
 * @param svg - The SVG source.
 */
export function svgDimensions(svg: string): { width: number; height: number } | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const num = (name: string): number | null => {
    const raw = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(open)?.[1]?.trim();
    const n = raw ? Number.parseFloat(raw.replace(/px$/i, '')) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const w = num('width');
  const h = num('height');
  if (w && h) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  const box = /\bviewBox\s*=\s*"([^"]*)"/i.exec(open)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(n => Number.isFinite(n)) && box[2]! > 0 && box[3]! > 0) {
    return { width: Math.round(box[2]!), height: Math.round(box[3]!) };
  }
  return null;
}

/**
 * An SVG that carries script is not a logo, it is code that will run
 * wherever the document is opened. Refused rather than stripped: a
 * half-sanitised SVG is a worse answer than a clear no.
 * @param svg - The SVG source.
 */
export function svgIsInert(svg: string): boolean {
  return !/<script\b/i.test(svg) && !/\son\w+\s*=/i.test(svg) && !/javascript:/i.test(svg) && !/<foreignObject\b/i.test(svg);
}
