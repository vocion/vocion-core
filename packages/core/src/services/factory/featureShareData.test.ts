/**
 * A feature's public link, end to end on a database: Share files a link and
 * the page opens for anyone holding it; Stop sharing kills every copy; sharing
 * again is a new link; a bad token is the same 404; the media route serves a
 * picture or the recording only through the link, only for that feature's
 * files and only the ones the page chose. Fictional fixtures (Northwind,
 * Kestrel).
 */
import type { FeatureReportInput } from './featureReport';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The report is the feature page's own read, tested on its own; here it is
// assembled from records, so this file is about the link and nothing else.
vi.mock('./featureReportData', () => ({ loadFeatureReport: vi.fn() }));

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, businessObjectTypeSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { shareCard } = await import('./featureShare');
const { assembleFeatureReport } = await import('./featureReport');
const { loadFeatureReport } = await import('./featureReportData');
const { featureShareOf, loadSharedFeature, setFeatureShare, sharedFeatureMedia } = await import('./featureShareData');
const { signShareMedia, verifyArtifactShare } = await import('@/libs/share/artifactShareToken');
const { GET } = await import('@/app/api/share/feature/[token]/media/[artifactId]/route');

const ORG = 'org_share_northwind';
const OTHER = 'org_share_kestrel';
const ADA = 'user_ada_northwind';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const prevSecret = process.env.AUTH_SECRET;

let requestId = 0;
let otherRequestId = 0;
let taskId = 0;
let mockup = 0;
let recording = 0;
let chatUpload = 0;
let otherPicture = 0;
let qaShot = 0;

async function typeId(orgId: string, slug: string): Promise<number> {
  const [t] = await db.insert(businessObjectTypeSchema).values({ orgId, slug, label: slug }).returning({ id: businessObjectTypeSchema.id });
  return t!.id;
}

async function picture(orgId: string, recordId: number | null, role: string | null, over: Partial<typeof artifactSchema.$inferInsert> = {}): Promise<number> {
  const [a] = await db.insert(artifactSchema).values({ orgId, kind: 'link', title: 'Library rows with dates', spec: { href: '#', title: 'x', contentType: 'image/png', caption: 'The proposed row' }, url: PNG, recordType: recordId ? 'object' : null, recordId: recordId ? String(recordId) : null, recordRole: role, ...over }).returning({ id: artifactSchema.id });
  return a!.id;
}

function reportFor(id: number, meta: Record<string, unknown>) {
  const input: FeatureReportInput = {
    request: { id, title: 'Show the upload date on each library row', status: 'shipped', createdAt: new Date('2026-10-02T07:12:00Z'), meta },
    tasks: [{ id: taskId, title: 'Attempt 1', status: 'accepted', createdAt: new Date('2026-10-02T07:40:00Z'), meta: { requestId: id, verdict: { value: 'approve', at: '2026-10-02T07:58:00Z' } } }],
    plans: [],
    workerRuns: [{ id: 501, agentSlug: 'northwind-engineer', kind: 'worker', status: 'completed', attempt: 1, cents: 120, model: null, summary: null, error: null, createdAt: new Date('2026-10-02T07:41:00Z'), claimedAt: null, completedAt: new Date('2026-10-02T07:55:00Z'), input: { record: { type: 'engineering_task', id: taskId } }, result: null, progress: {} }],
    asks: [],
    actionRuns: [],
    releases: [],
    artifacts: [],
    now: new Date('2026-10-02T12:00:00Z'),
  };
  return assembleFeatureReport(input);
}

const tokenOf = (path: string | null) => path!.replace('/share/feature/', '');

const call = (token: string, artifactId: number, sig: string | null) => GET(
  { nextUrl: new URL(`http://localhost/api/share/feature/${token}/media/${artifactId}${sig === null ? '' : `?k=${sig}`}`), headers: new Headers() } as never,
  { params: Promise.resolve({ token, artifactId: String(artifactId) }) },
);

