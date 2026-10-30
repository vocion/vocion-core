import type { SerpResult } from '@/libs/tools/serp/types';
/**
 * The Keywords register on PGlite: research done in a chat leaves its rows
 * behind (kept by the research tools in code, one per keyword per project,
 * refreshed and never duplicated), planning a batch from ticked keywords
 * links them to their batch and pages, a topic plan puts its keywords in the
 * register too, and each keyword follows its page — a revised plan unlinks
 * what it left out, a discarded plan drops them, a published page that
 * Google shows is ranking. Google and the keyword provider are mocked; every
 * client, person and site here is fictional.
 */
import type { RuntimeContext } from '@/services/agents/types';
import type { Ask } from '@/services/AskService';
import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/services/EventService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/EventService')>();
  return { ...actual, emitEvent: vi.fn(async () => ({ eventId: 0, dispatched: [] })) };
});
// Google's results and the keyword numbers, as the providers would hand them back.
const serps = vi.hoisted(() => ({ read: new Map<string, { at: string; organic: Array<{ url: string; title: string }> }>() }));
vi.mock('@/libs/tools/serp/registry', () => ({
  searchSerp: vi.fn(async (q: { query: string; location?: string }): Promise<SerpResult> => {
    const page = serps.read.get(q.query.toLowerCase()) ?? { at: '2026-10-20T10:00:00.000Z', organic: [] };
    return {
      query: q.query,
      provider: 'serper',
      isGoogleRanking: true,
      ...(q.location ? { location: q.location } : {}),
      device: 'desktop',
      organic: page.organic.map((o, i) => ({ position: i + 1, url: o.url, domain: new URL(o.url).hostname.replace(/^www\./, ''), title: o.title, snippet: '' })),
      peopleAlsoAsk: [],
      relatedSearches: [],
      adsCount: null,
      retrievedAt: page.at,
      billedUnits: 0,
    };
  }),
  keywordMetrics: vi.fn(async (keywords: string[]) => ({
    ok: true,
    result: { provider: 'dataforseo', location: 'United States', language: 'en', retrievedAt: '2026-10-21T09:00:00.000Z', billedUnits: 0, metrics: keywords.map((k, i) => ({ keyword: k, searchVolume: 1000 - i * 100, cpc: 4.5, competition: 'MEDIUM', competitionIndex: 40 + i })) },
  })),
  keywordIdeas: vi.fn(async () => ({ ok: false, reason: 'not in this test' })),
}));

// Load the mocked bus once, before the install saves the playbook copies:
// several first imports at once can build the mock from a half-loaded module.
await import('@/services/EventService');
const { db } = await import('@/libs/DB');
const { askSchema, businessObjectSchema, missionRunSchema, projectSchema, tenantAccountSchema, toolCallSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { getObjectTypeBySlug } = await import('@/services/BusinessObjectService');
const { createDataRoom } = await import('@/services/DataRoomService');
const { seoTools } = await import('@/services/agents/tools/seo');
const { clearSerpRunCache, serpTools } = await import('@/services/agents/tools/serpResearch');
const { researchSource } = await import('@/services/agents/tools/keywordRegister');
const { getSeoPage, listSeoPages, patchSeoPage, planSeoBatch, refreshSeoBatch } = await import('./records');
const { keepKeywords, listProjectKeywords, SEO_KEYWORD_TYPE } = await import('./keywords');
const { onSeoAskSettled } = await import('./signoff');

const ORG = 'proj_seo_keywords_brightline';
const PERSON = 'usr-seo-ines';
const CONVERSATION = 9301;

const ctx = (over: Partial<RuntimeContext> = {}): RuntimeContext => ({
  orgId: ORG,
  userId: PERSON,
  agentSlug: 'seo-strategist',
  conversationId: CONVERSATION,
  connectorSources: [],
  searchConfig: {},
  harnessConfig: { model: 'claude-opus-5-5', grantTools: ['serp'] },
  enabledPlugins: ['data-rooms', 'wiki', 'seo'],
  objectTypeSlugs: ['seo_batch', 'seo_page', 'data_room'],
  emit: () => {},
  ...over,
} as RuntimeContext);

async function call(name: string, args: Record<string, unknown>, over: Partial<RuntimeContext> = {}): Promise<string> {
  const c = ctx(over);
  const t = [...seoTools(c), ...serpTools(c)].find(x => x.name === name)! as unknown as { invoke: (input: Record<string, unknown>) => Promise<unknown> };
  return String(await t.invoke(args));
}

const byKeyword = async (projectId: number) => new Map((await listProjectKeywords(ORG, projectId)).map(r => [r.meta.keyword.toLowerCase(), r]));

let northwind = 0;
let kestrel = 0;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-seo-kw', name: 'Brightline Studio', slug: 'brightline-seo-kw' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-seo-kw', slug: 'brightline-kw', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
  const res = await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:ines' });

  expect(res.errors).toEqual([]);

  northwind = (await createDataRoom(ORG, PERSON, { title: 'Northwind Home Services', domains: ['northwind-home.example'] })).id;
  kestrel = (await createDataRoom(ORG, PERSON, { title: 'Kestrel Gear' })).id;
  serps.read.set('boiler repair riverton', { at: '2026-10-20T10:00:00.000Z', organic: [
    { url: 'https://www.boilerhub.example/riverton', title: 'Boiler repair in Riverton' },
    { url: 'https://yelp.example/riverton-boilers', title: 'Top 10 boiler repair Riverton' },
    { url: 'https://northwind-home.example/boilers', title: 'Boilers | Northwind' },
  ] });
});

