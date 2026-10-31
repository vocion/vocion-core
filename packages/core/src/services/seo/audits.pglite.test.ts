import type { SerpResult } from '@/libs/tools/serp/types';
import type { RuntimeContext } from '@/services/agents/types';
/**
 * The Audits register, end to end on PGlite through the strategist's tools:
 * a run reads a recorded site, files its findings as an `seo_audit` record
 * with a shareable report; the same run filed twice is one row; a second run
 * carries a dismissal forward and marks fixed on the first what it no longer
 * finds; a finding's Fix it makes a task or plans a page and is linked to it;
 * status moves are checked. Network and SERP are stubbed; every client and
 * site is fictional.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/services/BudgetService', () => ({ chargeUsage: vi.fn(async () => {}) }));

const SITE = 'https://fernwood-plumbing.example';
let robotsUnavailable = false;
let robots = 'User-agent: GPTBot\nDisallow: /\n';
const TEXT: Record<string, () => string> = {
  [`${SITE}/sitemap.xml`]: () => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url><url><loc>${SITE}/drains</loc></url><url><loc>${SITE}/leaks</loc></url></urlset>`,
  [`${SITE}/robots.txt`]: () => robots,
};
vi.mock('@/libs/net/publicFetch', async (importActual) => {
  const actual = await importActual<typeof import('@/libs/net/publicFetch')>();
  return {
    ...actual,
    fetchPublic: async (url: string) => {
      if (robotsUnavailable && url.endsWith('/robots.txt')) {
        throw new Error('Temporary network outage');
      }
      if (!TEXT[url]) {
        throw new actual.PublicFetchError('HTTP 404 from fernwood-plumbing.example.', 'http', 404);
      }
      return { res: new Response(TEXT[url]()), finalUrl: url };
    },
  };
});
const HOME = `<html lang="en"><head><title>Fernwood Plumbing</title><meta name="description" content="Plumbers in Fairview"><script type="application/ld+json">{"@type":"Organization","name":"Fernwood Plumbing","description":"Plumbing repairs in Fairview"}</script></head><body><main><h1>Fernwood Plumbing</h1><p>${'words '.repeat(400)}</p></main></body></html>`;
vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({
    name: 'builtin',
    fetchHtml: async (url: string) => ({ url, html: url === `${SITE}/` ? HOME : `<html><head><title>Plumbing services</title><meta name="description" content="Plumbing"></head><body><main><h1>Plumbing services</h1><p>${'word '.repeat(500)}</p></main></body></html>` }),
  }),
}));
const searchSerp = vi.fn(async ({ query }: { query: string }): Promise<SerpResult> => ({
  query,
  provider: 'serper',
  isGoogleRanking: true,
  device: 'desktop',
  organic: [{ position: 1, url: 'https://pipes-directory.example/fernwood', domain: 'pipes-directory.example', title: 'x', snippet: '' }, { position: 2, url: `${SITE}/`, domain: 'fernwood-plumbing.example', title: 'Fernwood', snippet: '' }],
  peopleAlsoAsk: [],
  relatedSearches: [],
  adsCount: 0,
  retrievedAt: '2026-10-29T15:00:00.000Z',
  billedUnits: 1,
} as SerpResult));
vi.mock('@/libs/tools/serp/registry', () => ({ searchSerp: (q: { query: string }) => searchSerp(q), keywordMetrics: vi.fn() }));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { createDataRoom, getDataRoomDetail, updateDataRoom } = await import('@/services/DataRoomService');
const { seoRunAuditTool, seoUpdateFindingsTool } = await import('@/services/agents/tools/seoAudit');
const { fileAudit, getAudit, listProjectAudits, moveFindings } = await import('./audits');
const { eq } = await import('drizzle-orm');

const ORG = 'proj_seo_audits_brightline';
let projectId = 0;

const progressNotes: string[] = [];
const ctx = { orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', conversationId: undefined, connectorSources: [], searchConfig: {}, harnessConfig: { model: 'claude-opus-5-5', grantTools: ['serp', 'site_inventory'] }, enabledPlugins: ['data-rooms', 'wiki', 'seo'], emit: (event: { type: string; note?: string }) => {
  if (event.type === 'step_progress' && event.note) {
    progressNotes.push(event.note);
  }
} } as unknown as RuntimeContext;
const run = async () => JSON.parse(String(await seoRunAuditTool(ctx).invoke({ project_id: projectId }))) as { audit: { id: number }; report: { artifactId: number } | null; counts: { open: number; high: number }; recommendedNextSteps: string[]; findings: Array<{ key: string; status: string }>; fixedSinceLastRun?: string };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-audits', name: 'Brightline Studio', slug: 'brightline-audits' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-audits', slug: 'brightline-audits', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });

  expect((await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' })).errors).toEqual([]);

  projectId = (await createDataRoom(ORG, 'usr-mara', { title: 'Fernwood Plumbing', client: 'Fernwood Plumbing', domains: ['fernwood-plumbing.example'] })).id;
  await updateDataRoom(ORG, projectId, { seoProfile: { clientType: 'local_services', goals: ['google_business_profile', 'organic_leads'], industry: 'Plumbing', offering: 'Plumbing repairs', locations: ['Fairview', 'Lakeside'] } });
});

describe('an audit run', () => {
  it('files its findings as one seo_audit record with a report, and lists it on the project', async () => {
    const out = await run();

    expect(out.report?.artifactId).toBeGreaterThan(0);
    expect(progressNotes).toContain('Finding sitemap and linked pages');
    expect(progressNotes).toContain('Checking robots.txt crawler access');
    expect(progressNotes).toContain(`Found ${out.findings.length} finding groups, ${out.counts.high} high priority; saving evidence`);
    expect(progressNotes.at(-1)).toBe('Audit findings saved; building the shareable report');
    expect(out.counts.high).toBeGreaterThan(0);
    expect(out.recommendedNextSteps[0]).toMatch(/LocalBusiness schema|AI answer engines/);

    const keys = out.findings.map(f => f.key);

    expect(keys).toEqual(expect.arrayContaining(['brand_not_first', 'ai_crawlers_blocked', 'no_local_schema', 'no_location_page:fairview', 'no_location_page:lakeside', 'duplicate_title:plumbing services', 'duplicate_h1:plumbing services']));
    // The home page declares Organization schema that says what the business does.
    expect(keys).not.toContain('no_org_schema');
    expect(keys).not.toContain('org_description_stale');

    const audit = (await getAudit(ORG, out.audit.id))!;

    expect(audit.meta).toMatchObject({ projectId, projectName: 'Fernwood Plumbing', site: SITE, reportArtifactId: out.report!.artifactId });
    expect(audit.meta.report).toContain(`audit%20%23${audit.id}`);

    const detail = await getDataRoomDetail(ORG, projectId);

    expect(detail!.work?.some(w => w.id === audit.id)).toBe(true);
  });

  it('is one row however often the same run is filed', async () => {
    const [first] = await listProjectAudits(ORG, projectId);
    const again = await fileAudit(ORG, { project: { id: projectId, title: 'Fernwood Plumbing' }, site: SITE, checkedAt: first!.meta.checkedAt, findings: first!.meta.findings, pagesRead: 3, by: 'usr-mara' });

    expect(again?.created).toBe(false);
    expect(again?.audit.id).toBe(first!.id);
    expect(await listProjectAudits(ORG, projectId)).toHaveLength(1);
  });

  it('moves a finding only as its status allows, and says why when not', async () => {
    const [audit] = await listProjectAudits(ORG, projectId);
    const update = (args: Record<string, unknown>) => seoUpdateFindingsTool(ctx).invoke({ audit_id: audit!.id, ...args } as never).then(String);

    expect(await update({ findings: ['duplicate_h1:plumbing services'], action: 'dismiss' })).toMatch(/a dismissal says why/);
    expect(await update({ findings: ['duplicate_h1:plumbing services'], action: 'dismiss', note: 'one template, fixed in the theme later' })).toMatch(/duplicate_h1:plumbing services: dismissed/);
    expect(await update({ findings: ['duplicate_h1:plumbing services'], action: 'mark_fixed' })).toMatch(/not changed \(it is dismissed; reopen it first\)/);
    expect(await update({ findings: ['nope'], action: 'reopen' })).toMatch(/"nope" is not a finding/);

    const moved = (await getAudit(ORG, audit!.id))!.meta.findings.find(f => f.key === 'duplicate_h1:plumbing services')!;

    // The agent dismissed it in the person's chat: recorded as the agent's act, never under the person's id.
    expect(moved).toMatchObject({ status: 'dismissed', statusBy: 'agent:seo-strategist', statusNote: 'one template, fixed in the theme later' });
  });

  it('fixes a finding as a task on the project, or a page planned in a batch, and links it', async () => {
    const [audit] = await listProjectAudits(ORG, projectId);
    const update = (args: Record<string, unknown>) => seoUpdateFindingsTool(ctx).invoke({ audit_id: audit!.id, ...args } as never).then(String);

    expect(await update({ findings: ['ai_crawlers_blocked'], action: 'make_task' })).toMatch(/Made 1 task on the project: ai_crawlers_blocked → task #\d+/);
    expect(await update({ findings: ['no_location_page:lakeside'], action: 'plan_page' })).toMatch(/Planned batch #\d+ with 1 page/);
    expect(await update({ findings: ['brand_not_first'], action: 'plan_page' })).toMatch(/suggests no page/);

    const after = (await getAudit(ORG, audit!.id))!;
    const f = Object.fromEntries(after.meta.findings.map(x => [x.key, x]));

    expect(f.ai_crawlers_blocked!.fix).toMatchObject({ kind: 'task', href: expect.stringMatching(/^\/dashboard\/inbox\/\d+$/) });
    expect(f['no_location_page:lakeside']!.fix).toMatchObject({ kind: 'page' });

    const [page] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, f['no_location_page:lakeside']!.fix!.id));

    expect(page!.metadata).toMatchObject({ projectId, keyword: 'plumbing lakeside', pageType: 'location', location: 'Lakeside' });
    expect(after.meta.report).toContain('[planned page linked; finding still open](/dashboard/objects/');
    // Linked to its fix, but still open until a run no longer finds it.
    expect(f.ai_crawlers_blocked!.status).toBe('open');
    expect(await update({ findings: ['ai_crawlers_blocked'], action: 'make_task' })).toMatch(/Nothing to fix: ai_crawlers_blocked \(already fixed by a task/);
  });

  it('a later run carries the dismissal forward and marks fixed on the first run what it no longer finds', async () => {
    robots = 'User-agent: *\nAllow: /\n';
    const [first] = await listProjectAudits(ORG, projectId);
    await new Promise(r => setTimeout(r, 5));

    const out = await run();

    expect(out.audit.id).not.toBe(first!.id);
    expect(out.fixedSinceLastRun).toMatch(/^1 findings the run of \d{4}-\d{2}-\d{2} had open are no longer found/);
    expect(out.findings.find(f => f.key === 'duplicate_h1:plumbing services')?.status).toBe('dismissed');

    const was = (await getAudit(ORG, first!.id))!.meta.findings.find(f => f.key === 'ai_crawlers_blocked')!;

    expect(was).toMatchObject({ status: 'fixed', statusNote: expect.stringMatching(/^not found on the run of/) });
    expect(await listProjectAudits(ORG, projectId)).toHaveLength(2);
    expect((await moveFindings(ORG, out.audit.id, ['no_local_schema'], { kind: 'mark_fixed' }, { by: 'usr-mara' }))[0]).toEqual({ key: 'no_local_schema', status: 'fixed' });
  });
});

it('keeps earlier robots findings open when the next run cannot verify robots.txt', async () => {
  robots = 'User-agent: GPTBot\nDisallow: /\n';
  const first = await run();
  robotsUnavailable = true;
  try {
    const next = await run();
    const earlier = (await getAudit(ORG, first.audit.id))!;
    const current = (await getAudit(ORG, next.audit.id))!;

    expect(earlier.meta.findings.find(f => f.key === 'ai_crawlers_blocked')?.status).toBe('open');
    expect(current.meta.coverage?.complete).toBe(false);
    expect(current.meta.findings.find(f => f.key === 'ai_crawlers_blocked')).toMatchObject({ status: 'open', verification: 'not_checked' });
  } finally {
    robotsUnavailable = false;
  }
});

it('keeps a reported fix unverified until a covered recheck confirms it', async () => {
  const client = await createDataRoom(ORG, 'usr-mara', { title: 'Verification client', client: 'Verification client', domains: ['verification.example'] });
  const coverage = { complete: true, checkedChecks: ['no_org_schema'], checkedUrls: ['https://verification.example/'], note: 'Complete fixture checks' };
  const first = (await fileAudit(ORG, { project: { id: client.id, title: client.title }, site: 'https://verification.example', checkedAt: '2026-10-29T10:00:00.000Z', findings: [{ key: 'no_org_schema', check: 'no_org_schema', category: 'ai_visibility', severity: 'high', title: 'Missing schema', evidence: 'Read homepage', url: 'https://verification.example/', checkedAt: '2026-10-29T10:00:00.000Z', status: 'open' }], pagesRead: 1, coverage, by: 'usr-mara' }))!.audit;
  await moveFindings(ORG, first.id, ['no_org_schema'], { kind: 'mark_fixed' }, { by: 'usr-mara' });
  const reported = (await getAudit(ORG, first.id))!;

  expect(reported.meta.findings[0]).toMatchObject({ status: 'fixed', verification: 'reported_fixed', statusBy: 'usr-mara' });
  expect((await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, first.id)))[0]?.status).toBe('active');
  expect(reported.meta.report).toContain('reported fixed (not reverified)');

  await fileAudit(ORG, { project: { id: client.id, title: client.title }, site: 'https://verification.example', checkedAt: '2026-10-30T10:00:00.000Z', findings: [], pagesRead: 1, coverage, by: 'agent:seo-strategist' });
  const verified = (await getAudit(ORG, first.id))!;

  expect(verified.meta.findings[0]).toMatchObject({ status: 'fixed', verification: 'verified_fixed', reportedFixedBy: 'usr-mara', verifiedBy: 'agent:seo-strategist' });
  expect((await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, first.id)))[0]?.status).toBe('resolved');
});

it('does not count a legacy resolved audit with unverified fixed findings as roadmap delivery', async () => {
  const { readSeoRoadmap } = await import('./roadmap');
  const { upsertStrategy } = await import('./strategy');
  const client = await createDataRoom(ORG, 'usr-mara', { title: 'Legacy verification client', client: 'Legacy verification client', domains: ['legacy.example'] });
  const audit = (await fileAudit(ORG, { project: { id: client.id, title: client.title }, site: 'https://legacy.example', checkedAt: '2026-10-29T10:00:00.000Z', findings: [], pagesRead: 1, coverage: { complete: true, checkedChecks: ['no_org_schema'], checkedUrls: [], note: 'Legacy fixture' }, by: 'usr-mara' }))!.audit;
  await db.update(businessObjectSchema).set({ status: 'resolved', metadata: { ...audit.meta, findings: [{ key: 'no_org_schema', check: 'no_org_schema', title: 'Legacy manually fixed schema', category: 'technical', severity: 'high', status: 'fixed' }] } }).where(eq(businessObjectSchema.id, audit.id));
  await upsertStrategy(ORG, { id: client.id, title: client.title }, { roadmap: { revision: 0, outcomes: [], initiatives: [{ id: 'verify', label: 'Verify legacy correction', lane: 'now', dependsOn: [], acceptanceCriteria: 'Covered recheck', recordIds: [audit.id], evidence: [], status: 'in_progress' }] } } as never, 'usr-mara');
  const state = await readSeoRoadmap(ORG, client.id, 'usr-mara');

  expect(state.linkedRecords[0]?.status).toBe('verification_required');
  expect(state.roadmap.initiatives[0]?.status).not.toBe('done');
});

it('keeps an audit active when only a medium finding remains open', async () => {
  const client = await createDataRoom(ORG, 'usr-mara', { title: 'Medium findings client', client: 'Medium findings client', domains: ['medium.example'] });
  const audit = (await fileAudit(ORG, { project: { id: client.id, title: client.title }, site: 'https://medium.example', checkedAt: '2026-10-29T10:00:00.000Z', findings: [{ key: 'thin', check: 'thin', category: 'content', severity: 'medium', title: 'Thin content', evidence: 'Read the page', url: 'https://medium.example/', checkedAt: '2026-10-29T10:00:00.000Z', status: 'open' }], coverage: { complete: true, checkedChecks: ['thin'], checkedUrls: ['https://medium.example/'], note: 'Complete checks' }, pagesRead: 1, by: 'usr-mara' }))!.audit;

  expect(audit.meta.highCount).toBe(0);
  expect(audit.meta.openCount).toBe(1);
  expect((await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, audit.id)))[0]?.status).toBe('active');
});
