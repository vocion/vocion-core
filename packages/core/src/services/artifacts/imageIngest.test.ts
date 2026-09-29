/**
 * An image artifact written with someone else's link is kept in Vocion: the
 * write copies the bytes, the authenticated route serves the copy, a failed
 * copy keeps the link and says why, and the backfill and the sweep bring older
 * rows along. The network is stubbed; the database and the store are real.
 * Every host, id and name below is invented.
 */
import { Buffer } from 'node:buffer';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));

const { db } = await import('@/libs/DB');
const { artifactSchema, artifactVersionSchema } = await import('@/models/Schema');
const { eq, asc } = await import('drizzle-orm');
const { createArtifact, listArtifactVersions, toPayload, updateArtifact } = await import('@/services/ArtifactService');
const { resolveArtifactFile } = await import('@/libs/tools/artifacts/serve');
const { keepExistingImages, sweepFailedImageIngests } = await import('./imageIngest');

const ORG = 'org_evidence_kept';
const OTHER = 'org_evidence_other';
const NOW = new Date('2026-09-29T02:00:00Z');
const PNG: Buffer = await sharp({ create: { width: 6, height: 4, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

/**
 * A SigV4 presigned GET signed at `date`, valid seven days.
 * @param name
 * @param date
 */
const presigned = (name: string, date = '20260929T010000Z') => `https://evidence-bucket.s3.us-west-2.amazonaws.example/qa/t7/41/${name}.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${date}&X-Amz-Expires=604800&X-Amz-Signature=abc`;

let dir = '';
let answer: (url: string) => Response = () => new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } });
const fetched: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vocion-kept-'));
  process.env.VOCION_ARTIFACTS_DIR = dir;
  fetched.length = 0;
  answer = () => new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } });
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    fetched.push(String(input));
    return Promise.resolve(answer(String(input)));
  }));
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.VOCION_ARTIFACTS_DIR;
  await rm(dir, { recursive: true, force: true });
});

const shot = (url: string, title = 'Library, phone, after') => createArtifact({
  orgId: ORG,
  kind: 'link',
  title,
  spec: { href: url, title, description: 'after the change', contentType: 'image/png' },
  url,
  record: { type: 'object', id: '7', role: 'qa-screenshot' },
  author: { kind: 'agent', id: 'token:t1' },
});

/**
 * Rows written before copies were kept: an external url, no ingest.
 * @param url
 */
const legacy = async (url: string) => (await db.insert(artifactSchema).values({ orgId: ORG, kind: 'link', title: 'old shot', url, spec: { href: url, title: 'old shot' }, currentVersion: 1 } as never).returning())[0]!;

const serve = (orgId: string, url: string) => {
  const [, , , id, filename] = url.split('/');
  return resolveArtifactFile({
    callerOrgId: orgId,
    id: id!,
    filename,
    viewer: { userId: 'user_1', hasToken: false },
    lookupRow: async () => null,
    lookupShareByFile: async () => ({ audience: 'workspace', ownerId: null }),
  });
};

describe('writing an image artifact with an external link', () => {
  it('copies the bytes, serves them from Vocion, and keeps the link as sourceUrl', async () => {
    const source = presigned('library-phone-after');
    const { artifact } = await shot(source);

    expect(artifact.url).toMatch(new RegExp(`^/api/artifacts/${ORG}-[0-9a-f]{16}/${ORG}-[0-9a-f]{16}\\.png$`));
    expect(artifact.sourceUrl).toBe(source);
    expect(artifact.ingest).toMatchObject({ status: 'stored', attempts: 1, contentType: 'image/png', bytes: PNG.length });
    // The card, the page and the reports read the spec too: it names the copy.
    expect(artifact.spec.href).toBe(artifact.url);
    expect(toPayload(artifact).sourceUrl).toBe(source);

    const served = await serve(ORG, artifact.url!);

    expect(served.status).toBe(200);
    expect('body' in served && Buffer.from(served.body).equals(PNG)).toBe(true);
    expect('headers' in served && served.headers['Content-Type']).toBe('image/png');
    // Another workspace learns nothing about it.
    expect((await serve(OTHER, artifact.url!)).status).toBe(404);
  });

  it('keeps the external link and records why when the copy fails', async () => {
    answer = () => new Response('slow down', { status: 503 });
    const source = presigned('search-desktop-after');
    const { artifact } = await shot(source);

    expect(artifact.url).toBe(source);
    expect(artifact.spec.href).toBe(source);
    expect(artifact.sourceUrl).toBe(source);
    expect(artifact.ingest).toMatchObject({ status: 'failed', attempts: 1 });
    expect(artifact.ingest!.reason).toContain('503');
    expect(await readdir(dir)).toEqual([]);
  });

  it('points a restored pre-copy version back at the copy, without fetching the old link', async () => {
    const source = presigned('restore-me');
    const { artifact } = await shot(source);
    fetched.length = 0;

    const { artifact: after } = await updateArtifact({ orgId: ORG, id: artifact.id, spec: { href: source, title: 'Library, phone, after' }, author: { kind: 'human', id: 'user_1' } });

    expect(after.spec.href).toBe(artifact.url);
    expect(after.url).toBe(artifact.url);
    expect(fetched).toEqual([]);
  });
});