describe('the register the SEO app installs', () => {
  it('is a record type, and the Keywords page reads it', async () => {
    expect(await getObjectTypeBySlug(ORG, SEO_KEYWORD_TYPE)).toBeTruthy();
  });
});

describe('research in a chat leaves its rows behind', () => {
  it('keeps what serp_search read for the project it names: the top results with their date, and where the client ranks', async () => {
    const out = JSON.parse(await call('serp_search', { query: 'boiler repair riverton', project_id: northwind }));

    expect(out.keywords).toEqual({ kept: 1, new: 1, project: 'Northwind Home Services', href: `/dashboard/p/seo-keywords?project=${northwind}` });

    const row = (await byKeyword(northwind)).get('boiler repair riverton')!;

    expect(row.meta).toMatchObject({
      projectId: northwind,
      projectName: 'Northwind Home Services',
      status: 'idea',
      statusLabel: 'Idea',
      source: 'chat',
      serpCheckedAt: '2026-10-20T10:00:00.000Z',
      checkedAt: '2026-10-20T10:00:00.000Z',
      clientPosition: 3,
      clientUrl: 'https://northwind-home.example/boilers',
    });
    expect(row.meta.topResults?.map(r => r.position)).toEqual([1, 2, 3]);
  });

  it('refreshes the same row on a later read, whatever the spelling, and never adds one', async () => {
    serps.read.set('boiler repair, riverton', { at: '2026-10-27T10:00:00.000Z', organic: [{ url: 'https://www.boilerhub.example/riverton', title: 'Boiler repair in Riverton' }] });
    const out = JSON.parse(await call('serp_search', { query: 'Boiler repair, Riverton', project_id: northwind }));

    expect(out.keywords).toMatchObject({ kept: 1, new: 0 });

    const rows = (await listProjectKeywords(ORG, northwind)).filter(r => r.meta.keywordKey === 'boiler repair riverton');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toMatchObject({ serpCheckedAt: '2026-10-27T10:00:00.000Z', checkedAt: '2026-10-27T10:00:00.000Z' });
    // Not in the results read this time: no position, and the date says when.
    expect(rows[0]!.meta.clientPosition).toBeUndefined();
  });

  it('makes one row when two reads of a new keyword land at once', async () => {
    const read = { keyword: 'combi boiler repair', metrics: { checkedAt: '2026-10-21T09:00:00.000Z', volume: 320, competition: 'LOW', competitionIndex: 12, cpc: 3 } };
    const [a, b] = await Promise.all([
      keepKeywords(ORG, northwind, [read], { source: 'chat', by: PERSON }),
      keepKeywords(ORG, northwind, [read], { source: 'chat', by: PERSON }),
    ]);

    expect(a!.rows[0]!.id).toBe(b!.rows[0]!.id);
    expect([a!.rows[0]!.created, b!.rows[0]!.created].filter(Boolean)).toHaveLength(1);

    const stored = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.externalId, `${northwind}:combi boiler repair`)));

    expect(stored).toHaveLength(1);
  });

  it('keeps clusters and volumes for the project the conversation was working on when the call names none', async () => {
    await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'seo-strategist', tool: 'read_project', input: { project_id: northwind }, conversationId: CONVERSATION });
    serps.read.set('boiler servicing', { at: '2026-10-22T08:00:00.000Z', organic: [{ url: 'https://a.example/1', title: 'a' }, { url: 'https://b.example/2', title: 'b' }, { url: 'https://c.example/3', title: 'c' }] });
    serps.read.set('annual boiler service', { at: '2026-10-22T08:00:00.000Z', organic: [{ url: 'https://a.example/1', title: 'a' }, { url: 'https://b.example/2', title: 'b' }, { url: 'https://c.example/3', title: 'c' }] });
    serps.read.set('why is my boiler losing pressure', { at: '2026-10-22T08:00:00.000Z', organic: [{ url: 'https://d.example/1', title: 'd' }] });
    clearSerpRunCache();
    const clustered = JSON.parse(await call('keyword_cluster', { keywords: ['boiler servicing', 'annual boiler service', 'why is my boiler losing pressure'] }));

    expect(clustered.keywords).toMatchObject({ kept: 3, new: 3, project: 'Northwind Home Services' });

    const metrics = JSON.parse(await call('keyword_metrics', { keywords: ['boiler servicing', 'why is my boiler losing pressure'], ideas: false, project_id: northwind }));

    expect(metrics.keywords).toMatchObject({ kept: 2, new: 0 });

    const rows = await byKeyword(northwind);

    expect(rows.get('annual boiler service')!.meta).toMatchObject({ cluster: 'boiler servicing', clusterCheckedAt: '2026-10-22T08:00:00.000Z' });
    expect(rows.get('boiler servicing')!.meta).toMatchObject({ volume: 1000, competition: 'medium', competitionIndex: 40, metricsCheckedAt: '2026-10-21T09:00:00.000Z', checkedAt: '2026-10-22T08:00:00.000Z' });
    expect(rows.get('why is my boiler losing pressure')!.meta).toMatchObject({ volume: 900, cluster: 'why is my boiler losing pressure' });
  });

  it('keeps nothing when nothing says which project, and says to name it', async () => {
    const out = JSON.parse(await call('serp_search', { query: 'boiler repair riverton' }, { conversationId: 9399 }));

    expect(out.keywords).toBe('Not kept in a Keywords register: name the client project (project_id) and what you research is kept there.');
  });

  it('keeps one row per project: another client researching the same keyword gets its own', async () => {
    await call('serp_search', { query: 'boiler repair riverton', project_id: kestrel });

    expect((await listProjectKeywords(ORG, kestrel)).map(r => r.meta.keyword)).toEqual(['boiler repair riverton']);
    expect((await listProjectKeywords(ORG, northwind)).filter(r => r.meta.keywordKey === 'boiler repair riverton')).toHaveLength(1);
  });

  it('says where a background run\'s research came from: the weekly opportunities check, or not', async () => {
    const team = { lead: 'seo-strategist', members: [] };
    const [weekly] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'SEO', brief: `TRIGGER PAYLOAD, the event that started this check (JSON):\n${JSON.stringify({ reason: 'opportunities', projectId: northwind, pages: 2 }, null, 2)}`, team }).returning();
    const [writing] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'SEO', brief: JSON.stringify({ reason: 'write', batchId: 1 }, null, 2), team }).returning();

    expect(await researchSource(ctx({ missionRunId: weekly!.id }))).toBe('weekly');
    expect(await researchSource(ctx({ missionRunId: writing!.id }))).toBe('chat');
    expect(await researchSource(ctx())).toBe('chat');

    const out = JSON.parse(await call('serp_search', { query: 'boiler flue repair' }, { missionRunId: weekly!.id, userId: undefined }));

    expect(out.keywords).toMatchObject({ kept: 1, new: 1, project: 'Northwind Home Services' });
    expect((await byKeyword(northwind)).get('boiler flue repair')!.meta.source).toBe('weekly');
  });
});

