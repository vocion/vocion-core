import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The org's pages are not under test: records open on the generic record page.
vi.mock('@/services/objects/recordHref', async () => {
  const { genericRecordLinker } = await import('@/libs/workspace/recordHref');
  return { recordLinkerForOrg: async () => genericRecordLinker };
});

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema, userSchema, workerRunSchema } = await import('@/models/Schema');
const { recordOrigins, relatedOf } = await import('./related');
const { createBusinessObject } = await import('@/services/BusinessObjectService');
const { runRelatedItems } = await import('@/libs/worker/runLog');

/**
 * RELATED (Chris, 2026-09-30): what a record is connected to, read from what
 * the records already say and driven by what its type declares. Fixture
 * workspace — Northwind's portal — fictional.
 */

const ORG = 'org_related';

// What the software factory's types declare (templates/plugins/software-factory).
const REQUEST_RELATED = [
  { key: 'product', label: 'Product', from: 'links', field: 'product', type: 'product', match: 'slug' },
  { key: 'plans', label: 'Plan', from: 'backlinks', type: 'architecture_plan', field: 'requestId' },
  { key: 'tasks', label: 'Engineering tasks', from: 'backlinks', type: 'engineering_task', field: 'requestId' },
  { key: 'runs', label: 'Engineering runs', from: 'runs', of: 'tasks' },
  { key: 'pulls', label: 'Pull requests', from: 'url', field: 'prUrl', of: 'tasks' },
  { key: 'releases', label: 'Releases', from: 'backlinks', type: 'release', field: 'requestIds' },
];
const PRODUCT_RELATED = [
  { key: 'repos', label: 'Repositories', from: 'backlinks', type: 'repo', field: 'product', match: 'slug' },
];

async function clear() {
  await db.delete(workerRunSchema);
  await db.delete(artifactSchema);
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(conversationSchema);
  await db.delete(userSchema).where((await import('drizzle-orm')).eq(userSchema.id, 'user_dana'));
}

async function types(schemaOf: Record<string, unknown> = {}) {
  const slugs = ['request', 'architecture_plan', 'engineering_task', 'release', 'product', 'repo', 'field_note'];
  const rows = await db.insert(businessObjectTypeSchema).values(slugs.map(slug => ({ orgId: ORG, slug, label: slug, schema: (schemaOf[slug] ?? null) as never }))).returning({ id: businessObjectTypeSchema.id, slug: businessObjectTypeSchema.slug });
  return Object.fromEntries(rows.map(r => [r.slug, r.id])) as Record<string, number>;
}

beforeEach(clear);

afterAll(clear);

describe('what a feature is connected to', () => {
  it('the chat that started it first, then what its type declares, then its artifacts', async () => {
    const t = await types({ request: { 'x-related': REQUEST_RELATED } });
    await db.insert(userSchema).values({ id: 'user_dana', email: 'dana@northwind.example', name: 'Dana Reyes' }).onConflictDoNothing();
    const [convo] = await db.insert(conversationSchema).values({ orgId: ORG, title: 'Share menu PDF export', agentSlug: 'product-manager' } as never).returning({ id: conversationSchema.id });
    await db.insert(businessObjectSchema).values([
      { id: 300, orgId: ORG, typeId: t.product!, title: 'Northwind Portal', metadata: { slug: 'portal' } },
      { id: 301, orgId: ORG, typeId: t.request!, title: 'Room PDF export', metadata: { product: 'portal', origin: { conversationId: convo!.id, userId: 'user_dana', at: '2026-09-30T08:00:00.000Z' } } },
      { id: 302, orgId: ORG, typeId: t.architecture_plan!, title: 'Render the room to PDF', metadata: { requestId: 301 } },
      { id: 303, orgId: ORG, typeId: t.engineering_task!, title: 'Room PDF export task', status: 'abandoned', metadata: { requestId: 301, prUrl: 'https://github.com/example/northwind-portal/pull/26' } },
      { id: 304, orgId: ORG, typeId: t.engineering_task!, title: 'Room PDF export task', metadata: { requestId: '301', prUrl: 'https://github.com/example/northwind-portal/pull/27' } },
      { id: 305, orgId: ORG, typeId: t.release!, title: 'Portal 2026-09-30', metadata: { requestIds: [301, 299] } },
      // Another feature's task: not this one's.
      { id: 306, orgId: ORG, typeId: t.engineering_task!, title: 'Something else', metadata: { requestId: 999 } },
    ]);
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: { record: { id: 304, type: 'engineering_task' } } }).returning({ id: workerRunSchema.id });
    await db.insert(artifactSchema).values({ orgId: ORG, kind: 'file', title: 'share-menu.png', recordType: 'object', recordId: '301', recordRole: 'reported' } as never);

    const items = await relatedOf(ORG, 301);

    expect(items.map(i => [i.relation, i.title])).toEqual([
      ['origin', 'Share menu PDF export'],
      ['product', '#300 Northwind Portal'],
      ['plans', '#302 Render the room to PDF'],
      ['tasks', '#303 Room PDF export task'],
      ['tasks', '#304 Room PDF export task'],
      ['runs', `Run #${run!.id}`],
      ['pulls', 'PR #26'],
      ['pulls', 'PR #27'],
      ['releases', '#305 Portal 2026-09-30'],
      ['artifacts', 'share-menu.png'],
    ]);

    const origin = items[0]!;

    expect(origin).toMatchObject({ label: 'Started in chat', kind: 'conversation', note: 'Dana Reyes', href: `/dashboard/chat?c=${convo!.id}`, preview: { type: 'conversation', id: String(convo!.id) } });
    expect(items.find(i => i.relation === 'pulls')).toMatchObject({ external: true, preview: null, href: 'https://github.com/example/northwind-portal/pull/26' });
    expect(items.find(i => i.relation === 'plans')).toMatchObject({ href: '/dashboard/objects/302', preview: { type: 'object', id: '302' } });
  });

  it('an older record finds its chat through the action run that filed it', async () => {
    const t = await types();
    const [convo] = await db.insert(conversationSchema).values({ orgId: ORG, title: 'Header overflows on a phone', agentSlug: 'product-manager' } as never).returning({ id: conversationSchema.id });
    await db.insert(businessObjectSchema).values({ id: 310, orgId: ORG, typeId: t.request!, title: 'Fix the header width', metadata: {} });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate', status: 'done', input: {}, proposal: { origin: { conversationId: convo!.id, userId: 'user_dana', byPerson: true } }, result: { objectId: 310 } } as never);

    const items = await relatedOf(ORG, 310);

    expect(items[0]).toMatchObject({ relation: 'origin', title: 'Header overflows on a phone' });

    const origins = await recordOrigins(ORG, [{ id: 310, meta: {} }]);

    expect(origins.get(310)).toMatchObject({ conversationId: convo!.id, title: 'Header overflows on a phone' });
  });
});

