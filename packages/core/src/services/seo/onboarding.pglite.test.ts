import type { SeoPageRecord } from './records';
import type { SerpResult } from '@/libs/tools/serp/types';
/**
 * Onboarding reads the whole site, and the client's own guides reach the
 * writer — end to end on PGlite, through the tools the SEO seats hold. An
 * uploaded guide filed at three stars lands on the project and its text is
 * in the bundle; a guide's do and don't lines become rules that cite it; the
 * voice block is printed first and checked in code; the site inventory is
 * read from a recorded sitemap and filed on the project; competitors come
 * from searches. The writer and editor hold neither the agency's brand nor a
 * workspace-wide search. Network, SERP vendor and budget are stubbed; every
 * client, site and person here is fictional.
 */
import type { RuntimeContext } from '@/services/agents/types';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/services/BudgetService', () => ({ chargeUsage: vi.fn(async () => {}) }));

const searchSerp = vi.fn();
vi.mock('@/libs/tools/serp/registry', () => ({ searchSerp: (...a: unknown[]) => searchSerp(...a), keywordMetrics: vi.fn() }));

const SITE = 'https://northwind-home.example';
const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'libs', 'tools', 'site', 'fixtures', name), 'utf8');
const TEXT: Record<string, string> = {
  [`${SITE}/sitemap.xml`]: fixture('sitemap-index.xml'),
  [`${SITE}/page-sitemap.xml`]: fixture('page-sitemap.xml'),
  [`${SITE}/blog-sitemaps.xml`]: fixture('blog-sitemaps.xml'),
  [`${SITE}/post-sitemap.xml`]: fixture('post-sitemap.xml'),
};
vi.mock('@/libs/net/publicFetch', async (importActual) => {
  const actual = await importActual<typeof import('@/libs/net/publicFetch')>();
  return {
    ...actual,
    fetchPublic: async (url: string) => {
      if (TEXT[url] === undefined) {
        throw new actual.PublicFetchError('HTTP 404 from northwind-home.example.', 'http', 404);
      }
      return { res: new Response(TEXT[url]), finalUrl: url };
    },
  };
});
vi.mock('@/libs/tools/brand/firecrawlBrand', () => ({
  lookupBrand: vi.fn(async () => ({ url: 'https://northwind-home.example/', name: 'Northwind Home Services', colors: { primary: '#0B3D5C', accent: '#F2A900' }, fonts: { heading: 'Lato' }, logoUrl: 'https://northwind-home.example/logo.png' })),
}));
vi.mock('@/libs/tools/image/remote', () => ({
  fetchImage: vi.fn(async (url: string) => ({ url, bytes: Buffer.from('png'), dataUri: 'data:image/png;base64,cG5n', width: 240, height: 60, contentType: 'image/png' })),
}));
vi.mock('@/libs/tools/artifacts/store', () => ({ saveArtifact: vi.fn(async () => ({ url: '/api/artifacts/x/logo.png' })) }));
vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({
    name: 'builtin',
    fetchHtml: async (url: string) => ({ url, html: `<html><head><title>${url.endsWith('/') && url.length === SITE.length + 1 ? 'Northwind Home Services' : `Page ${new URL(url).pathname}`}</title></head><body><main><h1>Heading</h1><p>Words here.</p></main></body></html>` }),
    fetchPage: async (url: string) => ({ url, title: 'Furnace repair | Northwind Home Services', content: `We repair every make of furnace. Read at ${url}.` }),
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, artifactSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { createDataRoom, getDataRoom } = await import('@/services/DataRoomService');
const { createArtifact } = await import('@/services/ArtifactService');
const { projectTools } = await import('@/services/agents/tools/projects');
const { siteInventoryTools } = await import('@/services/agents/tools/siteInventory');
const { competitorTools } = await import('@/services/agents/tools/competitors');
const { serpTools } = await import('@/services/agents/tools/serpResearch');
const { draftVoiceFindings } = await import('./voiceCheck');
const { brandLookupTool } = await import('@/services/agents/tools/brandLookup');

const ORG = 'proj_seo_onboard_brightline';

const ctx = (over: Partial<RuntimeContext> = {}): RuntimeContext => ({
  orgId: ORG,
  userId: 'usr-onboard-mara',
  agentSlug: 'seo-strategist',
  // No conversation row: the artifacts are filed on the project alone.
  conversationId: undefined,
  connectorSources: [],
  searchConfig: {},
  harnessConfig: { model: 'claude-opus-5-5', grantTools: ['serp', 'site_inventory', 'record_competitors'] },
  enabledPlugins: ['data-rooms', 'wiki', 'seo'],
  emit: () => {},
  ...over,
} as RuntimeContext);

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<unknown> };
async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const c = ctx();
  const all = [...projectTools(c), ...siteInventoryTools(c), ...competitorTools(c), ...serpTools(c), brandLookupTool(c)] as unknown as Invokable[];
  return String(await all.find(t => t.name === name)!.invoke(args));
}

