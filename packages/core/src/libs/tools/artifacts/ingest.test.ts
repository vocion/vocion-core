/**
 * Keeping an image artifact's bytes in Vocion: what is copied, what is
 * refused and why, and that nothing on the box's own network can be reached
 * through an artifact URL. The network is stubbed; the store is a real
 * temporary directory. Every host and id below is invented.
 */
import type { Buffer } from 'node:buffer';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestExternalImage, ingestRecord, keepImageInVocion, openImage, presignedExpiry, readStoredArtifact, shouldRetryIngest } from './ingest';

// `.example` never resolves (RFC 2606), so DNS is given answers: one name that
// resolves to the metadata address, everything else to a public one.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => (host === 'rebind.example' ? [{ address: '169.254.169.254', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])),
}));

/** A real PNG, because the stored copy is later decoded. */
const PNG: Buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 120, b: 200 } } }).png().toBuffer();
const ORG = 'org_evidence';
const NOW = new Date('2026-09-29T02:00:00Z');
/** A SigV4 presigned GET signed an hour before NOW, valid seven days. */
const PRESIGNED = 'https://evidence-bucket.s3.us-west-2.amazonaws.example/qa/t1/1/library-phone-after.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260929T010000Z&X-Amz-Expires=604800&X-Amz-Signature=abc';

let dir = '';
const calls: string[] = [];

function serve(fn: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    calls.push(String(input));
    return Promise.resolve(fn(String(input)));
  }));
}

const png = () => new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/png' } });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vocion-ingest-'));
  process.env.VOCION_ARTIFACTS_DIR = dir;
  calls.length = 0;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.VOCION_ARTIFACTS_DIR;
  delete process.env.VOCION_ARTIFACT_INGEST_MAX_BYTES;
  await rm(dir, { recursive: true, force: true });
});

describe('presignedExpiry', () => {
  it('reads when a SigV4 link stops working, and says nothing for a plain link', () => {
    expect(presignedExpiry(PRESIGNED)?.toISOString()).toBe('2026-10-06T01:00:00.000Z');
    expect(presignedExpiry('https://northwind.example/logo.png')).toBeNull();
  });
});

describe('ingestExternalImage', () => {
  it('copies the bytes into the store, unchanged, under the workspace prefix', async () => {
    serve(() => png());

    const got = await ingestExternalImage({ orgId: ORG, url: PRESIGNED }, { now: NOW });

    expect(got).toMatchObject({ ok: true, contentType: 'image/png', bytes: PNG.length, sourceUrl: PRESIGNED });

    const stored = got.ok ? got : null;

    expect(stored!.url).toMatch(new RegExp(`^/api/artifacts/${ORG}-[0-9a-f]{16}/${ORG}-[0-9a-f]{16}\\.png$`));
    expect(await readdir(dir)).toEqual([stored!.filename]);
    expect(await readStoredArtifact(ORG, stored!.url)).toEqual(PNG);
  });

  it('never fetches a private or loopback address, on the first hop or after a redirect', async () => {
    serve(url => (url.includes('hop.example') ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }) : png()));

    for (const url of ['http://127.0.0.1/shot.png', 'http://localhost:3000/api/secret.png', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/x.png', 'https://rebind.example/shot.png']) {
      const got = await ingestExternalImage({ orgId: ORG, url }, { now: NOW });

      expect(got).toMatchObject({ ok: false, status: 'refused' });
    }

    expect(calls).toEqual([]);

    const redirected = await ingestExternalImage({ orgId: ORG, url: 'https://hop.example/shot.png' }, { now: NOW });

    expect(redirected).toMatchObject({ ok: false, status: 'refused' });
    // The redirect was read, its destination was not.
    expect(calls).toEqual(['https://hop.example/shot.png']);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses what is not a raster image, and what is over the cap, without retrying', async () => {
    serve(url => url.endsWith('.svg')
      ? new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { headers: { 'content-type': 'image/svg+xml' } })
      : url.endsWith('.html')
        ? new Response('<!doctype html><title>Sign in</title>', { headers: { 'content-type': 'text/html' } })
        : png());

    expect(await ingestExternalImage({ orgId: ORG, url: 'https://files.example/mark.svg' }, { now: NOW })).toMatchObject({ ok: false, status: 'refused' });
    expect(await ingestExternalImage({ orgId: ORG, url: 'https://files.example/login.html' }, { now: NOW })).toMatchObject({ ok: false, status: 'refused' });

    process.env.VOCION_ARTIFACT_INGEST_MAX_BYTES = '10';

    expect(await ingestExternalImage({ orgId: ORG, url: 'https://files.example/big.png' }, { now: NOW })).toMatchObject({ ok: false, status: 'refused' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('calls a 5xx or a dropped connection a failure worth retrying, and an expired link expired', async () => {
    serve(() => new Response('busy', { status: 503 }));
    const busy = await ingestExternalImage({ orgId: ORG, url: PRESIGNED }, { now: NOW });

    expect(busy).toMatchObject({ ok: false, status: 'failed' });
    expect(busy.ok ? '' : busy.reason).toContain('503');

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))));

    expect(await ingestExternalImage({ orgId: ORG, url: PRESIGNED }, { now: NOW })).toMatchObject({ ok: false, status: 'failed' });

    const afterExpiry = new Date('2026-10-06T02:00:00Z');

    expect(await ingestExternalImage({ orgId: ORG, url: PRESIGNED }, { now: afterExpiry })).toMatchObject({ ok: false, status: 'expired' });
  });
});

