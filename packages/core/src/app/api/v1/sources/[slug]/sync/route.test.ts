/**
 * `POST /api/v1/sources/:slug/sync`, run this source now.
 *
 * The two answers that matter: **202** with the checkpoint as it stands (the
 * sync itself goes to Temporal, because a crawl takes minutes) and **409** when
 * a run already holds the source. There is no window arithmetic here on
 * purpose, the checkpoint reader reports a dead run as `abandoned` itself, so
 * a crashed sync can never make a source permanently unsyncable.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/SourceScheduleService', () => ({
  ensureSourceSchedule: vi.fn(),
  removeSourceSchedule: vi.fn(),
  ensureSourceReconcileSchedule: vi.fn(),
  removeSourceReconcileSchedule: vi.fn(),
  startSourceFullSync: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { startSourceFullSync } = await import('@/services/SourceScheduleService');
const { POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_sources_sync_route';
const SLUG = 'veerio-higher-ground';

function tokenPrincipal(orgId: string, grants: string[] = ['*']) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants.includes('*') ? 'owner' as const : 'specialist' as const, scope: { orgId }, grants },
  };
}

function requestFor(slug: string): Request {
  return new Request(`https://vocion.test/api/v1/sources/${slug}/sync`, {
    method: 'POST',
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

function paramsFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

async function makeSource(slug = SLUG, orgId = ORG): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId, slug, kind: 'plugin', configJson: { urls: ['https://highergroundmusic.com/'], _connector: 'web' } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function cleanUp(): Promise<void> {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await cleanUp();
});

afterAll(cleanUp);

describe('POST /api/v1/sources/:slug/sync', () => {
  it('rejects a request with no credential at all', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await POST(new Request(`https://vocion.test/api/v1/sources/${SLUG}/sync`, { method: 'POST' }), paramsFor(SLUG));

    expect(res.status).toBe(401);
  });

  it('403s a token that does not hold manage_sources', async () => {
    await makeSource();
    mockBearer.mockResolvedValue(tokenPrincipal(ORG, ['draft']) as never);

    const res = await POST(requestFor(SLUG), paramsFor(SLUG));

    expect(res.status).toBe(403);
    expect(startSourceFullSync).not.toHaveBeenCalled();
  });

  it('404s a slug this org does not have', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(requestFor('no-such-source'), paramsFor('no-such-source'));

    expect(res.status).toBe(404);
  });

  it('202s a never-synced source with run: null and starts the workflow', async () => {
    const sourceId = await makeSource();
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(requestFor(SLUG), paramsFor(SLUG));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ run: null });
    expect(startSourceFullSync).toHaveBeenCalledWith({ orgId: ORG, sourceId, sourceSlug: SLUG });
  });

  it('202s with the last completed run when there is one', async () => {
    const sourceId = await makeSource();
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId,
      status: 'completed',
      startedAt: new Date('2026-09-14T06:00:00.000Z'),
      completedAt: new Date('2026-09-14T06:04:00.000Z'),
      counts: { created: 3 },
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(requestFor(SLUG), paramsFor(SLUG));
    const body = await res.json() as { run: { status: string; counts: Record<string, number> } };

    expect(res.status).toBe(202);
    expect(body.run).toMatchObject({ status: 'completed', counts: { created: 3 } });
    expect(startSourceFullSync).toHaveBeenCalledOnce();
  });

  it('409s while a run holds the source, and starts nothing', async () => {
    const sourceId = await makeSource();
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId,
      status: 'running',
      // Inside the takeover window, so the reader still calls it `running`.
      startedAt: new Date(),
      counts: {},
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(requestFor(SLUG), paramsFor(SLUG));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(startSourceFullSync).not.toHaveBeenCalled();
  });

  it('202s over a run abandoned past the takeover window, so a dead sync never locks a source', async () => {
    const sourceId = await makeSource();
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId,
      status: 'running',
      // Well past ABANDONED_SYNC_AFTER_MS (30 min): the reader reports this as
      // `abandoned`, so the route sees no live run and this test needs no
      // window arithmetic of its own either.
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      counts: {},
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(requestFor(SLUG), paramsFor(SLUG));
    const body = await res.json() as { run: { status: string } };

    expect(res.status).toBe(202);
    expect(body.run.status).toBe('abandoned');
    expect(startSourceFullSync).toHaveBeenCalledOnce();
  });
});
