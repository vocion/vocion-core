import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { GET, POST } = await import('./route');
const org = 'workforce-api-test';
function session(role: 'admin' | 'member') {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'reviewer', orgId: org, role, workspaceRole: role, has: () => role === 'admin' } as never);
}
function request(body?: unknown, bearer = false) {
  return new Request('https://vocion.test/api/v1/workforce', { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer synthetic-test' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const command = { kind: 'create', key: 'api-item', eventKey: 'api-create', title: 'Synthetic fixture', workflow: 'scheduled', agentSlug: 'specialist', rubric: 'Contains required fields', configurationVersion: 'fixture-v1', test: true };

beforeAll(async () => {
  await db.insert(agentSchema).values({ orgId: org, slug: 'specialist', name: 'Synthetic specialist', systemPrompt: 'Synthetic fixture' });
});

beforeEach(() => {
  vi.clearAllMocks();
  session('admin');
});

describe('workforce API security and persistence', () => {
  it('rejects unauthenticated and member requests', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ userId: null } as never);

    expect((await GET(request())).status).toBe(401);

    session('member');

    expect((await GET(request())).status).toBe(403);
    expect((await POST(request(command))).status).toBe(403);
  });

  it('does not fall back to a valid session for invalid bearer credentials', async () => {
    vi.mocked(authenticateBearer).mockResolvedValue(null);

    expect((await POST(request(command, true))).status).toBe(401);
  });

  it('rejects forged org fields and malformed input', async () => {
    expect((await POST(request({ ...command, orgId: 'foreign' }))).status).toBe(400);
    expect((await POST(request({ ...command, baselineMinutes: -1 }))).status).toBe(400);
    expect((await GET(new Request('https://vocion.test/api/v1/workforce?days=999'))).status).toBe(400);
  });

  it('registers, reviews, and exports durable evidence; excludes tests from default totals', async () => {
    const created = await POST(request(command));

    expect(created.status).toBe(200);

    const { itemId } = await created.json();
    const review = { kind: 'review', itemId, eventKey: 'api-review', version: 0, status: 'accepted', reason: 'meets-rubric', evidence: 'Fixture checked', effortMinutes: 2 };

    expect((await POST(request(review))).status).toBe(200);
    expect((await POST(request(review))).status).toBe(200);

    const normal = await (await GET(request())).json();

    expect(normal.items).toHaveLength(0);

    const exported = await (await GET(new Request('https://vocion.test/api/v1/workforce?test=true'))).json();

    expect(exported.items[0].events).toHaveLength(2);
    expect(exported.items[0].activeEffortMinutes).toBe(2);
    expect(JSON.stringify(exported)).not.toContain('commandHash');

    vi.mocked(authenticateBearer).mockResolvedValue({ orgId: org, tokenId: 'test', principal: { kind: 'user', id: 'token:test', role: 'admin', scope: { orgId: org }, grants: ['*'] } } as never);

    expect((await POST(request({ ...review, eventKey: 'automated-review' }, true))).status).toBe(403);
  });
});