describe('keepImageInVocion', () => {
  it('points url and every spec field that carried the link at the copy, and keeps the link as sourceUrl', async () => {
    serve(() => png());

    const kept = await keepImageInVocion({ orgId: ORG, url: PRESIGNED, spec: { href: PRESIGNED, title: 'Library, phone, after', description: 'after the change' } }, { now: NOW });

    expect(kept!.url.startsWith('/api/artifacts/')).toBe(true);
    expect(kept!.spec).toEqual({ href: kept!.url, title: 'Library, phone, after', description: 'after the change' });
    expect(kept!.sourceUrl).toBe(PRESIGNED);
    expect(kept!.ingest).toMatchObject({ status: 'stored', attempts: 1, bytes: PNG.length, contentType: 'image/png', sourceExpiresAt: '2026-10-06T01:00:00.000Z' });
  });

  it('keeps the external link and records why when the copy fails', async () => {
    serve(() => new Response('busy', { status: 503 }));

    const kept = await keepImageInVocion({ orgId: ORG, url: PRESIGNED, spec: { href: PRESIGNED, title: 't' } }, { now: NOW });

    expect(kept!.url).toBe(PRESIGNED);
    expect(kept!.spec).toEqual({ href: PRESIGNED, title: 't' });
    expect(kept!.ingest.status).toBe('failed');
    expect(kept!.ingest.reason).toContain('503');
    expect(shouldRetryIngest(kept!.ingest, NOW)).toBe(true);
  });

  it('leaves alone what is not an external image: data URLs, stored copies, videos', async () => {
    serve(() => png());

    expect(await keepImageInVocion({ orgId: ORG, url: 'data:image/png;base64,iVBORw0KGgo=', spec: {} })).toBeNull();
    expect(await keepImageInVocion({ orgId: ORG, url: `/api/artifacts/${ORG}-0123456789abcdef/${ORG}-0123456789abcdef.png`, spec: {} })).toBeNull();
    expect(await keepImageInVocion({ orgId: ORG, url: 'https://evidence.example/qa/t1/1/flow-desktop.webm?X-Amz-Date=20260929T010000Z&X-Amz-Expires=604800', spec: {} })).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('the retry rule', () => {
  it('retries a failure under the cap while the link lives, and never a refusal or an expired link', () => {
    const failed = ingestRecord({ ok: false, status: 'failed', reason: 'HTTP 503', sourceUrl: PRESIGNED }, null, NOW);

    expect(shouldRetryIngest(failed, NOW)).toBe(true);
    expect(shouldRetryIngest(failed, new Date('2026-10-07T00:00:00Z'))).toBe(false);
    expect(shouldRetryIngest({ ...failed, attempts: 5 }, NOW)).toBe(false);
    expect(shouldRetryIngest({ ...failed, status: 'refused' }, NOW)).toBe(false);
    expect(shouldRetryIngest({ ...failed, status: 'expired' }, NOW)).toBe(false);
    expect(ingestRecord({ ok: false, status: 'failed', reason: 'x', sourceUrl: PRESIGNED }, failed, NOW).attempts).toBe(2);
  });
});

describe('reading the stored copy', () => {
  it('opens a stored copy from the store for its own workspace only, and never walks out of it', async () => {
    serve(() => png());
    const got = await ingestExternalImage({ orgId: ORG, url: PRESIGNED }, { now: NOW });
    const url = got.ok ? got.url : '';
    calls.length = 0;

    const opened = await openImage(ORG, url, { maxEdge: 64 });

    expect(opened.contentType).toBe('image/png');
    expect(calls).toEqual([]);
    expect(await readStoredArtifact('org_other', url)).toBeNull();
    expect(await readStoredArtifact(ORG, `/api/artifacts/${ORG}-x/..%2F..%2Fetc%2Fpasswd`)).toBeNull();
    await expect(openImage('org_other', url)).rejects.toThrow(/not in the artifact store/);
  });
});
