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
vi.mock('@/libs/connect/summary', () => ({ grantSummaryForSource: vi.fn(async () => null) }));
vi.mock('@/services/connect/newSourceSync', () => ({ startSourceSyncing: vi.fn() }));
vi.mock('@/services/SourceSyncService', () => ({
  addSource: vi.fn(),
  chunkCountsForOrg: vi.fn(async () => ({})),
  documentCountsForOrg: vi.fn(),
  latestSyncStateForOrg: vi.fn(),
  listSources: vi.fn(),
}));

const { clerkAuth } = await import('@/libs/Auth');
const { listConnectors } = await import('@/libs/sources/registry');
const { credentialStatusForOrg } = await import('@/services/SourceCredentialService');
const { grantSummaryForSource } = await import('@/libs/connect/summary');
const { startSourceSyncing } = await import('@/services/connect/newSourceSync');
const { addSource, documentCountsForOrg, latestSyncStateForOrg, listSources } = await import('@/services/SourceSyncService');
const { GET, POST } = await import('./route');

const signedIn = {
  userId: 'user_1',
  orgId: 'org_1',
  accountId: null,
  projectId: 'org_1',
  role: 'admin' as const,
  workspaceRole: 'admin' as const,
  has: () => true,
};

const startedAt = new Date('2026-08-31T18:52:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
  vi.mocked(listConnectors).mockReturnValue([
    { slug: 'strapi', name: 'Strapi', description: 'Strapi CMS', icon: 'Database', brand: 'strapi', authKind: 'apikey' },
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
    // Keyed by connector row id: a stored credential is named by one
    // connector, so two Strapi rows answer separately.
    bySourceId: { 1: { connected: true, updatedAt: '2026-08-02T00:00:00.000Z', broken: null } },
    byConnectorSlug: {},
  });
  vi.mocked(documentCountsForOrg).mockResolvedValue({ 1: 43 });
  vi.mocked(latestSyncStateForOrg).mockResolvedValue({
    1: { status: 'running', startedAt, completedAt: null, error: null, counts: {}, since: null, failures: [], skipped: [] },
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
    vi.mocked(credentialStatusForOrg).mockResolvedValue({ bySourceId: {}, byConnectorSlug: {} });

    const body = await (await GET()).json();

    expect(body.sources[0]).toMatchObject({ authKind: 'none', credentialConnected: true });
  });

  it('reports a credential-needing source with nothing stored as not connected', async () => {
    vi.mocked(credentialStatusForOrg).mockResolvedValue({ bySourceId: {}, byConnectorSlug: {} });

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
      // `credentialPlatform` is how the picker knows to offer the credentials
      // the workspace already holds instead of asking for the key again.
      // `syncless` + `inspectable` are what put Test connection on a row
      // where a syncing source shows Sync now. `brand` is the tile's logo,
      // null for a connector that is not one vendor.
      { slug: 'strapi', name: 'Strapi', description: 'Strapi CMS', icon: 'Database', brand: 'strapi', authKind: 'apikey', credentialPlatform: 'strapi', syncless: false, inspectable: false, requiredScopes: null },
      { slug: 'web', name: 'Web', description: 'Crawl a site', icon: 'Globe', brand: null, authKind: 'none', credentialPlatform: null, syncless: false, inspectable: false, requiredScopes: null },
    ]);
  });

  it('names the account a vendor grant is on, only for a connected row a vendor flow connects', async () => {
    vi.mocked(listConnectors).mockReturnValue([
      { slug: 'github', name: 'GitHub', description: 'Pull requests', icon: 'GitPullRequest', authKind: 'oauth' },
      { slug: 'strapi', name: 'Strapi', description: 'Strapi CMS', icon: 'Database', authKind: 'apikey' },
    ] as never);
    vi.mocked(listSources).mockResolvedValue([
      { id: 1, slug: 'github', kind: 'github', config: { repos: ['The-NocoCompany/warranty-app'] }, lastSyncedAt: null, enabled: 'true', createdAt: new Date('2026-09-30T00:00:00.000Z') },
      { id: 2, slug: 'kb-strapi', kind: 'strapi', config: { _connector: 'strapi' }, lastSyncedAt: null, enabled: 'true', createdAt: new Date('2026-08-01T00:00:00.000Z') },
      { id: 3, slug: 'github-later', kind: 'github', config: { repos: [] }, lastSyncedAt: null, enabled: 'true', createdAt: new Date('2026-09-30T00:00:00.000Z') },
    ]);
    vi.mocked(credentialStatusForOrg).mockResolvedValue({
      bySourceId: {
        1: { connected: true, updatedAt: '2026-09-30T21:17:00.000Z', broken: null },
        2: { connected: true, updatedAt: '2026-08-02T00:00:00.000Z', broken: null },
      },
      byConnectorSlug: {},
    });
    vi.mocked(documentCountsForOrg).mockResolvedValue({});
    vi.mocked(latestSyncStateForOrg).mockResolvedValue({});
    const summary = { account: 'The-NocoCompany (organization)', granted: { label: 'Repositories', items: ['The-NocoCompany/warranty-app'] } };
    vi.mocked(grantSummaryForSource).mockResolvedValue(summary);

    const body = await (await GET()).json();
    const bySlug = Object.fromEntries(body.sources.map((s: { slug: string }) => [s.slug, s]));

    expect(bySlug.github.grant).toEqual(summary);
    // A pasted-key connector and an unconnected row are never asked: nothing to decrypt.
    expect(bySlug['kb-strapi'].grant).toBeNull();
    expect(bySlug['github-later'].grant).toBeNull();
    expect(grantSummaryForSource).toHaveBeenCalledTimes(1);
    expect(grantSummaryForSource).toHaveBeenCalledWith({ orgId: 'org_1', sourceSlug: 'github', connectorSlug: 'github' });
  });

  it('refuses a caller with no workspace', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: null });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listSources).not.toHaveBeenCalled();
  });
});