let fromKeywords = 0;

describe('planning a batch from ticked keywords', () => {
  it('refuses rows of two clients, and rows that are not keywords', async () => {
    const theirs = (await listProjectKeywords(ORG, kestrel))[0]!.id;
    const ours = (await byKeyword(northwind)).get('boiler servicing')!.id;

    expect(await call('seo_plan_batch', { topic: 'Boiler care', keyword_ids: [ours, theirs] })).toContain('one batch is one client\'s');
    expect(await call('seo_plan_batch', { topic: 'Boiler care', keyword_ids: [ours, 999999] })).toContain('#999999 is not a keyword');
  });

  it('plans one page per row in the order ticked, and puts each row in the batch, linked to its page', async () => {
    const rows = await byKeyword(northwind);
    const ids = [rows.get('boiler servicing')!.id, rows.get('why is my boiler losing pressure')!.id];
    const out = await call('seo_plan_batch', { topic: 'Boiler care', keyword_ids: ids });
    fromKeywords = Number(/batch #(\d+)/.exec(out)![1]);

    expect(out).toContain('Each keyword is in the project\'s Keywords register, in this batch');

    const pages = await listSeoPages(ORG, fromKeywords);

    expect(pages.map(p => p.meta.keyword)).toEqual(['boiler servicing', 'why is my boiler losing pressure']);
    expect(pages[0]!.meta).toMatchObject({ projectId: northwind, volume: 1000, cluster: 'boiler servicing' });

    const after = await byKeyword(northwind);

    expect(after.get('boiler servicing')!.meta).toMatchObject({ status: 'in_batch', statusLabel: 'In a batch', batchId: fromKeywords, pageId: pages[0]!.id, batchTitle: 'Northwind Home Services: Boiler care' });
    expect(after.get('why is my boiler losing pressure')!.meta).toMatchObject({ status: 'in_batch', batchId: fromKeywords, pageId: pages[1]!.id });
    // Rows not ticked stay ideas.
    expect(after.get('annual boiler service')!.meta.status).toBe('idea');
  });

  it('takes page types from the plan when it gives them, and refuses a ticked keyword it left out', async () => {
    const rows = await byKeyword(northwind);
    const id = rows.get('combi boiler repair')!.id;

    expect(await call('seo_plan_batch', { project_id: northwind, topic: 'Combi', keyword_ids: [id], pages: [{ keyword: 'combi boiler installation', page_type: 'service' }] })).toContain('"combi boiler repair" is in keyword_ids but not in pages');
  });

  it('a revised plan unlinks the keyword it left out, which is an idea again', async () => {
    const out = await call('seo_plan_batch', { batch_id: fromKeywords, topic: 'Boiler care', pages: [{ keyword: 'boiler servicing', page_type: 'service' }] });

    expect(out).toContain('Revised the keyword plan');

    const rows = await byKeyword(northwind);
    const [kept] = await listSeoPages(ORG, fromKeywords);

    expect(rows.get('boiler servicing')!.meta).toMatchObject({ status: 'in_batch', pageId: kept!.id });
    expect(rows.get('why is my boiler losing pressure')!.meta).toMatchObject({ status: 'idea', statusLabel: 'Idea' });
    expect(rows.get('why is my boiler losing pressure')!.meta.pageId).toBeUndefined();
    expect(rows.get('why is my boiler losing pressure')!.meta.batchId).toBeUndefined();
  });

  it('a plan a person discards drops its keywords; a restore makes one an idea that stays one', async () => {
    const [ask] = (await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), like(askSchema.sourceRef, `seo-plan:${fromKeywords}:%`)))).sort((a, b) => b.id - a.id);
    const [row] = await db.update(askSchema).set({ status: 'rejected', decision: 'reject', decidedBy: PERSON, decidedAt: new Date() }).where(eq(askSchema.id, ask!.id)).returning();
    await onSeoAskSettled(row as Ask);

    const dropped = (await byKeyword(northwind)).get('boiler servicing')!;

    expect(dropped.meta).toMatchObject({ status: 'dropped', statusLabel: 'Dropped', batchId: fromKeywords });
    expect(await call('seo_plan_batch', { topic: 'Boiler care', keyword_ids: [dropped.id] })).toContain('"boiler servicing" was dropped');

    expect(await call('seo_update_keywords', { keyword_ids: [dropped.id], restore: true, why: 'The client now services boilers year round.' })).toContain('written');

    await refreshSeoBatch(ORG, fromKeywords);
    const restored = (await byKeyword(northwind)).get('boiler servicing')!.meta;

    expect(restored).toMatchObject({ status: 'idea', why: { text: 'The client now services boilers year round.', by: PERSON } });
    expect(restored.why!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(restored.pageId).toBeUndefined();
  });
});

