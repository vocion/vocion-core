/**
 * What the Sources page reads on load.
 *
 * The GET stitches four separate lookups onto each row — the connector's auth
 * requirement, whether a credential is stored, the document count and the
 * latest sync run — and the page's behaviour depends on all four: a missing
 * `sync` is why a run started in another tab used to be invisible, and
 * `credentialConnected` decides whether the row offers Connect or Edit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/sources/registry', () => ({ listConnectors: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({ credentialStatusForOrg: vi.fn() }));
vi.mock('@/services/SourceSyncService', () => ({
  addSource: vi.fn(),
  documentCountsForOrg: vi.fn(),
  latestSyncStateForOrg: vi.fn(),
  listSources: vi.fn(),
}));

const { clerkAuth } = await import('@/libs/Auth');
const { listConnectors } = await import('@/libs/sources/registry');
const { credentialStatusForOrg } = await import('@/services/SourceCredentialService');
const { documentCountsForOrg, latestSyncStateForOrg, listSources } = await import('@/services/SourceSyncService');
const { GET } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  has: () => true,
};

const startedAt = new Date('2026-08-31T18:52:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
  vi.mocked(listConnectors).mockReturnValue([
    { slug: 'strapi', name: 'Strapi', description: 'Strapi CMS', icon: 'Database', authKind: 'apikey' },
    { slug: 'web', name: 'Web', description: 'Crawl a site', icon: 'Globe', authKind: 'none' },
  ] as never);
  vi.mocked(listSources).mockResolvedValue([
    {
      id: 1,
      slug: 'kb-strapi',
      kind: 'strapi',
      config: { _connector: 'strapi', baseUrl: 'https://cms.example' },
      lastSyncedAt: null,
      enabled: 'true',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  ]);
  vi.mocked(credentialStatusForOrg).mockResolvedValue({
    strapi: { connected: true, updatedAt: new Date('2026-08-02T00:00:00.000Z') },
  } as never);
  vi.mocked(documentCountsForOrg).mockResolvedValue({ 1: 43 });
  vi.mocked(latestSyncStateForOrg).mockResolvedValue({
    1: { status: 'running', startedAt, completedAt: null, error: null, counts: {} },
  });
});

describe('GET /rpc/sources', () => {
  it('reports the latest sync run on the row, so a run from elsewhere is visible', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sources[0].sync).toMatchObject({ status: 'running', startedAt: startedAt.toISOString() });
  });

  it('says null rather than omitting sync for a source that never ran', async () => {
    vi.mocked(latestSyncStateForOrg).mockResolvedValue({});

    const body = await (await GET()).json();

    expect(body.sources[0].sync).toBeNull();
  });

  it('decorates the row with its connector, credential and document count', async () => {
    const body = await (await GET()).json();

    expect(body.sources[0]).toMatchObject({
      authKind: 'apikey',
      credentialConnected: true,
      documentCount: 43,
    });
  });

  it('counts a connector that needs no credential as connected', async () => {
    vi.mocked(listSources).mockResolvedValue([
      {
        id: 2,
        slug: 'kb-web',
        kind: 'web',
        config: { _connector: 'web' },
        lastSyncedAt: null,
        enabled: 'true',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
    vi.mocked(credentialStatusForOrg).mockResolvedValue({} as never);

    const body = await (await GET()).json();

    expect(body.sources[0]).toMatchObject({ authKind: 'none', credentialConnected: true });
  });

  it('reports a credential-needing source with nothing stored as not connected', async () => {
    vi.mocked(credentialStatusForOrg).mockResolvedValue({} as never);

    const body = await (await GET()).json();

    expect(body.sources[0]).toMatchObject({ credentialConnected: false, credentialUpdatedAt: null });
  });

  it('reports a source with no ingested documents as zero, not undefined', async () => {
    vi.mocked(documentCountsForOrg).mockResolvedValue({});

    const body = await (await GET()).json();

    expect(body.sources[0].documentCount).toBe(0);
  });

  it('offers the picker tiles alongside the rows', async () => {
    const body = await (await GET()).json();

    expect(body.connectors).toEqual([
      { slug: 'strapi', name: 'Strapi', description: 'Strapi CMS', icon: 'Database', authKind: 'apikey', supportsBulkImport: false },
      { slug: 'web', name: 'Web', description: 'Crawl a site', icon: 'Globe', authKind: 'none', supportsBulkImport: false },
    ]);
  });

  it('tells the page which connectors accept a CSV import', async () => {
    vi.mocked(listConnectors).mockReturnValue([
      { slug: 'web', name: 'Web', description: 'Crawl a site', icon: 'Globe', authKind: 'none', bulkImport: { columns: [], identityColumns: ['url'] } },
      { slug: 'strapi', name: 'Strapi', description: 'Strapi CMS', icon: 'Database', authKind: 'apikey' },
    ] as never);

    const body = await (await GET()).json();

    expect(body.connectors.map((tile: { slug: string; supportsBulkImport: boolean }) => [tile.slug, tile.supportsBulkImport]))
      .toEqual([['web', true], ['strapi', false]]);
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listSources).not.toHaveBeenCalled();
  });
});