describe('POST /rpc/sources', () => {
  it('a source added from the page starts syncing as soon as it is saved, and says whether it did', async () => {
    vi.mocked(addSource).mockResolvedValue({ id: 14, slug: 'web-docs' });
    vi.mocked(startSourceSyncing).mockResolvedValue('started');
    const request = new Request('http://localhost/rpc/sources', { method: 'POST', body: JSON.stringify({ kind: 'web', configJson: { baseUrl: 'https://docs.example' } }) });

    const body = await (await POST(request)).json();

    expect(body).toEqual({ source: { id: 14, slug: 'web-docs' }, firstSync: 'started' });
    expect(startSourceSyncing).toHaveBeenCalledWith({ orgId: 'org_1', sourceId: 14, sourceSlug: 'web-docs', connectorSlug: 'web' });
  });

  it('a save whose first sync could not start still answers 200 with the saved source, so the page keeps it and offers Sync now', async () => {
    vi.mocked(addSource).mockResolvedValue({ id: 15, slug: 'web-help' });
    vi.mocked(startSourceSyncing).mockResolvedValue('failed');
    const request = new Request('http://localhost/rpc/sources', { method: 'POST', body: JSON.stringify({ kind: 'web', configJson: { baseUrl: 'https://help.example' } }) });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: { id: 15, slug: 'web-help' }, firstSync: 'failed' });
  });

  it('refuses a member: nothing is saved and nothing starts syncing', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, role: 'member', workspaceRole: 'member' } as never);
    const request = new Request('http://localhost/rpc/sources', { method: 'POST', body: JSON.stringify({ kind: 'web', configJson: { baseUrl: 'https://docs.example' } }) });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(addSource).not.toHaveBeenCalled();
    expect(startSourceSyncing).not.toHaveBeenCalled();
  });

  it('holds the first sync when the caller stores a credential next, so it never starts without one', async () => {
    vi.mocked(addSource).mockResolvedValue({ id: 16, slug: 'strapi' });
    const request = new Request('http://localhost/rpc/sources', { method: 'POST', body: JSON.stringify({ kind: 'strapi', configJson: { collections: ['articles'] }, startSyncing: false }) });

    const body = await (await POST(request)).json();

    expect(body).toEqual({ source: { id: 16, slug: 'strapi' }, firstSync: null });
    expect(startSourceSyncing).not.toHaveBeenCalled();
  });

  it('a source the connector refuses is not saved, so nothing is scheduled', async () => {
    vi.mocked(addSource).mockRejectedValue(new Error('baseUrl is required'));
    const request = new Request('http://localhost/rpc/sources', { method: 'POST', body: JSON.stringify({ kind: 'web', configJson: {} }) });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(startSourceSyncing).not.toHaveBeenCalled();
  });
});
