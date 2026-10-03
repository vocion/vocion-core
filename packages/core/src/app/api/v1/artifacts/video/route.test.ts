import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { POST } = await import('./route');
const { GET: getMedia } = await import('@/app/api/media/[recordId]/[filename]/route');

const ORG = 'org_video_upload';
const OTHER = 'org_video_other';
const WEBM = Buffer.from('\x1A\x45\xDF\xA3 a fictional recording of the rename page');

let dir: string;
let requestId: number;
let taskId: number;

function token(orgId: string) {
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId, tokenId: 'tok-1', principal: { kind: 'token', id: 'tok-1', role: 'member', scope: { orgId } } } as never);
}

function upload(query: string, body: Buffer | null, headers: Record<string, string> = {}, signedIn = true) {
  return new Request(`http://localhost/api/v1/artifacts/video?${query}`, { method: 'POST', headers: { 'content-type': 'video/webm', ...(signedIn ? { authorization: 'Bearer vcn_live_x' } : {}), ...headers }, body, duplex: 'half' } as RequestInit);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vocion-video-route-'));
  process.env.VOCION_ARTIFACTS_DIR = dir;
  delete process.env.VOCION_MEDIA_BUCKET;
  const [reqType] = await createObjectType({ slug: 'request', label: 'Request' }, ORG);
  const [taskType] = await createObjectType({ slug: 'engineering_task', label: 'Task' }, ORG);
  const [request] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: reqType!.id, title: 'Rename a document', status: 'active', metadata: {} }).returning();
  const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: taskType!.id, title: 'Rename, the build', status: 'active', metadata: { requestId: request!.id } }).returning();
  requestId = request!.id;
  taskId = task!.id;
});

beforeEach(() => {
  vi.mocked(authenticateBearer).mockReset();
  vi.mocked(clerkAuth).mockReset();
  delete process.env.VOCION_MEDIA_MAX_BYTES;
});

afterAll(async () => {
  delete process.env.VOCION_ARTIFACTS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('POST /api/v1/artifacts/video', () => {
  it('needs a credential', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null } as never);
    const res = await POST(upload(`recordId=${taskId}`, WEBM, {}, false));

    expect(res.status).toBe(401);
  });

  it('refuses a body that is not a video, saying which types it takes', async () => {
    token(ORG);
    const res = await POST(upload(`recordId=${taskId}`, WEBM, { 'content-type': 'image/png' }));

    expect(res.status).toBe(415);
    expect((await res.json()).error.message).toContain('video/webm or video/mp4');
  });

  it('refuses one over the cap, by its declared length and by what actually arrived', async () => {
    token(ORG);
    process.env.VOCION_MEDIA_MAX_BYTES = String(16);
    const declared = await POST(upload(`recordId=${taskId}`, WEBM, { 'content-length': String(WEBM.byteLength) }));

    expect(declared.status).toBe(413);
    expect((await declared.json()).error.message).toMatch(/^A recording may be 0 MB at most/);

    const streamed = await POST(upload(`recordId=${taskId}`, WEBM));

    expect(streamed.status).toBe(413);
  });

  it('refuses a record that is not this workspace\'s', async () => {
    token(OTHER);
    const res = await POST(upload(`recordId=${taskId}`, WEBM));

    expect(res.status).toBe(404);
  });

  it('keeps the recording once and files it on the task AND its feature request, then serves it to that workspace only, with byte ranges', async () => {
    token(ORG);
    const res = await POST(upload(`recordId=${taskId}&title=${encodeURIComponent('Rename · recording')}&caption=${encodeURIComponent('rename · desktop · before merge')}&name=rename`, WEBM));

    expect(res.status).toBe(201);

    const body = await res.json();

    expect(body).toMatchObject({ store: 'disk', bytes: WEBM.byteLength, requestId, url: expect.stringMatching(new RegExp(`^/api/media/${requestId}/rename-[0-9a-f]{16}\\.webm$`)) });
    expect(body.artifactIds).toHaveLength(2);

    const rows = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, ORG), eq(artifactSchema.url, body.url)));

    expect(rows.map(r => [r.recordId, r.recordRole, r.kind]).sort()).toEqual([[String(requestId), 'qa-video', 'file'], [String(taskId), 'qa-video', 'file']].sort());
    expect(rows[0]!.spec).toMatchObject({ caption: 'rename · desktop · before merge', contentType: 'video/webm', url: body.url });

    const [, , , recordSeg, file] = (body.url as string).split('/');
    const whole = await getMedia(new NextRequest(`http://localhost${body.url}`, { headers: { authorization: 'Bearer vcn_live_x' } }), { params: Promise.resolve({ recordId: recordSeg!, filename: file! }) });

    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(WEBM);

    const part = await getMedia(new NextRequest(`http://localhost${body.url}`, { headers: { authorization: 'Bearer vcn_live_x', range: 'bytes=0-3' } }), { params: Promise.resolve({ recordId: recordSeg!, filename: file! }) });

    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-3/${WEBM.byteLength}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(WEBM.subarray(0, 4));

    token(OTHER);
    const other = await getMedia(new NextRequest(`http://localhost${body.url}`, { headers: { authorization: 'Bearer vcn_live_x' } }), { params: Promise.resolve({ recordId: recordSeg!, filename: file! }) });

    expect(other.status).toBe(404);
  });

  it('redirects to a short-lived presigned link when the recording is in the bucket', async () => {
    token(ORG);
    process.env.VOCION_MEDIA_BUCKET = 'vocion-media-test';
    process.env.VOCION_MEDIA_REGION = 'us-east-1';
    const keys = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
    process.env.AWS_ACCESS_KEY_ID = 'AKIAFAKETESTKEY0001';
    process.env.AWS_SECRET_ACCESS_KEY = 'fakeSecretKeyForTestsOnly0000000000000000';
    try {
      const res = await getMedia(new NextRequest('http://localhost/api/media/41/qa-run-0123456789abcdef.webm', { headers: { authorization: 'Bearer vcn_live_x' } }), { params: Promise.resolve({ recordId: '41', filename: 'qa-run-0123456789abcdef.webm' }) });

      expect(res.status).toBe(302);

      const to = new URL(res.headers.get('location')!);

      expect(to.hostname).toContain('vocion-media-test');
      expect(to.pathname).toBe(`/${ORG}/41/qa-run-0123456789abcdef.webm`);
      expect(to.searchParams.get('X-Amz-Expires')).toBe('600');
    } finally {
      delete process.env.VOCION_MEDIA_BUCKET;
      delete process.env.VOCION_MEDIA_REGION;
      for (const [k, v] of [['AWS_ACCESS_KEY_ID', keys.id], ['AWS_SECRET_ACCESS_KEY', keys.secret]] as const) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  });
});
