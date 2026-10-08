/**
 * `GET /api/v1/access-log` — a workspace admin reads who read which record,
 * filtered, one workspace only. Against PGlite, with the bearer check and the
 * session stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));

const { db } = await import('@/libs/DB');
const { accessEventSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { flushAccessLog, recordAccess, resetAccessLogForTests } = await import('@/services/access/accessLog');
const { GET } = await import('./route');

const ORG = 'proj_accessapi_northwind';
const OTHER = 'proj_accessapi_kestrel';

function sessionAs(role: 'admin' | 'member', orgId = ORG) {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'usr-dana', orgId, role, workspaceRole: role, has: () => role === 'admin' } as never);
}

function get(query = '', bearer?: string): Request {
  return new Request(`https://vocion.test/api/v1/access-log${query}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
}

beforeEach(async () => {
  resetAccessLogForTests();
  vi.mocked(clerkAuth).mockReset();
  vi.mocked(authenticateBearer).mockReset();
  await db.delete(accessEventSchema);
  recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page', at: new Date('2026-10-06T10:00:00Z') });
  recordAccess({ orgId: ORG, actor: { kind: 'agent', agentSlug: 'revenue-lead', onBehalfOf: 'usr-rowan', run: { kind: 'conversation', id: 8 } }, action: 'view', record: { kind: 'object', id: 1 }, via: 'tool:read_object', at: new Date('2026-10-06T11:00:00Z') });
  recordAccess({ orgId: ORG, actor: { kind: 'token', tokenId: 'token:4' }, action: 'export', record: { kind: 'object', id: 2 }, via: 'api', at: new Date('2026-10-07T09:00:00Z') });
  recordAccess({ orgId: OTHER, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page', at: new Date('2026-10-06T10:00:00Z') });

  expect(await flushAccessLog()).toMatchObject({ written: 4, dropped: 0 });
});

describe('GET /api/v1/access-log', () => {
  it('lists this workspace\'s reads newest first, without the tenancy columns', async () => {
    sessionAs('admin');
    const res = await GET(get());
    const body = await res.json() as { events: Array<Record<string, unknown>>; hasMore: boolean; retentionDays: number | null };

    expect(res.status).toBe(200);
    expect(body.events.map(e => [e.actorKind, e.action])).toEqual([['token', 'export'], ['agent', 'view'], ['user', 'view']]);
    expect(body.events[1]).toMatchObject({ actorId: 'revenue-lead', onBehalfOf: 'usr-rowan', runKind: 'conversation', runId: '8', via: 'tool:read_object' });
    expect(body.events[0]).not.toHaveProperty('orgId');
    expect(body.events[0]).not.toHaveProperty('accountId');
    expect(body).toMatchObject({ hasMore: false, retentionDays: 365 });
  });

  it('answers who read one record, and what one reader read', async () => {
    sessionAs('admin');
    const record = await (await GET(get('?recordKind=object&recordId=1'))).json() as { events: Array<{ actorId: string }> };
    const reader = await (await GET(get('?actor=usr-rowan'))).json() as { events: Array<{ actorId: string }> };

    expect(record.events.map(e => e.actorId)).toEqual(['revenue-lead', 'usr-dana']);
    expect(reader.events.map(e => e.actorId)).toEqual(['revenue-lead']);
  });

  it('filters by action, kind of reader and time', async () => {
    sessionAs('admin');
    const exports = await (await GET(get('?action=export'))).json() as { events: unknown[] };
    const agents = await (await GET(get('?actorKind=agent'))).json() as { events: unknown[] };
    const since = await (await GET(get('?since=2026-10-07T00:00:00Z'))).json() as { events: unknown[] };

    expect(exports.events).toHaveLength(1);
    expect(agents.events).toHaveLength(1);
    expect(since.events).toHaveLength(1);
  });

  it('refuses a filter it cannot read, by name', async () => {
    sessionAs('admin');

    expect((await GET(get('?action=peek'))).status).toBe(400);
    expect((await GET(get('?actorKind=robot'))).status).toBe(400);
    expect((await GET(get('?since=yesterday'))).status).toBe(400);
  });

  it('is for workspace admins only', async () => {
    sessionAs('member');
    const res = await GET(get());

    expect(res.status).toBe(403);
  });

  it('a token reads its own workspace, never another', async () => {
    vi.mocked(authenticateBearer).mockResolvedValue({ orgId: OTHER, tokenId: 't9', principal: { kind: 'user', id: 'token:t9', role: 'admin', scope: { orgId: OTHER }, grants: [] } } as never);
    const body = await (await GET(get('', 'vcn_live_x_y'))).json() as { events: Array<{ recordId: string }> };

    expect(body.events).toHaveLength(1);
  });
});
