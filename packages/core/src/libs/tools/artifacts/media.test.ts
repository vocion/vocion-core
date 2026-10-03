import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { keepMedia, locateMedia, mediaKey, parseRange, videoExt } from './media';

const ORG = 'org_media_northwind';
const WEBM = Buffer.from('\x1A\x45\xDF\xA3 fictional webm bytes');

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vocion-media-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('keeping a recording', () => {
  it('writes it to disk under <org>/<record>/ with no bucket, and serves it from the media route', async () => {
    const kept = await keepMedia({ orgId: ORG, recordId: 41, name: 'Live check desktop', data: WEBM, contentType: 'video/webm' }, { dir, bucket: null });

    expect(kept).toMatchObject({ ok: true, store: 'disk', contentType: 'video/webm', bytes: WEBM.byteLength });

    if (!kept.ok) {
      return;
    }

    expect(kept.filename).toMatch(/^live-check-desktop-[0-9a-f]{16}\.webm$/);
    expect(kept.url).toBe(`/api/media/41/${kept.filename}`);
    expect(kept.key).toBe(`${ORG}/41/${kept.filename}`);
    expect(await readFile(path.join(dir, kept.key))).toEqual(WEBM);
  });

  it('puts it in the bucket when one is set, with its type, and writes nothing to disk', async () => {
    const put = vi.fn(async () => {});
    const kept = await keepMedia({ orgId: ORG, recordId: 41, name: 'qa run', data: WEBM, contentType: 'video/mp4' }, { dir: path.join(dir, 'unused'), bucket: { bucket: 'vocion-media-test', region: 'us-east-1' }, put });

    expect(kept).toMatchObject({ ok: true, store: 's3', contentType: 'video/mp4' });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'vocion-media-test', region: 'us-east-1', contentType: 'video/mp4', key: expect.stringMatching(new RegExp(`^${ORG}/41/qa-run-[0-9a-f]{16}\\.mp4$`)) }));
    expect(await locateMedia(ORG, '41', (kept as { filename: string }).filename, { dir: path.join(dir, 'unused'), bucket: null })).toBeNull();
  });

  it('refuses what is not a video, an empty file and one over the cap, each in a sentence', async () => {
    const png = await keepMedia({ orgId: ORG, recordId: 41, name: 'x', data: WEBM, contentType: 'image/png' }, { dir, bucket: null });
    const empty = await keepMedia({ orgId: ORG, recordId: 41, name: 'x', data: Buffer.alloc(0), contentType: 'video/webm' }, { dir, bucket: null });
    const big = await keepMedia({ orgId: ORG, recordId: 41, name: 'x', data: Buffer.alloc(3 * 1024 * 1024), contentType: 'video/webm' }, { dir, bucket: null, maxBytes: 2 * 1024 * 1024 });

    expect(png).toMatchObject({ ok: false, reason: expect.stringContaining('WebM or MP4') });
    expect(empty).toMatchObject({ ok: false, reason: 'the recording is empty.' });
    expect(big).toMatchObject({ ok: false, tooLarge: true, reason: 'the recording is 3.0 MB, over the 2 MB a recording may be.' });
  });

  it('says a failed write rather than throwing', async () => {
    const put = vi.fn(async () => {
      throw new Error('AccessDenied');
    });
    const kept = await keepMedia({ orgId: ORG, recordId: 41, name: 'x', data: WEBM, contentType: 'video/webm' }, { bucket: { bucket: 'b', region: undefined }, put });

    expect(kept).toEqual({ ok: false, reason: 'the recording could not be written to the media bucket (AccessDenied).' });
  });

  it('reads a codec parameter on the type, and nothing else as a video', () => {
    expect(videoExt('video/webm; codecs=vp8')).toBe('webm');
    expect(videoExt('video/quicktime')).toBeNull();
    expect(videoExt(null)).toBeNull();
  });
});

describe('finding it again', () => {
  it('finds a file on disk for its own org only, and builds the bucket key from the caller\'s org', async () => {
    const kept = await keepMedia({ orgId: ORG, recordId: 52, name: 'phone', data: WEBM, contentType: 'video/webm' }, { dir, bucket: null });
    const filename = (kept as { filename: string }).filename;

    expect(await locateMedia(ORG, '52', filename, { dir, bucket: null })).toMatchObject({ store: 'disk', size: WEBM.byteLength, contentType: 'video/webm' });
    // Another org asking the same path reaches its own prefix, where nothing is.
    expect(await locateMedia('org_media_kestrel', '52', filename, { dir, bucket: null })).toBeNull();
    expect(await locateMedia('org_media_kestrel', '52', filename, { dir, bucket: { bucket: 'b', region: undefined } })).toMatchObject({ store: 's3', key: mediaKey('org_media_kestrel', '52', filename) });
  });

  it('refuses a path this store could not have written', async () => {
    expect(await locateMedia(ORG, '..', 'x.webm', { dir, bucket: null })).toBeNull();
    expect(await locateMedia(ORG, '52', '../../etc/passwd', { dir, bucket: null })).toBeNull();
    expect(await locateMedia(ORG, '52', 'notes.txt', { dir, bucket: { bucket: 'b', region: undefined } })).toBeNull();
  });

  it('answers byte ranges the way a phone\'s player asks for them', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=200-', 100)).toBe('unsatisfiable');
  });
});
