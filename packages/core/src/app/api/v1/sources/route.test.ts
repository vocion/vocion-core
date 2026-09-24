/**
 * `GET|POST /api/v1/sources`, the source registry over HTTP.
 *
 * Two things are being pinned here beyond the usual auth shape. First, the GET
 * body is what a tenant's own reporting reads instead of the database, so
 * `enabled` is a real boolean (the column is TEXT) and a source that has never
 * run answers `run: null` rather than being omitted. Second, the POST is an
 * upsert that REPLACES the stored config, the find-or-create path would answer
 * 200 to a changed source and store nothing, which is the bug this route exists
 * not to have.
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
const { agentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { ensureSourceSchedule, ensureSourceReconcileSchedule, removeSourceSchedule } = await import('@/services/SourceScheduleService');
const { eq } = await import('drizzle-orm');
const { GET, POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_sources_route';
const AGENT = 'event-ingestion-lead';

/**
 * A token principal holding `manage_sources` (owners hold every capability).
 * @param orgId - Org the token belongs to.
 * @param grants - The token's grants; anything but `*` is refused this capability.
 */
function tokenPrincipal(orgId: string, grants: string[] = ['*']) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants.includes('*') ? 'owner' as const : 'specialist' as const, scope: { orgId }, grants },
  };
}