describe('the backfill', () => {
  it('reports what it would copy on a dry run and changes nothing', async () => {
    await legacy(presigned('still-valid'));
    await legacy(presigned('long-gone', '20260901T000000Z'));
    await legacy('https://evidence-bucket.s3.us-west-2.amazonaws.example/qa/t7/41/flow-desktop.webm?X-Amz-Date=20260929T010000Z&X-Amz-Expires=604800');
    await legacy('https://files.example/qa/no-expiry.png');
    const before = await db.select().from(artifactSchema).orderBy(asc(artifactSchema.id));

    const lines: string[] = [];
    const counts = await keepExistingImages({ apply: false, now: NOW, log: l => lines.push(l) });

    expect(counts).toEqual({ candidates: 4, wouldTry: 2, expired: 1, videos: 1, stored: 0, failed: 0 });
    expect(lines).toHaveLength(4);
    expect(fetched).toEqual([]);
    expect(await db.select().from(artifactSchema).orderBy(asc(artifactSchema.id))).toEqual(before);
    expect(await readdir(dir)).toEqual([]);
  });

  it('copies on --apply as a new version by system, records the expired ones, and a re-run selects nothing', async () => {
    const valid = await legacy(presigned('still-valid'));
    const gone = await legacy(presigned('long-gone', '20260901T000000Z'));

    const counts = await keepExistingImages({ apply: true, now: NOW });

    expect(counts).toMatchObject({ candidates: 2, stored: 1, expired: 1, failed: 0 });

    const [kept] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, valid.id));

    expect(kept!.url!.startsWith('/api/artifacts/')).toBe(true);
    expect(kept!.spec.href).toBe(kept!.url);
    expect(kept!.sourceUrl).toBe(presigned('still-valid'));
    expect(kept!.currentVersion).toBe(2);
    expect((await listArtifactVersions({ orgId: ORG, artifactId: valid.id }))[0]).toMatchObject({ authorKind: 'system', changeSummary: 'Kept a copy in Vocion' });

    const [expired] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, gone.id));

    expect(expired!.url).toBe(presigned('long-gone', '20260901T000000Z'));
    expect(expired!.ingest).toMatchObject({ status: 'expired' });

    fetched.length = 0;

    expect(await keepExistingImages({ apply: true, now: NOW })).toMatchObject({ candidates: 0, stored: 0 });
    expect(fetched).toEqual([]);
  });
});

describe('the sweep', () => {
  it('retries a failed copy while its link is valid, and leaves a copy that worked alone', async () => {
    answer = () => new Response('slow down', { status: 503 });
    const { artifact: failed } = await shot(presigned('flaky'), 'flaky');
    answer = () => new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } });
    const { artifact: fine } = await shot(presigned('fine'), 'fine');
    fetched.length = 0;

    expect(await sweepFailedImageIngests({ now: NOW })).toEqual({ retried: 1, stored: 1 });
    expect(fetched).toEqual([presigned('flaky')]);

    const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, failed.id));

    expect(row!.url!.startsWith('/api/artifacts/')).toBe(true);
    expect(row!.ingest).toMatchObject({ status: 'stored', attempts: 2 });

    const [untouched] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, fine.id));

    expect(untouched!.currentVersion).toBe(1);
  });

  it('does not retry once the link has expired', async () => {
    answer = () => new Response('slow down', { status: 503 });
    await shot(presigned('flaky'), 'flaky');
    fetched.length = 0;

    expect(await sweepFailedImageIngests({ now: new Date('2026-10-07T00:00:00Z') })).toEqual({ retried: 0, stored: 0 });
    expect(fetched).toEqual([]);
  });
});
