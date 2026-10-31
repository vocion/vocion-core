/**
 * `site.publish_page` and `site.publish_live` to a WEBFLOW site, end to end
 * against Webflow's recorded answers (`libs/fixtures/webflow.ts`): no network,
 * no database. The client, the site and every address are fictional
 * (Northwind Outfitters).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLOG_ID, FIXTURE_LIVE_POST, FIXTURE_SITE_ID, FIXTURE_WEBFLOW_TOKEN, webflowFetch } from '@/libs/fixtures/webflow';

type Rec = { id: number; title: string; typeSlug: string; meta: Record<string, unknown> };
const records = new Map<number, Rec>();

vi.mock('@/libs/actions/factory-dispatch', () => ({
  readRecord: vi.fn(async (_org: string, id: number) => {
    const r = records.get(id);
    return r ? { id: r.id, title: r.title, typeId: 1, status: null, meta: r.meta, typeSlug: r.typeSlug, settled: null } : null;
  }),
  writeMeta: vi.fn(async (_org: string, id: number, set: Record<string, unknown>) => {
    const r = records.get(id);
    if (r) {
      r.meta = { ...r.meta, ...set };
    }
  }),
}));

const DRAFT = '# How to Choose a Three-Season Tent\n\nA tent for spring, summer and fall: what matters, what does not, and what it should cost you.\n\n![A tent at dusk](https://images.example/tent.jpg)\n\n## Weight\n\nUnder 2 kg. See [our layering guide](/blog/layering-for-shoulder-season).';
vi.mock('@/services/ArtifactService', () => ({
  getArtifact: vi.fn(async ({ id }: { id: number }) => (id === 501 ? { id: 501, kind: 'markdown', title: 'Three-season tent guide', currentVersion: 4, spec: { md: DRAFT } } : null)),
}));

let login: Record<string, unknown> | undefined;
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(async () => login),
  getCredentialsForConnector: vi.fn(async () => login),
}));
// The Webflow connections this work may use: the workspace's one.
vi.mock('@/services/connect/connectionScope', async importOriginal => ({
  ...(await importOriginal<object>()),
  connectionsFor: vi.fn(async () => [{ id: 1, slug: 'webflow', configJson: {}, apiTokenId: 'tok-webflow', dataRoomId: null }]),
}));

const db = { updates: [] as unknown[] };
vi.mock('@/libs/DB', () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      from: () => c,
      innerJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (ok: (v: unknown) => unknown) => Promise.resolve([]).then(ok),
      catch: () => Promise.resolve([]),
    });
    return c;
  };
  const update = () => ({ set: (v: unknown) => ({ where: () => ({ catch: () => {
    db.updates.push(v);
    return Promise.resolve();
  } }) }) });
  return { db: { select: () => chain(), update } };
});
vi.mock('@/services/seo/records', () => ({
  signedOff: (meta: { signoff?: { decision?: string } }) => meta.signoff?.decision === 'approve',
  refreshSeoBatch: vi.fn(async () => null),
}));

const { sitePublishLiveAction: live, sitePublishPageAction: action } = await import('./site-publish-page');

const WEBFLOW = {
  id: 'blog',
  kind: 'webflow',
  label: 'Northwind blog',
  config: {
    siteId: FIXTURE_SITE_ID,
    siteUrl: 'https://www.northwind-outfitters.example',
    collectionId: FIXTURE_BLOG_ID,
    collectionPath: '/blog',
    fields: { body: 'post-body', excerpt: 'post-summary', metaTitle: 'seo-title', metaDescription: 'meta-description', author: 'author', date: 'publish-date', image: 'main-image' },
  },
};
const ctx = { orgId: 'org_nw', reviewedBy: 'usr-jamie', invokedBy: 'agent:seo-strategist', runId: 99 } as never;
let api: ReturnType<typeof webflowFetch>;

beforeEach(() => {
  records.clear();
  db.updates = [];
  login = { token: FIXTURE_WEBFLOW_TOKEN, siteIds: [FIXTURE_SITE_ID] };
  api = webflowFetch();
  vi.stubGlobal('fetch', vi.fn(api.fetch));
  records.set(10, { id: 10, title: 'Northwind Outfitters', typeSlug: 'data_room', meta: { publishTargets: [WEBFLOW], authors: [{ name: 'Jamie Rivera', slug: 'jamie-rivera', default: true }] } });
  records.set(20, { id: 20, title: 'How to Choose a Three-Season Tent', typeSlug: 'seo_page', meta: { projectId: 10, keyword: 'three season tent', draftArtifactId: 501, status: 'approved', signoff: { decision: 'approve', version: 4 }, slug: 'choose-a-three-season-tent', metaTitle: 'Three-Season Tents: What Matters', metaDescription: 'What matters in a three-season tent, what does not, and what it should cost.', pageType: 'blog' } });
});

const writes = () => api.calls.filter(c => c.method !== 'GET');

describe('a page published to Webflow', () => {
  it('is saved as a draft item, never live: rich text body, mapped fields, the image by URL and the author by reference', async () => {
    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toBeUndefined();

    const card = await action.reviewCard!(ctx, { pageRecordId: 20 });

    expect(card.title).toBe('Save "How to Choose a Three-Season Tent" as a draft on www.northwind-outfitters.example');
    expect(card.badges?.map(b => b.label)).toEqual(['Webflow', 'Draft only', 'Undo deletes it']);
    expect(card.fields.find(f => f.label === 'URL once live')?.value).toBe('https://www.northwind-outfitters.example/blog/choose-a-three-season-tent');

    const out = await action.execute(ctx, { pageRecordId: 20 });

    expect(writes()).toEqual([{ method: 'POST', path: `/collections/${FIXTURE_BLOG_ID}/items`, body: expect.objectContaining({ isDraft: true }) }]);

    const sent = (writes()[0]!.body as { fieldData: Record<string, unknown> }).fieldData;

    expect(sent).toMatchObject({
      'name': 'How to Choose a Three-Season Tent',
      'slug': 'choose-a-three-season-tent',
      'seo-title': 'Three-Season Tents: What Matters',
      'meta-description': 'What matters in a three-season tent, what does not, and what it should cost.',
      'author': '64f0c0ffee00000000000a11',
      'main-image': { url: 'https://images.example/tent.jpg', alt: 'How to Choose a Three-Season Tent' },
    });
    expect(sent['post-body']).toBe([
      '<p>A tent for spring, summer and fall: what matters, what does not, and what it should cost you.</p>',
      '<figure class="w-richtext-figure-type-image w-richtext-align-fullwidth"><div><img src="https://images.example/tent.jpg" alt="A tent at dusk"></div></figure>',
      '<h2>Weight</h2>',
      '<p>Under 2 kg. See <a href="/blog/layering-for-shoulder-season">our layering guide</a>.</p>',
    ].join('\n'));
    expect(out).toMatchObject({ kind: 'webflow', published: false, created: true, receipt: { text: 'Draft saved in Webflow' } });
    expect(records.get(20)!.meta).toMatchObject({ status: 'publishing', webflowDraft: { itemId: out.itemId, collectionId: FIXTURE_BLOG_ID, siteId: FIXTURE_SITE_ID, slug: 'choose-a-three-season-tent' } });
    expect(api.calls.some(c => c.path.endsWith('/items/publish'))).toBe(false);
  });

  it('publishes again by updating the same item in place, never a second post at the slug', async () => {
    const first = await action.execute(ctx, { pageRecordId: 20 });
    const second = await action.execute(ctx, { pageRecordId: 20 });

    expect(second).toMatchObject({ created: false, itemId: first.itemId });
    expect(writes().map(c => `${c.method} ${c.path}`)).toEqual([`POST /collections/${FIXTURE_BLOG_ID}/items`, `PATCH /collections/${FIXTURE_BLOG_ID}/items/${first.itemId}`]);
    expect((writes()[1]!.body as { isDraft: boolean }).isDraft).toBe(true);
    expect([...api.items.values()].filter(i => i.fieldData.slug === 'choose-a-three-season-tent')).toHaveLength(1);
    expect(action.canUndo!(second)).toBe(false);
  });

  it('never touches a live post at its slug that is someone else\'s, and updates it in place when the page refreshes it', async () => {
    records.get(20)!.meta.slug = FIXTURE_LIVE_POST.fieldData.slug;

    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toMatch(/A live post is already at \/layering-for-shoulder-season .*not this page's/);

    records.get(20)!.meta.existingUrl = 'https://www.northwind-outfitters.example/blog/layering-for-shoulder-season';
    const out = await action.execute(ctx, { pageRecordId: 20 });

    expect(out).toMatchObject({ created: false, itemId: FIXTURE_LIVE_POST.id });
    expect(writes()).toEqual([{ method: 'PATCH', path: `/collections/${FIXTURE_BLOG_ID}/items/${FIXTURE_LIVE_POST.id}`, body: expect.objectContaining({ isDraft: true }) }]);
  });

  it('says what is missing when the target has no field mapping yet, or no login reaches the site', async () => {
    records.get(10)!.meta.publishTargets = [{ ...WEBFLOW, config: { siteUrl: WEBFLOW.config.siteUrl } }];

    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toMatch(/apply the mapping learned under Publishing/);

    records.get(10)!.meta.publishTargets = [WEBFLOW];
    login = { token: FIXTURE_WEBFLOW_TOKEN, siteIds: ['64f0c0ffee00000000000a99'] };

    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toMatch(/no Webflow login for this site/);
  });

  it('Undo deletes the draft item it created, and puts the page back to approved', async () => {
    const out = await action.execute(ctx, { pageRecordId: 20 });

    expect(action.canUndo!(out)).toBe(true);

    await action.undo!(ctx, { pageRecordId: 20 }, out);

    expect(api.items.has(out.itemId as string)).toBe(false);
    expect(records.get(20)!.meta).toMatchObject({ status: 'approved', webflowDraft: null });
  });
});

describe('a Webflow draft going live', () => {
  it('is its own approval, asked every time: it waits on a person\'s Review decision and has no Undo', async () => {
    await action.execute(ctx, { pageRecordId: 20 });

    expect(live.approvalRequired).toBe(true);
    expect(live.requiresReviewDecision).toBe(true);
    expect(live.canUndo).toBeUndefined();
    expect(live.dedupKeyFor!({ pageRecordIds: [20] })).not.toBe(action.dedupKeyFor!({ pageRecordId: 20 }));
    expect(await live.precheck!(ctx, { pageRecordIds: [20] })).toBeUndefined();

    const card = await live.reviewCard!(ctx, { pageRecordIds: [20] });

    expect(card).toMatchObject({ title: 'Publish 1 drafted post on Webflow', system: 'Webflow' });
    expect(card.fields).toEqual([{ label: 'How to Choose a Three-Season Tent', value: 'https://www.northwind-outfitters.example/blog/choose-a-three-season-tent', href: 'https://www.northwind-outfitters.example/blog/choose-a-three-season-tent' }]);
  });

  it('takes the item out of draft and publishes that item alone, then records the page live at its address', async () => {
    const saved = await action.execute(ctx, { pageRecordId: 20 });
    records.get(20)!.meta.publishing = { ...(records.get(20)!.meta.publishing as object), actionRunId: 99 };
    api.calls.length = 0;

    const out = await live.execute(ctx, { pageRecordIds: [20] });

    expect(writes()).toEqual([
      { method: 'PATCH', path: `/collections/${FIXTURE_BLOG_ID}/items/${saved.itemId}`, body: { isArchived: false, isDraft: false } },
      { method: 'POST', path: `/collections/${FIXTURE_BLOG_ID}/items/publish`, body: { itemIds: [saved.itemId] } },
    ]);
    expect(api.calls.some(c => c.path.startsWith(`/sites/${FIXTURE_SITE_ID}/publish`))).toBe(false);
    expect(out.line).toBe('"How to Choose a Three-Season Tent" is live at https://www.northwind-outfitters.example/blog/choose-a-three-season-tent.');
    expect(records.get(20)!.meta).toMatchObject({ status: 'published', publishedAt: expect.any(String), publishedUrl: 'https://www.northwind-outfitters.example/blog/choose-a-three-season-tent' });
    expect(db.updates).toHaveLength(1);
  });

  it('leaves the post a draft and says why when Webflow will not publish it', async () => {
    api = webflowFetch({ publishError: { status: 409, body: { message: 'Collection has not been published to the site yet', code: 'conflict' } } });
    vi.stubGlobal('fetch', vi.fn(api.fetch));
    const saved = await action.execute(ctx, { pageRecordId: 20 });

    await expect(live.execute(ctx, { pageRecordIds: [20] })).rejects.toThrow(/stays a draft in Webflow: Webflow will not publish an item until the site has been published/);
    expect(api.items.get(saved.itemId as string)!.isDraft).toBe(true);
    expect(records.get(20)!.meta.status).toBe('publishing');
    expect(db.updates).toHaveLength(0);
  });
});
