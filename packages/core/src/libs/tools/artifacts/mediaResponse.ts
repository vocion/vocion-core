import type { LocatedMedia } from './media';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { parseRange } from './media';

/** A presigned GET lives this long: long enough to start playing, never days. */
const PRESIGN_SECONDS = 600;

/**
 * The response for a recording the media store located: from disk, streamed
 * with byte ranges (a phone's player will not start without them); from S3, a
 * redirect to a presigned GET that lasts minutes. One answer for every route
 * that plays a kept recording — the signed-in media route and a public link's.
 * @param req - The request, for its Range header.
 * @param req.headers - Its headers.
 * @param found - Where the file is (`locateMedia`).
 * @param filename - The name it is served as.
 * @param extra - Headers the caller adds (a public route's noindex).
 */
export async function mediaResponse(req: { headers: Headers }, found: LocatedMedia, filename: string, extra: Record<string, string> = {}): Promise<Response> {
  if (found.store === 's3') {
    const { presignGet } = await import('@/libs/aws/s3');
    const url = await presignGet({ bucket: found.bucket, key: found.key, region: found.region, expiresIn: PRESIGN_SECONDS });
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store', ...extra } });
  }
  const base = {
    'Content-Type': found.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${filename}"`,
    ...extra,
  };
  const range = parseRange(req.headers.get('range'), found.size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${found.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: found.size - 1 };
  const body = Readable.toWeb(createReadStream(found.abs, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...base, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${found.size}` } : {}) },
  });
}
