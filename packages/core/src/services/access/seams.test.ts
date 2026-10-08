/**
 * Every read seam the access log claims, asserted at the seam: the preview
 * panel and the object and artifact RPCs (a person), the share pages and the
 * feature share's media (a link, with its fingerprint), the S3, media and
 * room routes (a session or a token), the MCP server's tools (its bearer, in
 * its own workspace), the Access log page's admin gate, and the prune job the
 * deployment schedules. Against PGlite; only who is signed in is stubbed.
 */
import type { NextRequest } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/routers/AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next-intl/server', async importOriginal => ({ ...(await importOriginal<object>()), setRequestLocale: vi.fn() }));
vi.mock('@/libs/aws/s3', async importOriginal => ({ ...(await importOriginal<object>()), presignGet: vi.fn(async () => 'https://s3.example/signed') }));
vi.mock('@/libs/tools/artifacts/media', async importOriginal => ({ ...(await importOriginal<object>()), locateMedia: vi.fn() }));
vi.mock('@/libs/tools/artifacts/mediaResponse', () => ({ mediaResponse: vi.fn(async () => new Response('bytes', { status: 206 })) }));
vi.mock('@/services/DataRoomService', async importOriginal => ({ ...(await importOriginal<object>()), getDataRoom: vi.fn() }));
vi.mock('@/services/factory/featureShareData', async importOriginal => ({
  ...(await importOriginal<object>()),
  loadSharedFeature: vi.fn(),
  sharedFeatureRef: vi.fn(),
  sharedFeatureMedia: vi.fn(),
}));
vi.mock('@/features/share/PublicFeatureView', () => ({ PublicFeatureView: () => null }));
// The page's client view and frame are not rendered here; what the page hands them is the assertion.
vi.mock('@/features/access/AccessLogView', () => ({ AccessLogView: () => null }));
vi.mock('@/components/patterns', () => ({ ListPage: () => null }));

const { db } = await import('@/libs/DB');
const { accessEventSchema, artifactSchema, artifactVersionSchema, businessObjectSchema, businessObjectTypeSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { guardAuth } = await import('@/routers/AuthGuards');
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { headers: requestHeaders } = await import('next/headers');
const { locateMedia } = await import('@/libs/tools/artifacts/media');
const { getDataRoom } = await import('@/services/DataRoomService');
const { loadSharedFeature, sharedFeatureMedia, sharedFeatureRef } = await import('@/services/factory/featureShareData');
const { signArtifactShare } = await import('@/libs/share/artifactShareToken');
const { flushAccessLog, recordAccess, resetAccessLogForTests } = await import('./accessLog');

const ACCOUNT = 'acct_seams_northwind';
const ORG = 'proj_seams_northwind';
const OTHER = 'proj_seams_kestrel';

type Procedure = { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<unknown> } };
function call(route: unknown, input: unknown): Promise<unknown> {
  return (route as Procedure)['~orpc'].handler({ input, context: {} });
}

function signedIn(role: 'admin' | 'member' = 'admin') {
  const session = { userId: 'usr-dana', orgId: ORG, accountId: ACCOUNT, projectId: ORG, role, workspaceRole: role, has: () => role === 'admin' };
  vi.mocked(guardAuth).mockResolvedValue(session as never);
  vi.mocked(clerkAuth).mockResolvedValue(session as never);
}

function fromClient(ip: string) {
  vi.mocked(requestHeaders).mockResolvedValue(new Headers({ 'x-forwarded-for': ip, 'user-agent': 'Example/1.0' }) as never);
}

async function reads(orgId = ORG) {
  await flushAccessLog();
  return db.select().from(accessEventSchema).where(eq(accessEventSchema.orgId, orgId));
}

let objectId = 0;
let artifactId = 0;

beforeEach(async () => {
  resetAccessLogForTests();
  vi.stubEnv('AUTH_SECRET', 'test-secret-test-secret-test-secret');
  vi.mocked(requestHeaders).mockResolvedValue(new Headers() as never);
  vi.mocked(authenticateBearer).mockReset();
  await db.delete(accessEventSchema);
  await db.delete(artifactSchema).where(eq(artifactSchema.orgId, ORG));
  await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
  await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, ORG));
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, ACCOUNT));
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-seams' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'northwind-seams', name: 'Northwind' });
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'account', label: 'Account' }).returning();
  const [obj] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Northwind renewal' }).returning();
  const [art] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'markdown', title: 'Renewal brief', spec: { md: 'Terms agreed.' }, shareAudience: 'anyone' }).returning();
  objectId = obj!.id;
  artifactId = art!.id;
});

