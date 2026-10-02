/**
 * `GET /api/v1/objects/:id/status` — You, Now, Next for a record whose type
 * has a report page. Same token and session auth as the rest of `/api/v1`;
 * another org's record and a missing one both 404, and a record whose type
 * has no report page says so. Fixtures are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
// Which types have a report page is the workspace's word (its page
// manifests); here the workspace has one for `request` only.
vi.mock('@/services/objects/recordHref', () => ({
  recordLinksForOrg: async () => ({ pages: new Map([['request', '/dashboard/p/feature/{id}']]), workspaceSlug: null, reports: new Set(['request']) }),
  recordLinkerForOrg: async () => (ref: { id: string | number }) => `/dashboard/p/feature/${ref.id}`,
}));

const { db } = await import('@/libs/DB');
const { automationRunSchema, businessObjectSchema, businessObjectTypeSchema, missionRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_object_status_route';
const OTHER_ORG = 'org_object_status_route_other';

function tokenPrincipal(orgId: string) {
  return { orgId, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] } };
}

function requestFor(id: string | number, bearer = true): Request {
  return new Request(`https://vocion.test/api/v1/objects/${id}/status`, bearer ? { headers: { authorization: 'Bearer vcn_live_fake_token' } } : {});
}

function paramsFor(id: string | number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function makeRecord(orgId: string, slug: string, meta: Record<string, unknown> = {}): Promise<number> {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId, slug, label: slug, schema: { type: 'object', properties: {} } } as never).onConflictDoNothing().returning({ id: businessObjectTypeSchema.id });
  const typeId = type?.id ?? (await db.query.businessObjectTypeSchema.findFirst({ where: (t, { and, eq }) => and(eq(t.orgId, orgId), eq(t.slug, slug)) }))!.id;
  const [row] = await db.insert(businessObjectSchema).values({ orgId, typeId, title: 'Fix the header overflow on the Northwind portal', metadata: meta } as never).returning({ id: businessObjectSchema.id });
  return row!.id;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
});

describe('GET /api/v1/objects/:id/status', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await GET(requestFor(1, false), paramsFor(1));

    expect(res.status).toBe(401);
  });

  it('404s a record belonging to another org', async () => {
    const id = await makeRecord(OTHER_ORG, 'request');
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor(id), paramsFor(id));

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('says a record whose type has no report page has no status to read', async () => {
    const id = await makeRecord(ORG, 'product');
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor(id), paramsFor(id));

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NO_REPORT_PAGE');
  });

  it('returns the three lines, with the run writing the plan as the live line', async () => {
    const id = await makeRecord(ORG, 'request', { state: 'building', recovery: { stage: 'planning', line: 'Planning — the change spans two packages' } });
    const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Plan it', brief: 'plan', status: 'running', team: { lead: 'product-manager', members: [] } } as never).returning({ id: missionRunSchema.id });
    await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'any-planning-automation', kind: 'mission_check', status: 'running', input: { requestId: id }, targetRunId: run!.id } as never);
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(requestFor(id), paramsFor(id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      record: { id, objectType: 'request', href: `/dashboard/p/feature/${id}` },
      stage: { key: 'planning', label: 'Planning' },
      you: { needsYou: false, line: 'Nothing needs you', move: null },
      live: { kind: 'planning', label: 'Writing the plan', runHref: `/dashboard/p/runs/agent-${run!.id}` },
      next: 'The build starts when the plan is approved.',
    });
  });
});
