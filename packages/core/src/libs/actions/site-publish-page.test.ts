/**
 * `site.publish_page`, end to end without a network or a database: records,
 * the draft artifact, GitHub, the browser runs and the vault are fakes. The
 * project, the client and every address are fictional (Northwind Outfitters).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLOG_JSON, squarespaceFetch } from '@/libs/fixtures/squarespace';

type Rec = { id: number; title: string; typeSlug: string; meta: Record<string, unknown> };
const records = new Map<number, Rec>();
const writes: Array<{ id: number; set: Record<string, unknown> }> = [];

vi.mock('@/libs/actions/factory-dispatch', () => ({
  readRecord: vi.fn(async (_org: string, id: number) => {
    const r = records.get(id);
    return r ? { id: r.id, title: r.title, typeId: 1, status: null, meta: r.meta, typeSlug: r.typeSlug, settled: null } : null;
  }),
  writeMeta: vi.fn(async (_org: string, id: number, set: Record<string, unknown>) => {
    writes.push({ id, set });
    const r = records.get(id);
    if (r) {
      r.meta = { ...r.meta, ...set };
    }
  }),
}));

vi.mock('@/services/ArtifactService', () => ({
  getArtifact: vi.fn(async ({ id }: { id: number }) => (id === 501
    ? { id: 501, kind: 'markdown', title: 'Three-season tent guide', currentVersion: 4, spec: { md: '# How to Choose a Three-Season Tent\n\nA tent for spring, summer and fall: what matters, what does not, and what it should cost you.\n\n## Weight\n\nUnder 2 kg.' } }
    : id === 502 ? { id: 502, kind: 'table', title: 'A table', currentVersion: 1, spec: {} } : null)),
}));

const openChangePull = vi.fn(async (_org: string, o: { repo: string; branch: string; files: Array<{ path: string; content: string }> }) => ({ repo: o.repo, url: `https://github.com/${o.repo}/pull/12`, number: 12, branch: o.branch, base: 'main', headSha: 'abc', created: true, paths: o.files.map(f => f.path) }));
const discardChange = vi.fn(async () => ({ closed: true, branchDeleted: true, revertUrl: null, state: 'closed' }));
vi.mock('@/services/factory/githubChange', () => ({ PAGE_BRANCH_PREFIX: 'vocion/seo-', openChangePull, discardChange }));

let login: Record<string, unknown> | undefined;
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: vi.fn(async () => login) }));

type Run = { id: number; status: string; result: Record<string, unknown> | null; error: string | null; summary: string | null };
const runs = new Map<number, Run>();
const created: Array<Record<string, unknown>> = [];
class BrowserRunBusyError extends Error {}
vi.mock('@/services/browser/BrowserRunService', () => ({
  BrowserRunBusyError,
  createBrowserRun: vi.fn(async (input: Record<string, unknown>) => {
    const id = 70 + created.length;
    created.push(input);
    runs.set(id, { id, status: input.start ? 'running' : 'proposed', result: null, error: null, summary: null });
    return { id };
  }),
  getBrowserRun: vi.fn(async (_org: string, id: number) => runs.get(id) ?? null),
}));

const startJob = vi.fn(async (id: string) => ({ id }));
vi.mock('@/libs/durable/jobs', () => ({ startJob }));
vi.mock('@/services/background/catalog', () => ({ JOB: { sitePublishSettle: 'site.publish-settle' } }));
vi.mock('@/libs/net/publicUrl', () => ({ resolvesPublicly: vi.fn(async (raw: string) => ({ ok: true, url: new URL(raw) })) }));

const { sitePublishPageAction: action } = await import('./site-publish-page');
const { settlePublishRun } = await import('@/services/publish/sitePublish');

const GITHUB = { id: 'site', kind: 'github', label: 'Northwind site', config: { repo: 'example-org/northwind-site', baseBranch: 'main', path: 'src/content/blog/{slug}.mdx', frontmatter: { title: '{title}', description: '{description}', pubDate: '{date}' } } };
const SQUARESPACE = { id: 'blog', kind: 'squarespace', config: { siteUrl: 'https://example-site.squarespace.com', blogPath: '/journal' } };

beforeEach(() => {
  records.clear();
  writes.length = 0;
  created.length = 0;
  runs.clear();
  openChangePull.mockClear();
  startJob.mockClear();
  login = { email: 'editor@northwind-outfitters.example', password: 'fixture-password' };
  records.set(10, { id: 10, title: 'Northwind Outfitters', typeSlug: 'data_room', meta: { publishTargets: [GITHUB, SQUARESPACE] } });
  records.set(20, { id: 20, title: 'three season tent', typeSlug: 'seo_page', meta: { projectId: 10, keyword: 'three season tent', title: 'How to Choose a Three-Season Tent', draftArtifactId: 501, publishTargetId: 'site', status: 'approved', metaDescription: 'What matters in a three-season tent, what does not, and what it should cost.' } });
  vi.stubGlobal('fetch', vi.fn(squarespaceFetch()));
});

const ctx = { orgId: 'org_nw', reviewedBy: 'user_1', runId: 99 };

describe('site.publish_page', () => {
  it('takes a page record, or a project and a draft, and refuses anything else up front', () => {
    expect(action.inputSchema.safeParse({ pageRecordId: 20 }).success).toBe(true);
    expect(action.inputSchema.safeParse({ projectId: 10, publishTargetId: 'site', artifactId: 501, slug: 'tents', title: 'Tents', metaDescription: 'Everything about tents for three seasons.' }).success).toBe(true);
    expect(action.inputSchema.safeParse({ slug: 'tents' }).success).toBe(false);
    expect(action.approvalRequired).toBe(true);
    expect(action.external).toBe(true);
  });

  it('says why a page cannot publish before anyone is asked', async () => {
    expect(await action.precheck!(ctx, { pageRecordId: 99 })).toBe('There is no record #99 in this workspace.');
    expect(await action.precheck!(ctx, { projectId: 10, artifactId: 501 })).toBe('The project publishes to site, blog: name the target this page goes to.');
    expect(await action.precheck!(ctx, { projectId: 10, publishTargetId: 'site', artifactId: 502 })).toBe('Artifact #502 (A table) is a table, not a markdown draft.');

    login = undefined;

    expect(await action.precheck!(ctx, { pageRecordId: 20, publishTargetId: 'blog' })).toMatch(/^No Squarespace editor login is stored/);
    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toBeUndefined();
  });

  it('shows the target, the path, the title, the description and the page rendered, on the card', async () => {
    const card = await action.reviewCard!(ctx, { pageRecordId: 20 });

    expect(card.title).toBe('Publish "How to Choose a Three-Season Tent" to example-org/northwind-site');
    expect(card.fields.map(f => `${f.label}: ${f.value}`)).toEqual([
      'Target: Northwind site: example-org/northwind-site · src/content/blog/{slug}.mdx (pull request)',
      'Path: src/content/blog/three-season-tent.mdx',
      'Branch: vocion/seo-three-season-tent',
      'Title: How to Choose a Three-Season Tent',
      'Meta description: What matters in a three-season tent, what does not, and what it should cost.',
      'Project: Northwind Outfitters',
    ]);
    expect(card.content?.map(c => `${c.kind}:${c.id}`)).toEqual(['text:preview', 'text:file', 'document:draft']);
    expect(card.content?.[0]).toMatchObject({ markdown: true });
    expect((card.content?.[1] as { body: string }).body).toMatch(/^---\ntitle: How to Choose a Three-Season Tent\n/);
  });

  it('opens the pull request with the page file on vocion/seo-<slug>, records it on the page, and Undo withdraws it', async () => {
    const result = await action.execute(ctx, { pageRecordId: 20 });

    expect(openChangePull).toHaveBeenCalledWith('org_nw', expect.objectContaining({ repo: 'example-org/northwind-site', base: 'main', branch: 'vocion/seo-three-season-tent', prefix: 'vocion/seo-' }));

    const file = (openChangePull.mock.calls[0]![1] as { files: Array<{ path: string; content: string }> }).files[0]!;

    expect(file.path).toBe('src/content/blog/three-season-tent.mdx');
    expect(file.content).not.toContain('# How to Choose');
    expect(result).toMatchObject({ kind: 'github', url: 'https://github.com/example-org/northwind-site/pull/12', path: file.path });
    expect(records.get(20)!.meta).toMatchObject({ status: 'publishing', pullRequestUrl: 'https://github.com/example-org/northwind-site/pull/12' });
    expect(action.canUndo!(result)).toBe(true);

    await action.undo!(ctx, { pageRecordId: 20 }, result);

    expect(discardChange).toHaveBeenCalledWith('org_nw', { url: 'https://github.com/example-org/northwind-site/pull/12', repo: 'example-org/northwind-site', branch: 'vocion/seo-three-season-tent' });
    expect(records.get(20)!.meta).toMatchObject({ status: 'approved', pullRequestUrl: null });
  });

  it('on Squarespace, saves a draft in the approver\'s browser with Save approved ahead, then follows it', async () => {
    const result = await action.execute(ctx, { pageRecordId: 20, publishTargetId: 'blog' });

    expect(created[0]).toMatchObject({ userId: 'user_1', start: true, startUrl: 'https://example-site.squarespace.com/config/pages', secretNames: ['password', 'body_html'] });
    expect((created[0]!.approvedAhead as { writes: unknown[] }).writes.length).toBeGreaterThan(0);
    expect((created[0]!.inputs as Record<string, string>).body_html).toBe('<p>A tent for spring, summer and fall: what matters, what does not, and what it should cost you.</p>\n<h2>Weight</h2>\n<p>Under 2 kg.</p>');
    expect(startJob).toHaveBeenCalledWith('site-publish-settle:70', expect.objectContaining({ job: 'site.publish-settle' }));
    expect(result).toMatchObject({ kind: 'squarespace', browserRunId: 70, postUrl: 'https://example-site.squarespace.com/journal/three-season-tent' });
    expect(action.canUndo!(result)).toBe(false);
    expect(records.get(20)!.meta).toMatchObject({ status: 'publishing', publishing: { kind: 'squarespace', phase: 'draft', browserRunId: 70 } });
  });

  it('needs a person for a Squarespace run', async () => {
    await expect(action.execute({ orgId: 'org_nw', invokedBy: 'agent:seo-writer' }, { pageRecordId: 20, publishTargetId: 'blog' })).rejects.toThrow(/runs in a person's browser/);
  });
});

describe('following a Squarespace publish', () => {
  const settle = { orgId: 'org_nw', phase: 'draft' as const, browserRunId: 70, pageRecordId: 20, siteUrl: 'https://example-site.squarespace.com', blogPath: '/journal', slug: 'choose-a-three-season-tent', title: 'How to Choose a Three-Season Tent', owner: { userId: 'user_1', conversationId: null, agentSlug: null } };

  it('waits while the run works, starts the going-live run once the draft is saved, and reads the live post back', async () => {
    runs.set(70, { id: 70, status: 'running', result: null, error: null, summary: null });

    expect(await settlePublishRun(settle)).toEqual({ done: false });

    // Not public yet: the blog lists only what is live.
    vi.stubGlobal('fetch', vi.fn(squarespaceFetch({ '/journal?format=json': { status: 200, body: { ...FIXTURE_BLOG_JSON, items: [] } } })));
    runs.set(70, { id: 70, status: 'done', result: { status: 'draft', editor_url: 'https://example-site.squarespace.com/config/pages/journal/p9' }, error: null, summary: 'Saved.' });
    const drafted = await settlePublishRun(settle);

    expect(drafted.next).toMatchObject({ phase: 'live', browserRunId: 70 + created.length - 1 });
    expect(created.at(-1)).toMatchObject({ start: true, continuing: true, startUrl: 'https://example-site.squarespace.com/config/pages/journal/p9' });
    expect(created.at(-1)!.approvedAhead).toBeUndefined();
    expect(records.get(20)!.meta).toMatchObject({ squarespaceDraftUrl: 'https://example-site.squarespace.com/config/pages/journal/p9' });

    vi.stubGlobal('fetch', vi.fn(squarespaceFetch()));
    runs.set(drafted.next!.browserRunId, { id: drafted.next!.browserRunId, status: 'done', result: { status: 'published' }, error: null, summary: 'Published.' });
    const live = await settlePublishRun(drafted.next!);

    expect(live.done).toBe(true);
    expect(records.get(20)!.meta).toMatchObject({ status: 'published', publishedUrl: 'https://example-site.squarespace.com/journal/choose-a-three-season-tent' });
  });

  it('says a declined go-live leaves a draft, and never claims a post the site does not list', async () => {
    vi.stubGlobal('fetch', vi.fn(squarespaceFetch({ '/journal?format=json': { status: 200, body: { ...FIXTURE_BLOG_JSON, items: [] } } })));
    runs.set(71, { id: 71, status: 'done', result: { status: 'draft' }, error: null, summary: 'Declined.' });
    const out = await settlePublishRun({ ...settle, phase: 'live', browserRunId: 71 });

    expect(out.line).toBe('"How to Choose a Three-Season Tent" stays a draft in Squarespace: going live was not approved.');
    expect(records.get(20)!.meta.publishedUrl).toBeUndefined();
  });
});