describe('a person, in the app', () => {
  it('the preview panel: a peek that found the record is a view of it', async () => {
    signedIn();
    const { getRoute } = await import('@/routers/Preview');
    await call(getRoute, { type: 'object', id: String(objectId) });

    expect(await reads()).toEqual([expect.objectContaining({ actorKind: 'user', actorId: 'usr-dana', accountId: ACCOUNT, action: 'view', recordKind: 'object', recordId: String(objectId), via: 'preview' })]);
  });

  it('objects.get is a view of the record', async () => {
    signedIn();
    const { get } = await import('@/routers/BusinessObject');
    await call(get, { id: objectId });

    expect(await reads()).toEqual([expect.objectContaining({ actorId: 'usr-dana', action: 'view', recordKind: 'object', recordId: String(objectId), via: 'app' })]);
  });

  it('artifacts.get is a view, exportPage an export, and an old version a view that says which', async () => {
    signedIn();
    const Artifacts = await import('@/routers/Artifacts');
    await db.insert(artifactVersionSchema).values({ orgId: ORG, artifactId, version: 1, kind: 'markdown', title: 'Renewal brief', spec: { md: 'Draft terms.' } });
    await call(Artifacts.get, { id: artifactId });
    await call(Artifacts.exportPage, { id: artifactId });
    await flushAccessLog();
    // As if a minute later, so the second view is its own row rather than folded into the first.
    resetAccessLogForTests();
    await call(Artifacts.version, { id: artifactId, version: 1 });
    const rows = await reads();

    expect(rows.map(r => [r.action, r.recordKind, r.recordId, r.detail]).sort()).toEqual([
      ['export', 'artifact', String(artifactId), { format: 'workspace-page' }],
      ['view', 'artifact', String(artifactId), { version: 1 }],
      ['view', 'artifact', String(artifactId), null],
    ].sort());
  });
});

describe('anyone holding a share link', () => {
  it('the shared artifact page is the link\'s read, with the reader\'s fingerprint and no actor id', async () => {
    fromClient('198.51.100.4');
    const { default: SharedArtifactPage } = await import('@/app/[locale]/share/a/[token]/page');
    await SharedArtifactPage({ params: Promise.resolve({ locale: 'en', token: signArtifactShare({ orgId: ORG, artifactId }) }) });

    expect(await reads()).toEqual([expect.objectContaining({ actorKind: 'link', actorId: null, action: 'view', recordKind: 'artifact', recordId: String(artifactId), via: 'share', ipHash: expect.stringMatching(/^[0-9a-f]{32}$/), uaHash: expect.stringMatching(/^[0-9a-f]{32}$/) })]);
  });

  it('the shared feature page is a read of the feature\'s request, and each reader is their own row', async () => {
    vi.mocked(loadSharedFeature).mockResolvedValue({ title: 'Faster checkout' } as never);
    vi.mocked(sharedFeatureRef).mockResolvedValue({ orgId: ORG, requestId: objectId });
    const { default: SharedFeaturePage } = await import('@/app/[locale]/share/feature/[token]/page');
    fromClient('198.51.100.4');
    await SharedFeaturePage({ params: Promise.resolve({ locale: 'en', token: 'feature-token' }) });
    fromClient('203.0.113.9');
    await SharedFeaturePage({ params: Promise.resolve({ locale: 'en', token: 'feature-token' }) });
    const rows = await reads();

    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.actorKind === 'link' && r.recordKind === 'object' && r.recordId === String(objectId) && r.via === 'share')).toBe(true);
    expect(new Set(rows.map(r => r.ipHash)).size).toBe(2);
  });

  it('a picture on the shared feature page is a view of its artifact', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    vi.mocked(sharedFeatureMedia).mockResolvedValue({ orgId: ORG, artifact: { id: artifactId, orgId: ORG, kind: 'image', url: png, spec: {} } as never });
    const { GET } = await import('@/app/api/share/feature/[token]/media/[artifactId]/route');
    const req = new Request(`https://vocion.test/api/share/feature/t/media/${artifactId}?k=sig`, { headers: { 'x-real-ip': '198.51.100.4' } });
    Object.assign(req, { nextUrl: new URL(req.url) });
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ token: 't', artifactId: String(artifactId) }) });

    expect(res.status).toBe(200);
    expect(await reads()).toEqual([expect.objectContaining({ actorKind: 'link', action: 'view', recordKind: 'artifact', recordId: String(artifactId), via: 'share', ipHash: expect.any(String) })]);
  });
});