const GUIDE = [
  '# Northwind Home Services — writing guide',
  '',
  'Do: call our people "technicians".',
  'Don\'t: call anything "cheap"; we are fairly priced.',
  'Don\'t: promise same-day service outside the metro.',
  '',
  'Warranty: every repair carries a one-year parts and labour warranty.',
].join('\n');

let projectId = 0;
let guideId = 0;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-onboard', name: 'Brightline Studio', slug: 'brightline-onboard' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-onboard', slug: 'brightline-onboard', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
  projectId = (await createDataRoom(ORG, 'usr-onboard-mara', { title: 'Northwind Home Services', client: 'Northwind Home Services', domains: ['northwind-home.example'] })).id;
  // A PDF dropped in chat: a file artifact holding its extracted text.
  const { artifact } = await createArtifact({
    orgId: ORG,
    kind: 'file',
    title: 'writing-guide.pdf',
    spec: { filename: 'g.pdf', originalName: 'writing-guide.pdf', contentType: 'application/pdf', bytes: 2048, url: '/api/artifacts/x/g.pdf', text: GUIDE },
    author: { kind: 'human', id: 'usr-onboard-mara' },
  });
  guideId = artifact.id;
});

describe('the SEO seats', () => {
  it('withhold the agency\'s brand and the workspace-wide search from the writer and editor, and grant the inventory to the strategist', async () => {
    const res = await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' });

    expect(res.errors).toEqual([]);

    const rows = await db.select({ slug: agentSchema.slug, harness: agentSchema.harnessConfig }).from(agentSchema).where(eq(agentSchema.orgId, ORG));
    const harness = (slug: string) => rows.find(r => r.slug === slug)?.harness as { excludeTools?: string[]; grantTools?: string[] };

    for (const seat of ['seo-writer', 'seo-editor']) {
      expect(harness(seat).excludeTools).toEqual(expect.arrayContaining(['get_brand', 'search_knowledge']));
    }

    expect(harness('seo-strategist').grantTools).toEqual(expect.arrayContaining(['serp', 'site_inventory', 'record_competitors']));
    expect(harness('serp-analyst').grantTools).toEqual(expect.arrayContaining(['serp', 'site_inventory']));
    // Ungranted, neither tool is on an agent's belt.
    expect(siteInventoryTools(ctx({ harnessConfig: {} } as Partial<RuntimeContext>))).toEqual([]);
    expect(competitorTools(ctx({ harnessConfig: {} } as Partial<RuntimeContext>))).toEqual([]);
  });
});

describe('a project is the client', () => {
  it('opens it under the client\'s name, without the app\'s', async () => {
    const out = await call('create_project', { title: 'Larkfield Plumbing — SEO', domains: ['larkfield-plumbing.example'] });

    expect(out).toContain('"Larkfield Plumbing"');
    expect(out).toContain('Named after the client');
  });
});

