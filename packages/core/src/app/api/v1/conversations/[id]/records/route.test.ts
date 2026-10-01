/**
 * `GET /api/v1/conversations/:id/records` — the records a thread is about,
 * with the same token and session auth as the rest of `/api/v1`. Another
 * workspace's thread is 404. Fixtures are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/objects/recordHref', () => ({
  recordLinksForOrg: async () => ({ pages: new Map([['request', '/dashboard/p/feature/{id}']]), workspaceSlug: null, reports: new Set(['request']) }),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);
const ORG = 'org_conversation_records_route';

function token(orgId: string) {
  return { orgId, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] } };
}

function call(id: number | string, bearer = true) {
  return GET(new Request(`https://vocion.test/api/v1/conversations/${id}/records`, bearer ? { headers: { authorization: 'Bearer vcn_live_fake_token' } } : {}), { params: Promise.resolve({ id: String(id) }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
});

describe('GET /api/v1/conversations/:id/records', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    expect((await call(1, false)).status).toBe(401);
  });

  it('404s a thread in another workspace', async () => {
    const [conv] = await db.insert(conversationSchema).values({ orgId: 'org_elsewhere_records', agentSlug: 'product-manager', title: 'x', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });
    mockBearer.mockResolvedValue(token(ORG) as never);

    expect((await call(conv!.id)).status).toBe(404);
  });

  it('returns the records the thread filed', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [conv] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'product-manager', title: 'Fix the header', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });
    const [rec] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Fix the header overflow', metadata: {} } as never).returning({ id: businessObjectSchema.id });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.create', status: 'done', input: {}, result: { objectId: rec!.id }, proposal: { origin: { conversationId: conv!.id } } } as never);
    mockBearer.mockResolvedValue(token(ORG) as never);

    const res = await call(conv!.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ records: [{ id: rec!.id, code: `REQ-${rec!.id}`, title: 'Fix the header overflow', href: `/dashboard/p/feature/${rec!.id}`, filed: true, change: null, hasStatus: true }] });
  });
});