describe('a session or a token, through /api', () => {
  it('an S3 file handed over is a download by the token, and a NUL in its key cannot sink the batch', async () => {
    vi.mocked(authenticateBearer).mockResolvedValue({ orgId: ORG, tokenId: '41', principal: { kind: 'user', id: 'token:41', role: 'member', scope: { orgId: ORG }, grants: [] } } as never);
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'northwind-files', kind: 'plugin', configJson: { _connector: 's3', bucket: 'northwind-docs' } });
    const { GET } = await import('@/app/api/v1/s3/object/route');
    const res = await GET(new Request(`https://vocion.test/api/v1/s3/object?bucket=northwind-docs&key=${encodeURIComponent('contracts/\u0000renewal.pdf')}`, { headers: { authorization: 'Bearer vcn_live_x_y' } }));
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: objectId }, via: 'page' });

    expect(res.status).toBe(302);
    expect((await reads()).map(r => [r.actorKind, r.actorId, r.action, r.recordId]).sort()).toEqual([
      ['token', 'token:41', 'download', 's3://northwind-docs/contracts/renewal.pdf'],
      ['user', 'usr-rowan', 'view', String(objectId)],
    ]);
  });

  it('a recording played is a view of the artifact that claims it', async () => {
    signedIn();
    const { mediaUrl } = await import('@/libs/tools/artifacts/media');
    const [rec] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'video', title: 'Walkthrough', spec: {}, url: mediaUrl(objectId, 'walkthrough.mp4') }).returning();
    vi.mocked(locateMedia).mockResolvedValue({ kind: 'disk', path: '/tmp/walkthrough.mp4', size: 5 } as never);
    const { GET } = await import('@/app/api/media/[recordId]/[filename]/route');
    const res = await GET(new Request('https://vocion.test/api/media/x/walkthrough.mp4') as unknown as NextRequest, { params: Promise.resolve({ recordId: String(objectId), filename: 'walkthrough.mp4' }) });

    expect(res.status).toBe(206);
    expect(await reads()).toEqual([expect.objectContaining({ actorKind: 'user', actorId: 'usr-dana', action: 'view', recordKind: 'artifact', recordId: String(rec!.id), via: 'api' })]);
  });

  it('a data room read over the API is a view of its record', async () => {
    signedIn();
    vi.mocked(getDataRoom).mockResolvedValue({ id: objectId, title: 'Kestrel diligence' } as never);
    const { GET } = await import('@/app/api/v1/rooms/[id]/route');
    await GET(new Request(`https://vocion.test/api/v1/rooms/${objectId}`) as unknown as NextRequest, { params: Promise.resolve({ id: String(objectId) }) });

    expect(await reads()).toEqual([expect.objectContaining({ actorId: 'usr-dana', action: 'view', recordKind: 'object', recordId: String(objectId), via: 'api' })]);
  });
});

describe('the MCP server', () => {
  async function connect(identity?: { userId: string }) {
    const { buildServer } = await import('@/interfaces/mcp/server');
    const server = await buildServer({ orgId: ORG, contextPath: '/nonexistent', diskWorkspace: false, autoCommit: false, autoApply: false, serverName: 'vocion-test', serverVersion: '0.0.0' }, identity);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
  }

  it('objects_get is a view by the bearer, in the server\'s own workspace', async () => {
    const client = await connect({ userId: 'token:41' });
    await client.callTool({ name: 'objects_get', arguments: { id: objectId } });

    expect(await reads()).toEqual([expect.objectContaining({ actorKind: 'token', actorId: 'token:41', action: 'view', recordKind: 'object', recordId: String(objectId), via: 'mcp:objects_get' })]);
    expect(await reads(OTHER)).toHaveLength(0);
  });

  it('objects_list hands over whole records: a search, with how many', async () => {
    const client = await connect();
    await client.callTool({ name: 'objects_list', arguments: { type_slug: 'account' } });

    expect(await reads()).toEqual([expect.objectContaining({ actorKind: 'token', actorId: 'token:mcp', action: 'search', recordKind: 'object', detail: { hits: 1, type: 'account' }, via: 'mcp:objects_list' })]);
  });
});

describe('the Access log page', () => {
  async function render(role: 'admin' | 'member') {
    signedIn(role);
    const { default: AccessLogPage } = await import('@/app/[locale]/(auth)/dashboard/access-log/page');
    return JSON.stringify(await AccessLogPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ days: '999999999' }) }));
  }

  it('tells a member it is for admins, and shows them no reads', async () => {
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: objectId }, via: 'page' });
    await flushAccessLog();
    const page = await render('member');

    expect(page).toContain('visible to this workspace\'s admins only');
    expect(page).not.toContain('usr-rowan');
  });

  it('shows an admin the reads, and reads a hand-edited window as the default rather than failing', async () => {
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: objectId }, via: 'page' });
    await flushAccessLog();
    const page = await render('admin');

    expect(page).toContain('Northwind renewal');
    expect(page).not.toContain('admins only');
  });
});

describe('retention', () => {
  it('the access-log.prune job the deployment schedules deletes reads older than the period', async () => {
    vi.stubEnv('VOCION_ACCESS_LOG_RETENTION_DAYS', '30');
    const { JOB } = await import('@/services/background/catalog');
    const { jobNamed } = await import('@/libs/durable/jobs');
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page', at: new Date(Date.now() - 40 * 86_400_000) });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 2 }, via: 'page' });
    await flushAccessLog();
    const result = await jobNamed(JOB.accessLogPrune).handler({}, { runId: 'r', step: async (_n: string, fn: () => Promise<unknown>) => fn(), sleep: async () => {} } as never);

    expect(result).toMatchObject({ deleted: 1, moreRemaining: false });
    expect((await reads()).map(r => r.recordId)).toEqual(['2']);
  });
});