describe('a client\'s guide reaches the writer', () => {
  it('files an uploaded guide onto the project and prints its text in the bundle', async () => {
    const filed = await call('file_to_project', { project_id: projectId, artifact_id: guideId, title: 'Writing guide', kind: 'attachment', rating: 3, channel: 'upload' });

    expect(filed).toContain('Filed "Writing guide"');

    const [row] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, ORG), eq(artifactSchema.id, guideId)));

    expect(row).toMatchObject({ recordType: 'object', recordId: String(projectId), recordRole: 'source:Writing guide' });

    await call('file_to_project', { project_id: projectId, title: 'Owner\'s notes', kind: 'note', rating: 3, text: 'Never mention the old Springfield office.' });
    const md = await call('read_project', { project_id: projectId });

    expect(md).toContain(`### Writing guide · \`artifact:${guideId}\``);
    expect(md).toContain('Don\'t: promise same-day service outside the metro.');
    expect(md).toContain('Never mention the old Springfield office.');
  });

  it('reads a source whole by id, and finds passages in this project\'s sources only', async () => {
    const page = await call('read_project', { project_id: projectId, source: `artifact:${guideId}`, offset: 10 });

    expect(page).toContain(`"Writing guide" (artifact:${guideId}, ⭐⭐⭐`);
    expect(page).toContain(`characters 10–${GUIDE.length} of ${GUIDE.length}`);
    expect(page).toContain('End of the source.');

    const found = await call('read_project', { project_id: projectId, find: 'warranty labour' });

    expect(found).toContain(`— "Writing guide" (artifact:${guideId}`);
    expect(found).toContain('one-year parts and labour warranty');
    expect(await call('read_project', { project_id: projectId, source: 'doc:999' })).toContain('has no source "doc:999"');
  });

  it('turns the guide\'s do and don\'t lines into rules that cite it', async () => {
    await call('update_project', { project_id: projectId, add_rules: ['Call our people "technicians".', 'Never call anything "cheap".'], rules_source: `artifact:${guideId}` });
    const room = await getDataRoom(ORG, projectId);

    expect(room!.meta.rules).toEqual(expect.arrayContaining([
      `Call our people "technicians". (from "Writing guide", artifact:${guideId})`,
      `Never call anything "cheap". (from "Writing guide", artifact:${guideId})`,
    ]));
  });

  it('keeps a sourced voice block, prints it first, and checks a draft against it in code', async () => {
    const out = await call('update_project', {
      project_id: projectId,
      voice: {
        point_of_view: { text: 'we, to you', source: `${SITE}/about` },
        spelling: { text: 'US', source: `artifact:${guideId}` },
        banned_phrases: [{ text: 'cheap', source: `artifact:${guideId}` }],
        never_claim: [{ text: 'Same-day service outside the metro', source: `artifact:${guideId}`, phrases: ['same-day'] }],
      },
    });

    expect(out).toContain('a voice block of 4 lines');

    const md = await call('read_project', { project_id: projectId });

    expect(md.indexOf('## Client voice')).toBeLessThan(md.indexOf('## Instructions for this project'));
    expect(md).toContain(`- **Never use:** "cheap" (\`artifact:${guideId}\`)`);

    const { artifact: draft } = await createArtifact({ orgId: ORG, kind: 'markdown', title: 'Draft: furnace repair', spec: { md: '# Furnace repair\n\nCheap, same-day furnace repair.' }, author: { kind: 'agent', id: 'agent:seo-writer' } });
    const findings = await draftVoiceFindings(ORG, { id: 1, meta: { projectId, draftArtifactId: draft.id } } as SeoPageRecord);

    expect(findings.map(f => [f.kind, f.phrase])).toEqual([['banned', 'Cheap'], ['never-claim', 'same-day']]);
  });
});