beforeAll(async () => {
  process.env.AUTH_SECRET = 'feature-share-test-secret';
  await db.insert(tenantAccountSchema).values({ id: 'acct_share_northwind', name: 'Northwind', slug: 'northwind-share' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_share_northwind', slug: 'northwind-studio', name: 'Northwind Studio' });
  const request = await typeId(ORG, 'request');
  const task = await typeId(ORG, 'engineering_task');
  const otherType = await typeId(OTHER, 'request');
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: request, title: 'Show the upload date on each library row' }).returning({ id: businessObjectSchema.id });
  requestId = r!.id;
  const [o] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: request, title: 'Export a room as a PDF' }).returning({ id: businessObjectSchema.id });
  otherRequestId = o!.id;
  await db.insert(businessObjectSchema).values({ orgId: OTHER, typeId: otherType, title: 'Kestrel intake form' });
  const [t] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: task, title: 'Attempt 1', metadata: { requestId } }).returning({ id: businessObjectSchema.id });
  taskId = t!.id;
  mockup = await picture(ORG, requestId, null);
  chatUpload = await picture(ORG, requestId, 'reported');
  otherPicture = await picture(ORG, otherRequestId, null);
  qaShot = await picture(ORG, taskId, 'qa-screenshot', { title: 'Library · desktop · after', url: null, spec: { href: '#', title: 'x', contentType: 'image/png', caption: 'Rows with dates', url: PNG } });
  recording = await picture(ORG, taskId, 'qa-live-video', { kind: 'link', url: '/api/media/live/live-check-aaaaaaaaaaaaaaaa.webm', spec: { href: '#', title: 'x', contentType: 'video/webm', caption: 'Live check' } });
  const meta = {
    body: 'I cannot tell which file is newest. Email dana@northwind.example.',
    outcome: 'Library rows show when each file was uploaded.',
    askedBy: { name: 'Dana Okafor', email: 'dana@northwind.example' },
    askedAt: '2026-10-02T07:12:00Z',
    visuals: { mockupArtifactIds: [mockup] },
  };
  await db.update(businessObjectSchema).set({ metadata: meta }).where((await import('drizzle-orm')).eq(businessObjectSchema.id, requestId));
  vi.mocked(loadFeatureReport).mockImplementation(async (_org, id) => (id === requestId ? reportFor(id, meta) : null));
});

afterAll(() => {
  process.env.AUTH_SECRET = prevSecret;
});

describe('sharing a feature', () => {
  it('is off until someone presses Share', async () => {
    expect(await featureShareOf(ORG, requestId)).toEqual({ shared: false, path: null, hideAsker: false, showOpenLink: true });
  });

  it('refuses a record that is not one of this workspace\'s features', async () => {
    expect(await setFeatureShare({ orgId: OTHER, requestId, userId: ADA, shared: true })).toBeNull();
    expect(await setFeatureShare({ orgId: ORG, requestId: taskId, userId: ADA, shared: true })).toBeNull();
  });

  it('files an unguessable link that opens the page, then revokes every copy of it', async () => {
    const on = await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true });

    expect(on).toMatchObject({ shared: true, hideAsker: false });
    expect(on!.path).toMatch(/^\/share\/feature\/[\w-]+~[\w-]+$/);
    expect(await featureShareOf(ORG, requestId)).toEqual(on);

    const token = tokenOf(on!.path);
    const page = await loadSharedFeature(token);

    expect(page).toMatchObject({ title: 'Show the upload date on each library row', built: 'Library rows show when each file was uploaded.', ask: { by: 'Dana Okafor' }, builtBy: 'Northwind Studio', workspaceName: 'Northwind Studio' });
    // The one link back in: the feature's page in the workspace, as the app links it.
    expect(page!.openUrl).toBe(`/w/northwind-studio/dashboard/objects/${requestId}`);
    expect(JSON.stringify({ ...page, openUrl: null })).not.toMatch(/dana@|northwind\.example|\/api\/media|\/api\/artifacts|\/dashboard/);
    // The walkthrough, the mockup, then QA's shot of the attempt that shipped.
    expect(page!.media.map(m => [m.kind, m.label])).toEqual([['video', 'On the live product'], ['image', 'Mockup'], ['image', 'QA after']]);

    const off = await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: false });

    expect(off).toEqual({ shared: false, path: null, hideAsker: false, showOpenLink: true });
    expect(await loadSharedFeature(token)).toBeNull();
  });

  it('files a new link when shared again, and the old one stays dead', async () => {
    const first = tokenOf((await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true }))!.path);
    await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: false });
    const second = tokenOf((await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true }))!.path);

    expect(second).not.toBe(first);
    expect(await loadSharedFeature(first)).toBeNull();
    expect(await loadSharedFeature(second)).not.toBeNull();
  });

  it('hides the Open button on every copy when the sharer turns it off, and shows it again', async () => {
    const state = await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true, showOpenLink: false });

    expect(state).toMatchObject({ shared: true, showOpenLink: false, hideAsker: false });
    expect((await loadSharedFeature(tokenOf(state!.path)))!.openUrl).toBeNull();

    const shown = await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true, showOpenLink: true });

    expect(shown!.path).toBe(state!.path);
    expect((await loadSharedFeature(tokenOf(shown!.path)))!.openUrl).not.toBeNull();
  });

  it('hides who asked on every copy when the sharer turns it off', async () => {
    const state = await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true, hideAsker: true });

    expect(state).toMatchObject({ shared: true, hideAsker: true });
    expect((await loadSharedFeature(tokenOf(state!.path)))!.ask.by).toBeNull();

    const shown = await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: true, hideAsker: false });

    expect(shown!.path).toBe(state!.path);
    expect((await loadSharedFeature(tokenOf(shown!.path)))!.ask.by).toBe('Dana Okafor');
  });

  it('is the same null for junk, a tampered token and a token naming another artifact', async () => {
    const token = tokenOf((await featureShareOf(ORG, requestId)).path);
    const claim = verifyArtifactShare(token)!;

    expect(await loadSharedFeature('nonsense')).toBeNull();
    expect(await loadSharedFeature(`${token.split('~')[0]}~AAAA`)).toBeNull();

    // A real, live share of an ordinary artifact is not a feature's page.
    await db.update(artifactSchema).set({ shareAudience: 'anyone' }).where((await import('drizzle-orm')).eq(artifactSchema.id, mockup));
    const { signArtifactShare } = await import('@/libs/share/artifactShareToken');

    expect(await loadSharedFeature(signArtifactShare({ artifactId: mockup, orgId: ORG }))).toBeNull();
    expect(await loadSharedFeature(signArtifactShare({ artifactId: claim.artifactId, orgId: OTHER }))).toBeNull();

    await db.update(artifactSchema).set({ shareAudience: 'workspace' }).where((await import('drizzle-orm')).eq(artifactSchema.id, mockup));
  });
});

