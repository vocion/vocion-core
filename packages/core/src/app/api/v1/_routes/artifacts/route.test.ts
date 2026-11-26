/**
 * `POST /api/v1/artifacts` — the route the factory worker posts its QA
 * evidence to. A screenshot lands on the record with its picture drawable, a
 * record in another workspace is refused, and a bad body says what is wrong.
 * Every id and name below is invented.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { eq } = await import('drizzle-orm');
const { POST } = await import('./route');

const ORG = 'org_artifacts_route';
const OTHER = 'org_artifacts_route_other';
let taskId = 0;
let foreignId = 0;

function post(body: unknown): Request {
  return new Request('https://vocion.test/api/v1/artifacts', { method: 'POST', headers: { 'authorization': 'Bearer vcn_live_fake', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: ORG, tokenId: 't1', principal: { kind: 'user', id: 'token:t1', role: 'owner', scope: { orgId: ORG }, grants: ['*'] } } as never);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  const [t] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'engineering_task', label: 'Task', schema: {} }).returning();
  const [o] = await db.insert(businessObjectTypeSchema).values({ orgId: OTHER, slug: 'engineering_task', label: 'Task', schema: {} }).returning();
  taskId = (await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: t!.id, title: 'Add search', metadata: {} }).returning())[0]!.id;
  foreignId = (await db.insert(businessObjectSchema).values({ orgId: OTHER, typeId: o!.id, title: 'Not yours', metadata: {} }).returning())[0]!.id;
});

describe('a worker posting its evidence', () => {
  it('attaches a screenshot to the task with its picture on the artifact', async () => {
    const res = await POST(post({ recordType: 'object', recordId: String(taskId), recordRole: 'qa-screenshot', kind: 'link', title: 'Library, phone, after', spec: { href: 'data:image/png;base64,iVBORw0KGgo=', url: 'data:image/png;base64,iVBORw0KGgo=', title: 'Library, phone, after', description: 'after the change', contentType: 'image/png' } }));

    expect(res.status).toBe(201);

    const { artifact } = await res.json() as { artifact: { id: number } };
    const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, artifact.id));

    expect(row).toMatchObject({ orgId: ORG, recordType: 'object', recordId: String(taskId), recordRole: 'qa-screenshot', url: 'data:image/png;base64,iVBORw0KGgo=' });
  });

  it('keeps a screenshot posted as a presigned link in Vocion, and answers with where it is served now', async () => {
    const png = await (await import('sharp')).default({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const dir = await mkdtemp(path.join(tmpdir(), 'vocion-route-'));
    process.env.VOCION_ARTIFACTS_DIR = dir;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })));
    const link = 'https://evidence.s3.us-west-2.amazonaws.example/qa/t1/9/library-phone-after.png?X-Amz-Date=20990101T000000Z&X-Amz-Expires=604800&X-Amz-Signature=abc';
    try {
      const res = await POST(post({ recordType: 'object', recordId: String(taskId), recordRole: 'qa-screenshot', kind: 'link', title: 'Library, phone, after', spec: { href: link, url: link, title: 'Library, phone, after', contentType: 'image/png' } }));

      expect(res.status).toBe(201);

      const { artifact } = await res.json() as { artifact: { id: number; url: string; sourceUrl: string; ingest: { status: string } } };

      expect(artifact.url.startsWith('/api/artifacts/org_artifacts_route-')).toBe(true);
      expect(artifact).toMatchObject({ sourceUrl: link, ingest: { status: 'stored' } });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.VOCION_ARTIFACTS_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a record in another workspace, and a body with no record', async () => {
    expect((await POST(post({ recordType: 'object', recordId: foreignId, kind: 'markdown', title: 'x', spec: { md: 'x' } }))).status).toBe(404);
    expect((await POST(post({ kind: 'markdown', title: 'x', spec: { md: 'x' } }))).status).toBe(400);
  });
});