describe('onboarding reads the whole site', () => {
  it('inventories the site from its sitemap and files the table on the project', async () => {
    const out = JSON.parse(await call('site_inventory', { project_id: projectId }));

    expect(out).toMatchObject({ from: 'sitemap', listed: 4, read: 4 });
    expect(out.needsFixing.noMetaDescription).toBe(4);

    const room = await getDataRoom(ORG, projectId);

    expect(room!.meta.siteInventory).toMatchObject({ artifactId: out.inventory.artifactId, site: 'northwind-home.example', pages: 4, from: 'sitemap' });

    const [inv] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, ORG), eq(artifactSchema.id, out.inventory.artifactId)));

    // Filed as one of the project's sources, so it lands on the project.
    expect(inv).toMatchObject({ kind: 'markdown', title: 'Site inventory · northwind-home.example', folder: 'site-inventory', recordType: 'object', recordId: String(projectId), recordRole: 'source:Site inventory · northwind-home.example' });
    expect(room!.meta.sources).toEqual(expect.arrayContaining([expect.objectContaining({ artifactId: out.inventory.artifactId, rating: 2, channel: 'site_inventory' })]));
    expect(String((inv!.spec as { md: string }).md)).toContain('| 4 | [/blog/ac-tune-up-checklist/](https://northwind-home.example/blog/ac-tune-up-checklist/) | 200 |');
    expect(await call('read_project', { project_id: projectId })).toContain(`Site inventory: [northwind-home.example, read ${room!.meta.siteInventory!.readAt.slice(0, 10)}](/dashboard/artifacts/${out.inventory.artifactId}) — 4 pages from the sitemap`);

    // Read again: the same artifact, a new version, one source.
    const again = JSON.parse(await call('site_inventory', { project_id: projectId }));
    const [after] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, ORG), eq(artifactSchema.id, out.inventory.artifactId)));

    expect(again.inventory.artifactId).toBe(out.inventory.artifactId);
    expect(after!.currentVersion).toBe(2);
    expect((await getDataRoom(ORG, projectId))!.meta.sources!.filter(s => s.channel === 'site_inventory')).toHaveLength(1);
  });

  it('files each page it read as a source with its URL and date, once per URL', async () => {
    const url = `${SITE}/furnace-repair`;
    const first = await call('file_to_project', { project_id: projectId, url, kind: 'page', rating: 2 });

    expect(first).toContain('Filed "Furnace repair | Northwind Home Services" (page, ⭐⭐, via web)');

    await call('file_to_project', { project_id: projectId, url, kind: 'page', rating: 2 });
    const pages = (await getDataRoom(ORG, projectId))!.meta.sources!.filter(s => s.url === url);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ kind: 'page', rating: 2, url });

    const md = await call('read_project', { project_id: projectId, source: `artifact:${pages[0]!.artifactId}` });

    expect(md).toContain(`Read from ${url} on`);
    expect(md).toContain('We repair every make of furnace.');
  });

  it('keeps the brand read off the site on the project, logo included', async () => {
    const out = JSON.parse(await call('brand_lookup', { company: 'northwind-home.example', project_id: projectId }));

    expect(out.project).toContain(`colours, fonts and name kept on project #${projectId}; the logo fetched and kept as its logo`);

    const brand = (await getDataRoom(ORG, projectId))!.meta.brand!;

    expect(brand.profile).toMatchObject({ source: 'https://northwind-home.example/', name: 'Northwind Home Services', colors: { primary: '#0B3D5C', accent: '#F2A900' }, fonts: { heading: 'Lato' } });
    expect(brand.logo).toMatchObject({ source: 'https://northwind-home.example/logo.png', url: '/api/artifacts/x/logo.png' });

    const md = await call('read_project', { project_id: projectId });

    expect(md).toMatch(/- \*\*Colours:\*\* .*primary #0B3D5C/);
    expect(md).toContain('- **logo** — [logo](/api/artifacts/x/logo.png)');
  });

  it('records competitors counted from searches, never guessed', async () => {
    const results: Record<string, string[]> = {
      'furnace repair springfield': ['yelp.com', 'kestrel-heating.example', 'northwind-home.example'],
      'ac installation springfield': ['kestrel-heating.example', 'angi.com', 'contoso-air.example'],
      'heat pump springfield': ['contoso-air.example', 'larkfield-plumbing.example'],
    };
    searchSerp.mockImplementation(async ({ query, location }: { query: string; location?: string }): Promise<SerpResult> => ({
      query,
      location,
      provider: 'serper',
      isGoogleRanking: true,
      device: 'desktop',
      organic: results[query]!.map((domain, i) => ({ position: i + 1, url: `https://${domain}/${i}`, domain, title: domain, snippet: '' })),
      peopleAlsoAsk: [],
      relatedSearches: [],
      adsCount: 0,
      retrievedAt: '2026-10-27T15:00:00.000Z',
      billedUnits: 1,
    }));
    const ids: string[] = [];
    for (const query of Object.keys(results)) {
      ids.push(JSON.parse(await call('serp_search', { query, location: 'Springfield, Illinois, United States' })).serpResultId);
    }

    const out = JSON.parse(await call('record_competitors', { project_id: projectId, serp_result_ids: ids }));

    expect(out.competitors.map((c: { domain: string }) => c.domain)).toEqual(['kestrel-heating.example', 'contoso-air.example']);

    const md = await call('read_project', { project_id: projectId });

    expect(md).toContain('## Competitors');
    expect(md).toContain('- **kestrel-heating.example** — "ac installation springfield" #1 ([page](https://kestrel-heating.example/0)); "furnace repair springfield" #2 ([page](https://kestrel-heating.example/1))');
    expect(md).not.toContain('**yelp.com**');
    expect(await call('record_competitors', { project_id: projectId, serp_result_ids: ['serp_000000000000', 'serp_111111111111'] })).toContain('Not recorded');
  });
});