describe('the files a shared page loads', () => {
  it('serves the mockup and the recording it chose, through the link', async () => {
    const token = tokenOf((await featureShareOf(ORG, requestId)).path);
    const page = (await loadSharedFeature(token))!;
    const src = new URL(page.media[1]!.src, 'http://localhost');
    const res = await call(token, Number(src.pathname.split('/').pop()), src.searchParams.get('k'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(page.media[0]!.kind).toBe('video');

    // QA's screenshot on the shipped attempt is the feature's, through the link.
    const shotSrc = new URL(page.media[2]!.src, 'http://localhost');

    expect(Number(shotSrc.pathname.split('/').pop())).toBe(qaShot);
    expect((await call(token, qaShot, shotSrc.searchParams.get('k'))).status).toBe(200);
  });

  it('unfurls to an absolute picture a chat app can fetch with no cookie, decoded from an inline picture', async () => {
    const token = tokenOf((await featureShareOf(ORG, requestId)).path);
    const page = (await loadSharedFeature(token))!;
    const card = shareCard(page, 'https://agents.northwind.example');

    expect(card.siteName).toBe('Northwind Studio');
    expect(card.image!.url).toMatch(/^https:\/\/agents\.northwind\.example\/api\/share\/feature\/[^/]+\/media\/\d+\?k=/);

    // Fetched back exactly as an unfurler would: that URL, no cookie, no session.
    const url = new URL(card.image!.url);
    const res = await GET(
      { nextUrl: url, headers: new Headers() } as never,
      { params: Promise.resolve({ token: url.pathname.split('/')[4]!, artifactId: url.pathname.split('/')[6]! }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
  });

  it('serves nothing it did not choose, nothing of another feature, and nothing once revoked', async () => {
    const state = await featureShareOf(ORG, requestId);
    const token = tokenOf(state.path);
    const shareId = verifyArtifactShare(token)!.artifactId;

    // No signature, a wrong one, and a signature for another file.
    expect((await call(token, mockup, null)).status).toBe(404);
    expect((await call(token, mockup, 'AAAA')).status).toBe(404);
    expect((await call(token, mockup, signShareMedia({ shareId, artifactId: chatUpload }))).status).toBe(404);
    // Even signed for this link, a file that is not one of this feature's pictures or recordings.
    expect(await sharedFeatureMedia(token, chatUpload, signShareMedia({ shareId, artifactId: chatUpload }))).toBeNull();
    expect(await sharedFeatureMedia(token, otherPicture, signShareMedia({ shareId, artifactId: otherPicture }))).toBeNull();
    // The recording filed on the feature's task is the feature's.
    expect(await sharedFeatureMedia(token, recording, signShareMedia({ shareId, artifactId: recording }))).not.toBeNull();

    // A picture narrowed to "Only me" is not served even when chosen.
    await db.update(artifactSchema).set({ shareAudience: 'me', shareOwnerId: ADA }).where((await import('drizzle-orm')).eq(artifactSchema.id, mockup));

    expect((await call(token, mockup, signShareMedia({ shareId, artifactId: mockup }))).status).toBe(404);

    await db.update(artifactSchema).set({ shareAudience: 'workspace', shareOwnerId: null }).where((await import('drizzle-orm')).eq(artifactSchema.id, mockup));

    expect((await call(token, mockup, signShareMedia({ shareId, artifactId: mockup }))).status).toBe(200);

    await setFeatureShare({ orgId: ORG, requestId, userId: ADA, shared: false });

    expect((await call(token, mockup, signShareMedia({ shareId, artifactId: mockup }))).status).toBe(404);
  });
});