describe('a topic plan writes its keywords into the register', () => {
  let batchId = 0;

  it('puts every planned keyword in the register, new ones made, existing ones linked', async () => {
    const out = await call('seo_plan_batch', {
      project_id: northwind,
      topic: 'Boiler repair',
      pages: [
        { keyword: 'boiler repair riverton', page_type: 'location', location: 'Riverton', intent: 'transactional' },
        { keyword: 'boiler repair lakeside', page_type: 'location', location: 'Lakeside', intent: 'transactional' },
      ],
    });
    batchId = Number(/batch #(\d+)/.exec(out)![1]);
    const rows = await byKeyword(northwind);

    expect(rows.get('boiler repair riverton')!.meta).toMatchObject({ status: 'in_batch', batchId, source: 'chat', serpCheckedAt: '2026-10-27T10:00:00.000Z' });
    expect(rows.get('boiler repair lakeside')!.meta).toMatchObject({ status: 'in_batch', batchId, source: 'chat', intent: 'transactional' });
    expect((await listProjectKeywords(ORG, northwind)).filter(r => r.meta.keywordKey === 'boiler repair riverton')).toHaveLength(1);
  });

  it('a published page publishes its keyword, links the SERP brief on the page, and Google showing the client makes it ranking', async () => {
    const page = (await listSeoPages(ORG, batchId))[0]!;
    await patchSeoPage(ORG, page, { status: 'published', publishedUrl: 'https://northwind-home.example/riverton/boiler-repair', serpArtifactId: 77 });
    await refreshSeoBatch(ORG, batchId);

    expect((await byKeyword(northwind)).get('boiler repair riverton')!.meta).toMatchObject({ status: 'published', publishedUrl: 'https://northwind-home.example/riverton/boiler-repair', serpArtifactId: 77 });
    expect((await getSeoPage(ORG, page.id))!.meta.serpArtifactId).toBe(77);

    serps.read.set('boiler repair riverton!', { at: '2026-11-03T10:00:00.000Z', organic: [{ url: 'https://www.boilerhub.example/riverton', title: 'x' }, { url: 'https://northwind-home.example/riverton/boiler-repair', title: 'Boiler repair in Riverton | Northwind' }] });
    await call('serp_search', { query: 'boiler repair riverton!', project_id: northwind });

    expect((await byKeyword(northwind)).get('boiler repair riverton')!.meta).toMatchObject({ status: 'ranking', statusLabel: 'Ranking', clientPosition: 2, serpCheckedAt: '2026-11-03T10:00:00.000Z' });
  });

  it('refuses to drop a keyword whose page is in a batch, and drops an idea with its why', async () => {
    const rows = await byKeyword(northwind);
    const out = await call('seo_update_keywords', { keyword_ids: [rows.get('boiler repair lakeside')!.id, rows.get('annual boiler service')!.id], drop: true, why: 'Same results as boiler servicing; one page covers both.' });

    expect(out).toContain('"boiler repair lakeside": not dropped, its page is in a batch');
    expect(out).toContain('"annual boiler service": written.');

    const after = await byKeyword(northwind);

    expect(after.get('boiler repair lakeside')!.meta.status).toBe('in_batch');
    expect(after.get('annual boiler service')!.meta).toMatchObject({ status: 'dropped', why: { text: 'Same results as boiler servicing; one page covers both.' } });
    expect(await call('seo_update_keywords', { keyword_ids: [after.get('annual boiler service')!.id], drop: true })).toContain('say why');
  });

  it('lists a project\'s register with each fact\'s date, narrowed by status', async () => {
    const out = JSON.parse(await call('seo_list_keywords', { project_id: northwind, status: ['ranking', 'dropped'] }));

    expect(out.keywords.map((k: { keyword: string }) => k.keyword).sort()).toEqual(['annual boiler service', 'boiler repair riverton']);
    expect(out.keywords.find((k: { keyword: string }) => k.keyword === 'boiler repair riverton')).toMatchObject({ status: 'ranking', clientPosition: 2, resultsRead: '2026-11-03' });
  });
});

describe('the weekly opportunities plan', () => {
  it('enters its keywords in the register as weekly', async () => {
    await planSeoBatch(ORG, 'agent:seo-strategist', { projectId: kestrel, topic: 'Trail shoes', pages: [{ keyword: 'trail running shoes for wide feet' }], source: 'weekly' });

    expect((await listProjectKeywords(ORG, kestrel)).find(r => r.meta.keyword === 'trail running shoes for wide feet')!.meta).toMatchObject({ source: 'weekly', status: 'in_batch' });
  });
});
