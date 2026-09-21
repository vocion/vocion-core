/**
 * `POST /api/v1/asks` + `GET /api/v1/asks` — the contract an external filer
 * (the workforce's approval-queue sync) builds against. Upsert semantics on
 * `sourceRef`, option normalisation, and tenant scoping are what matter here;
 * the service tests cover the rest.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { askSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET, POST } = await import('./route');
const { POST: DECIDE } = await import('./[id]/decide/route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_asks_route';
const OTHER_ORG = 'org_asks_route_other';

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://vocion.test${path}`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(query = ''): Request {
  return new Request(`https://vocion.test/api/v1/asks${query}`, { headers: { authorization: 'Bearer vcn_live_fake_token' } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(askSchema);
});

afterAll(async () => {
  await db.delete(askSchema);
});

describe('POST /api/v1/asks', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x' }))).status).toBe(401);
  });

  it('validates kind, title, risk, options and timestamps', async () => {
    expect((await POST(post('/api/v1/asks', { kind: 'nope', title: 'x' }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling' }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', risk: 'extreme' }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', options: [{ label: 'a', recommended: true }, { label: 'b', recommended: true }] }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', dueAt: 'yesterday-ish' }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', objectRefs: [{ type: 'request' }] }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', objectRefs: 'request:12' }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', decisionCost: 'five' }))).status).toBe(400);
    expect((await POST(post('/api/v1/asks', { kind: 'ruling', title: 'x', decisionCost: 2.5 }))).status).toBe(400);
  });

  it('files a new ask as 201, normalises options, and re-files the same sourceRef as 200 without touching status', async () => {
    const created = await POST(post('/api/v1/asks', {
      kind: 'ruling',
      title: 'Slack app granularity?',
      body: 'Short why.',
      sourceRef: 'workforce:approvals/032-slack-app-granularity',
      agentSlug: 'ceo',
      teamSlug: 'executive',
      risk: 'medium',
      groupKey: 'workforce:close-out',
      groupTitle: 'Close-out decisions',
      url: 'https://github.com/vocion/vocion-workforce/blob/main/company/approvals/pending/032.md',
      contextMd: '## Details\nlong form',
      options: ['One app per workspace', { id: 'per-agent', label: 'One app per agent', description: 'd', recommended: true }],
      objectRefs: [{ type: 'request', id: 12 }, { type: 'release', id: 'r-4' }],
      decisionCost: 5,
      notifyAt: '2026-09-15T12:00:00Z',
    }));

    expect(created.status).toBe(201);

    const { ask, created: flag } = await created.json();

    expect(flag).toBe(true);
    expect(ask).toMatchObject({
      orgId: ORG,
      status: 'open',
      createdBy: 'token:t1',
      contextUrl: 'https://github.com/vocion/vocion-workforce/blob/main/company/approvals/pending/032.md',
      contextMd: '## Details\nlong form',
      groupKey: 'workforce:close-out',
      options: [
        { id: 'one-app-per-workspace', label: 'One app per workspace' },
        { id: 'per-agent', label: 'One app per agent', description: 'd', recommended: true },
      ],
      // Ids are kept as strings whatever the caller sent.
      objectRefs: [{ type: 'request', id: '12' }, { type: 'release', id: 'r-4' }],
      decisionCost: 5,
    });
    expect(new Date(ask.notifyAt).toISOString()).toBe('2026-09-15T12:00:00.000Z');

    // Decide it, then re-file: fields update, status stays.
    const decided = await DECIDE(post(`/api/v1/asks/${ask.id}/decide`, { decision: 'per-agent' }), { params: Promise.resolve({ id: String(ask.id) }) });

    expect(decided.status).toBe(200);

    const again = await POST(post('/api/v1/asks', { kind: 'ruling', title: 'Slack app granularity? (updated)', sourceRef: 'workforce:approvals/032-slack-app-granularity' }));

    expect(again.status).toBe(200);

    const body = await again.json();

    expect(body.created).toBe(false);
    expect(body.ask).toMatchObject({ id: ask.id, title: 'Slack app granularity? (updated)', status: 'done', decision: 'per-agent' });
  });

  it('re-files with only { kind, title, sourceRef } without wiping what was filed before, and clears a field only on an explicit null', async () => {
    const first = await (await POST(post('/api/v1/asks', {
      kind: 'approval',
      title: 'Publish the Show HN post',
      body: 'Two links to re-check after #33 merges.',
      sourceRef: 'workforce:approvals/014-show-hn-post',
      agentSlug: 'distribution',
      teamSlug: 'distribution',
      risk: 'low',
      options: ['Post Tue 8am ET', 'Hold'],
      contextUrl: 'https://example.test/014.md',
      dueAt: '2026-09-16T12:00:00Z',
    }))).json();

    const again = await (await POST(post('/api/v1/asks', { kind: 'approval', title: 'Publish the Show HN post (links verified)', sourceRef: 'workforce:approvals/014-show-hn-post' }))).json();

    expect(again.created).toBe(false);
    expect(again.ask).toMatchObject({
      id: first.ask.id,
      title: 'Publish the Show HN post (links verified)',
      body: 'Two links to re-check after #33 merges.',
      agentSlug: 'distribution',
      teamSlug: 'distribution',
      risk: 'low',
      contextUrl: 'https://example.test/014.md',
      options: [{ id: 'post-tue-8am-et', label: 'Post Tue 8am ET' }, { id: 'hold', label: 'Hold' }],
    });
    expect(again.ask.dueAt).toBe(first.ask.dueAt);

    const cleared = await (await POST(post('/api/v1/asks', { kind: 'approval', title: 'x', sourceRef: 'workforce:approvals/014-show-hn-post', body: null, risk: null, options: [], dueAt: null }))).json();

    expect(cleared.ask).toMatchObject({ body: null, risk: null, options: [], dueAt: null, agentSlug: 'distribution' });
  });
});

describe('GET /api/v1/asks', () => {
  it('lists open by default, decided on request, prefix-filters by source, and never crosses orgs', async () => {
    await POST(post('/api/v1/asks', { kind: 'merge', title: 'Merge #33', sourceRef: 'workforce:pr/33' }));
    const r2 = await (await POST(post('/api/v1/asks', { kind: 'merge', title: 'Merge #35', sourceRef: 'workforce:pr/35' }))).json();
    await POST(post('/api/v1/asks', { kind: 'input', title: 'Key', sourceRef: 'other:1' }));
    await DECIDE(post(`/api/v1/asks/${r2.ask.id}/decide`, { decision: 'approve', note: 'squash' }), { params: Promise.resolve({ id: String(r2.ask.id) }) });

    expect((await (await GET(get())).json()).total).toBe(2);
    expect((await (await GET(get('?status=decided'))).json()).items).toMatchObject([{ id: r2.ask.id, decision: 'approve', decisionNote: 'squash' }]);
    expect((await (await GET(get('?status=all&source=workforce:'))).json()).total).toBe(2);
    expect((await GET(get('?status=bogus'))).status).toBe(400);

    mockBearer.mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    expect((await (await GET(get('?status=all'))).json()).total).toBe(0);
  });
});

describe('POST /api/v1/asks/:id/decide', () => {
  it('404s a missing or foreign id, 400s a bad id or missing decision, 409s a second decision', async () => {
    const { ask } = await (await POST(post('/api/v1/asks', { kind: 'gate', title: 'Resume the run?', options: ['Resume', 'Stay paused'] }))).json();
    const params = (id: string) => ({ params: Promise.resolve({ id }) });

    expect((await DECIDE(post('/api/v1/asks/abc/decide', { decision: 'approve' }), params('abc'))).status).toBe(400);
    expect((await DECIDE(post(`/api/v1/asks/${ask.id}/decide`, {}), params(String(ask.id)))).status).toBe(400);
    expect((await DECIDE(post(`/api/v1/asks/${ask.id}/decide`, { decision: 'other' }), params(String(ask.id)))).status).toBe(400);
    expect((await DECIDE(post('/api/v1/asks/999999/decide', { decision: 'approve' }), params('999999'))).status).toBe(404);

    mockBearer.mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    expect((await DECIDE(post(`/api/v1/asks/${ask.id}/decide`, { decision: 'approve' }), params(String(ask.id)))).status).toBe(404);

    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
    const ok = await DECIDE(post(`/api/v1/asks/${ask.id}/decide`, { decision: 'resume' }), params(String(ask.id)));

    expect(ok.status).toBe(200);
    expect((await ok.json()).ask).toMatchObject({ status: 'done', decision: 'resume' });
    expect((await DECIDE(post(`/api/v1/asks/${ask.id}/decide`, { decision: 'approve' }), params(String(ask.id)))).status).toBe(409);
  });
});