function getRequest(): Request {
  return new Request('https://vocion.test/api/v1/sources', {
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

function postRequest(body: unknown): Request {
  return new Request('https://vocion.test/api/v1/sources', {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * A config the candidate-extractor accepts.
 * @param overrides - Fields to add or replace for one test.
 */
function extractorConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objectType: 'event-candidate',
    agentSlug: AGENT,
    dedupOn: ['title', 'startDate', 'venueName'],
    titleFrom: 'title',
    promptFragment: 'Only list events open to the public.',
    ...overrides,
  };
}

async function storedConfig(slug: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.slug, slug));
  return row!.configJson;
}

async function cleanUp(): Promise<void> {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(agentSchema);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await cleanUp();
});

afterAll(cleanUp);

describe('GET /api/v1/sources', () => {
  it('rejects a request with no credential at all', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await GET(new Request('https://vocion.test/api/v1/sources'));

    expect(res.status).toBe(401);
  });

  it('403s a token that does not hold manage_sources', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG, ['draft']) as never);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('reports enabled as a boolean and a never-synced source as run: null', async () => {
    await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'larkfield-bellwater-hall',
      kind: 'plugin',
      // `enabled` is a TEXT column: a JSON client must not have to know that.
      enabled: 'true',
      configJson: { urls: ['https://bellwaterhall.example/calendar'], _connector: 'web', _name: 'Bellwater Hall' },
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await GET(getRequest());
    const body = await res.json() as { sources: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({
      slug: 'larkfield-bellwater-hall',
      name: 'Bellwater Hall',
      connector: 'web',
      enabled: true,
      lastSyncedAt: null,
      documentCount: 0,
      run: null,
    });
  });

  it('names a source after its slug when no name was supplied, and reports enabled: false', async () => {
    await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'larkfield-unnamed',
      kind: 'plugin',
      enabled: 'false',
      configJson: { urls: ['https://example.test/'], _connector: 'web' },
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(getRequest())).json() as { sources: Array<Record<string, unknown>> };

    expect(body.sources[0]).toMatchObject({ name: 'larkfield-unnamed', enabled: false });
  });

  it('carries the checkpoint, including since and the processor-scope failures', async () => {
    const [source] = await db.insert(knowledgeSourceSchema).values({
      orgId: ORG,
      slug: 'larkfield-corvina',
      kind: 'plugin',
      configJson: { urls: ['https://corvina.test/'], _connector: 'web' },
    }).returning({ id: knowledgeSourceSchema.id });
    const startedAt = new Date('2026-09-14T06:00:00.000Z');
    await db.insert(sourceSyncCheckpointSchema).values({
      orgId: ORG,
      sourceId: source!.id,
      status: 'completed',
      startedAt,
      completedAt: new Date('2026-09-14T06:04:00.000Z'),
      since: new Date('2026-09-13T06:00:00.000Z'),
      counts: { created: 3, errors: 0, processorErrors: 1 },
      failures: [{ scope: 'processor', message: 'extract_model_invalid', uri: 'https://corvina.test/e/1', at: '2026-09-14T06:03:00.000Z' }],
    });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const body = await (await GET(getRequest())).json() as { sources: Array<{ run: Record<string, unknown> }> };

    expect(body.sources[0]!.run).toEqual({
      status: 'completed',
      startedAt: startedAt.toISOString(),
      completedAt: '2026-09-14T06:04:00.000Z',
      since: '2026-09-13T06:00:00.000Z',
      counts: { created: 3, errors: 0, processorErrors: 1 },
      failures: [{ scope: 'processor', message: 'extract_model_invalid', uri: 'https://corvina.test/e/1' }],
    });
  });

  it('accepts a dashboard session with no bearer token', async () => {
    mockBearer.mockResolvedValue(null);
    mockSession.mockResolvedValue({ userId: 'u1', orgId: ORG, accountId: 'a1', projectId: ORG, role: 'admin', workspaceRole: 'owner' as const, has: () => true } as never);

    const res = await GET(new Request('https://vocion.test/api/v1/sources'));

    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/sources', () => {
  it('rejects a request with no credential at all', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await POST(new Request('https://vocion.test/api/v1/sources', { method: 'POST', body: '{}' }));

    expect(res.status).toBe(401);
  });

  it('403s a token that does not hold manage_sources', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG, ['draft']) as never);

    const res = await POST(postRequest({ slug: 'x', kind: 'web', config: { urls: ['https://x.test/'] } }));

    expect(res.status).toBe(403);
  });

  it('creates a source, ensures both schedules, and reports created: true', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({
      slug: 'larkfield-bellwater-hall',
      name: 'Bellwater Hall',
      kind: 'web',
      config: { urls: ['https://bellwaterhall.example/calendar'] },
      schedule: '0 6 * * *',
      reconcileSchedule: '0 3 * * 0',
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ source: { slug: 'larkfield-bellwater-hall', created: true } });
    expect(await storedConfig('larkfield-bellwater-hall')).toEqual({
      urls: ['https://bellwaterhall.example/calendar'],
      _connector: 'web',
      _name: 'Bellwater Hall',
    });
    expect(ensureSourceSchedule).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, sourceSlug: 'larkfield-bellwater-hall', cron: '0 6 * * *' }));
    expect(ensureSourceReconcileSchedule).toHaveBeenCalledWith(expect.objectContaining({ cron: '0 3 * * 0' }));
  });

  it('REPLACES the config of an existing slug and reports created: false', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
    await POST(postRequest({
      slug: 'larkfield-bellwater-hall',
      name: 'Bellwater Hall',
      kind: 'web',
      config: { urls: ['https://bellwaterhall.example/calendar'], feedUrl: 'https://bellwaterhall.example/feed.ics' },
    }));

    const res = await POST(postRequest({
      slug: 'larkfield-bellwater-hall',
      name: 'Bellwater Hall (Ballroom)',
      kind: 'web',
      config: { urls: ['https://bellwaterhall.example/events'] },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ source: { slug: 'larkfield-bellwater-hall', created: false } });
    // The old `feedUrl` is GONE: this writer is authoritative, so a key the
    // second call did not send must not survive it.
    expect(await storedConfig('larkfield-bellwater-hall')).toEqual({
      urls: ['https://bellwaterhall.example/events'],
      _connector: 'web',
      _name: 'Bellwater Hall (Ballroom)',
    });
  });

  it('stamps `_processor` when a processor is declared', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: AGENT, name: 'Event ingestion lead', systemPrompt: 'ingest' });
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({
      slug: 'larkfield-corvina',
      kind: 'web',
      config: { urls: ['https://corvina.test/'] },
      processor: { slug: 'candidate-extractor', config: extractorConfig() },
    }));

    expect(res.status).toBe(200);
    expect(await storedConfig('larkfield-corvina')).toMatchObject({
      _processor: { slug: 'candidate-extractor', config: extractorConfig() },
    });
  });

  it('400s an unknown processor slug, naming the registered ones', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({
      slug: 'larkfield-corvina',
      kind: 'web',
      config: { urls: ['https://corvina.test/'] },
      processor: { slug: 'no-such-processor', config: {} },
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('candidate-extractor');
    // Nothing stored: a refused upsert must not leave half a source behind.
    expect(await db.select().from(knowledgeSourceSchema)).toHaveLength(0);
  });

  it('400s a processor naming an agent this org does not have', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({
      slug: 'larkfield-corvina',
      kind: 'web',
      config: { urls: ['https://corvina.test/'] },
      processor: { slug: 'candidate-extractor', config: extractorConfig() },
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain(AGENT);
  });

  it('400s a config the connector refuses', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({ slug: 'larkfield-empty', kind: 'web', config: {} }));

    expect(res.status).toBe(400);
  });

  it('400s an unknown connector kind', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({ slug: 'larkfield-x', kind: 'not-a-connector', config: {} }));

    expect(res.status).toBe(400);
  });

  it('removes the schedule of a source saved as disabled, the rollback path', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);

    const res = await POST(postRequest({
      slug: 'larkfield-bellwater-hall',
      kind: 'web',
      config: { urls: ['https://bellwaterhall.example/calendar'] },
      schedule: '0 6 * * *',
      enabled: false,
    }));

    expect(res.status).toBe(200);
    expect(ensureSourceSchedule).not.toHaveBeenCalled();
    expect(removeSourceSchedule).toHaveBeenCalledWith(ORG, 'larkfield-bellwater-hall');
  });
});
