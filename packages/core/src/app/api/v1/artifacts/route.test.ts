/**
 * `POST /api/v1/artifacts` — the route the factory worker posts its QA
 * evidence to. A screenshot lands on the record with its picture drawable, a
 * record in another workspace is refused, and a bad body says what is wrong.
 * Every id and name below is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
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

  it('refuses a record in another workspace, and a body with no record', async () => {
    expect((await POST(post({ recordType: 'object', recordId: foreignId, kind: 'markdown', title: 'x', spec: { md: 'x' } }))).status).toBe(404);
    expect((await POST(post({ kind: 'markdown', title: 'x', spec: { md: 'x' } }))).status).toBe(400);
  });
});