describe('what a product is connected to', () => {
  it('the repositories that name it by its slug', async () => {
    const t = await types({ product: { 'x-related': PRODUCT_RELATED } });
    await db.insert(businessObjectSchema).values([
      { id: 320, orgId: ORG, typeId: t.product!, title: 'Northwind Portal', metadata: { slug: 'portal' } },
      { id: 321, orgId: ORG, typeId: t.repo!, title: 'northwind-portal', metadata: { product: 'portal' } },
      { id: 322, orgId: ORG, typeId: t.repo!, title: 'kestrel-desk', metadata: { product: 'desk' } },
    ]);

    expect((await relatedOf(ORG, 320)).map(i => [i.relation, i.title])).toEqual([['repos', '#321 northwind-portal']]);
  });
});

describe('a relation a plugin declares', () => {
  it('shows with no core change: the type names it, core reads it', async () => {
    const t = await types({
      field_note: { 'x-related': [{ key: 'site', label: 'Site visited', from: 'links', field: 'siteId' }] },
    });
    await db.insert(businessObjectSchema).values([
      { id: 330, orgId: ORG, typeId: t.product!, title: 'Bellwater Hall', metadata: {} },
      { id: 331, orgId: ORG, typeId: t.field_note!, title: 'Walkthrough notes', metadata: { siteId: 330 } },
    ]);

    expect((await relatedOf(ORG, 331)).map(i => [i.label, i.title])).toEqual([['Site visited', '#330 Bellwater Hall']]);
  });

  it('a type that declares nothing is connected to what its link fields name', async () => {
    const t = await types({ field_note: { properties: { siteId: { 'x-display': { label: 'Site', to: 'product' } } } } });
    await db.insert(businessObjectSchema).values([
      { id: 340, orgId: ORG, typeId: t.product!, title: 'Contoso Supply depot', metadata: {} },
      { id: 341, orgId: ORG, typeId: t.field_note!, title: 'Depot notes', metadata: { siteId: 340 } },
    ]);

    expect((await relatedOf(ORG, 341)).map(i => [i.label, i.title])).toEqual([['Site', '#340 Contoso Supply depot']]);
  });
});

describe('what a run is connected to', () => {
  it('the chat its feature started in, the feature, its plan, the other attempts, the branch and the pull request', () => {
    const items = runRelatedItems({
      kind: 'worker',
      ref: '435',
      id: 435,
      title: 'Room PDF export',
      objective: null,
      status: 'running',
      attempt: 1,
      startedAt: null,
      endedAt: null,
      cents: null,
      model: null,
      prUrl: 'https://github.com/example/northwind-portal/pull/27',
      error: null,
      summary: null,
      links: [],
      logLinks: { stream: null, stderr: null, checks: {} },
      attach: null,
      progress: { phase: null, note: null, log: [] },
      checks: [],
      failures: [],
      context: {
        origin: { conversationId: 812, title: 'Share menu PDF export', href: '/dashboard/chat?c=812', by: 'Dana Reyes', at: null },
        feature: { id: 301, title: 'Room PDF export', href: '/dashboard/p/feature/301' },
        plan: { id: 302, title: 'Render the room to PDF', href: '/dashboard/objects/302' },
        attempt: { n: 2, of: 3 },
        others: [{ runId: 431, status: 'failed', href: '/dashboard/p/runs/431' }],
        acceptance: null,
        branch: { name: 'factory/northwind-t304', href: 'https://github.com/example/northwind-portal/tree/factory/northwind-t304' },
      },
    });

    expect(items.map(i => [i.label, i.title, i.preview?.type ?? null])).toEqual([
      ['Started in chat', 'Share menu PDF export', 'conversation'],
      ['Feature', '#301 Room PDF export', 'object'],
      ['Plan', '#302 Render the room to PDF', 'object'],
      ['Other attempts', 'Run #431', 'worker_run'],
      ['Branch', 'factory/northwind-t304', null],
      ['Pull request', 'PR #27', null],
    ]);
  });
});

describe('where a record came from, kept on it', () => {
  it('a record created from a conversation carries its origin', async () => {
    await types();
    const obj = await createBusinessObject({ typeSlug: 'request', title: 'Export the ledger as CSV', metadata: {} }, ORG, 'user_dana', { source: 'proposal', conversationId: 77, actor: 'user_dana' });

    expect(obj!.metadata).toMatchObject({ origin: { conversationId: 77, userId: 'user_dana' } });
  });
});
