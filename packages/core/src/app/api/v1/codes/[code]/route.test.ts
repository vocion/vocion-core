/**
 * `GET /api/v1/codes/:code` — what a typed code names and where it opens,
 * what ⌘K reads. Any case; a code whose prefix is not the record's type is a
 * 404 that says what the record's code is. Fixtures are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/objects/recordHref', () => ({
  recordLinksForOrg: async () => ({ pages: new Map(), workspaceSlug: 'northwind' }),
  recordHref: async (_org: string, ref: { id: number }) => `/w/northwind/dashboard/p/feature/${ref.id}`,
}));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET } = await import('./route');

const ORG = 'org_codes_route';
const mockBearer = vi.mocked(authenticateBearer);

function call(code: string) {
  return GET(new Request(`https://vocion.test/api/v1/codes/${code}`, { headers: { authorization: 'Bearer vcn_live_fake_token' } }), { params: Promise.resolve({ code }) });
}

beforeEach(() => {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  mockBearer.mockResolvedValue({ orgId: ORG, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId: ORG }, grants: ['*'] } } as never);
});

describe('GET /api/v1/codes/:code', () => {
  it('opens a record by its code, any case, and a run by RUN-', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { 'x-code': 'FE' } }).returning();
    const [rec] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Export an invoice as a PDF' }).returning();
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'task-engineer' }).returning();

    const res = await call(`fe-${rec!.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: `FE-${rec!.id}`, kind: 'record', id: rec!.id, title: 'Export an invoice as a PDF', href: `/w/northwind/dashboard/p/feature/${rec!.id}` });
    expect(await (await call(`RUN-${run!.id}`)).json()).toEqual({ code: `RUN-${run!.id}`, kind: 'run', id: run!.id, href: `/w/northwind/dashboard/p/runs/${run!.id}` });

    const wrong = await call(`PL-${rec!.id}`);

    expect(wrong.status).toBe(404);
    expect(JSON.stringify(await wrong.json())).toContain(`is FE-${rec!.id}`);
  });
});
