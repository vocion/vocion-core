/**
 * `POST /api/v1/objects` — the write path a deploy script or a worker uses to
 * record an object instance (a `release`, its verification) without a
 * dashboard. What matters here is the upsert on the external key, tenant
 * scoping, and that the endpoint never invents a type.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { GET, POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_objects_route';
const OTHER_ORG = 'org_objects_route_other';

function tokenPrincipal(orgId: string, grants: string[] = ['*']) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants },
  };
}

function post(body: unknown): Request {
  return new Request('https://vocion.test/api/v1/objects', {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const release = (over: Record<string, unknown> = {}) => ({
  type: 'release',
  title: 'northwind-web v1.4.2',
  metadata: { product: 'northwind-web', version: 'v1.4.2', commitSha: 'abc123' },
  externalKey: { system: 'deploy', id: 'northwind-web@v1.4.2' },
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await createObjectType({ slug: 'release', label: 'Release' }, ORG);
});

afterAll(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('POST /api/v1/objects', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    expect((await POST(post(release()))).status).toBe(401);
  });

  it('validates the body and refuses a type that is not registered', async () => {
    expect((await POST(post({ type: 'release' }))).status).toBe(400);
    expect((await POST(post(release({ externalKey: { system: 'deploy' } })))).status).toBe(400);
    expect((await POST(post(release({ type: 'nope' })))).status).toBe(404);
  });

  it('creates on the first write and updates in place on the second, merging metadata', async () => {
    const first = await POST(post(release()));
    const second = await POST(post(release({ title: 'northwind-web v1.4.2 (verified)', metadata: { healthAfter: 'ok' } })));

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);

    const rows = await db.select().from(businessObjectSchema);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: ORG, title: 'northwind-web v1.4.2 (verified)', externalSystem: 'deploy', externalId: 'northwind-web@v1.4.2' });
    // The second call added what it learned without resending the rest.
    expect(rows[0]?.metadata).toEqual({ product: 'northwind-web', version: 'v1.4.2', commitSha: 'abc123', healthAfter: 'ok' });
  });

  it('without an external key every write is a new object', async () => {
    await POST(post(release({ externalKey: undefined })));
    await POST(post(release({ externalKey: undefined })));

    expect(await db.select().from(businessObjectSchema)).toHaveLength(2);
  });

  it('scopes the key to the tenant, and the read back is scoped the same way', async () => {
    await POST(post(release()));
    mockBearer.mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    // The other org has no `release` type, so it cannot even name one…
    expect((await POST(post(release()))).status).toBe(404);

    // …and reads nothing of the first org's.
    const list = await GET(new Request('https://vocion.test/api/v1/objects?type=release', { headers: { authorization: 'Bearer vcn_live_fake_token' } }));

    expect(((await list.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('refuses a token without the capability', async () => {
    mockBearer.mockResolvedValue({ ...tokenPrincipal(ORG, ['manage_sources']), principal: { ...tokenPrincipal(ORG, ['manage_sources']).principal, role: 'viewer' } } as never);

    expect((await POST(post(release()))).status).toBe(403);
  });
});
