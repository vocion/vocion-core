/**
 * `site.publish_page` and `site.publish_live`, end to end without a network
 * or a database: records, the draft artifact, GitHub, the browser runs and the
 * vault are fakes. The project, the client and every address are fictional
 * (Northwind Outfitters).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLOG_JSON, squarespaceFetch } from '@/libs/fixtures/squarespace';

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

const DRAFT = '# How to Choose a Three-Season Tent\n\nA tent for spring, summer and fall: what matters, what does not, and what it should cost you.\n\n## Weight\n\nUnder 2 kg.\n\n## Meta\n\n**Meta title:** Three-Season Tents\nMeta description: What matters.\nSlug: three-season-tents';
let draftVersion = 4;
vi.mock('@/services/ArtifactService', () => ({
  getArtifact: vi.fn(async ({ id }: { id: number }) => (id === 501
    ? { id: 501, kind: 'markdown', title: 'Three-season tent guide', currentVersion: draftVersion, spec: { md: DRAFT } }
    : id === 502 ? { id: 502, kind: 'table', title: 'A table', currentVersion: 1, spec: {} } : null)),
}));

const openChangePull = vi.fn(async (_org: string, o: { repo: string; branch: string; files: Array<{ path: string; content: string }> }) => ({ repo: o.repo, url: `https://github.com/${o.repo}/pull/12`, number: 12, branch: o.branch, base: 'main', headSha: 'abc', created: true, paths: o.files.map(f => f.path) }));
const discardChange = vi.fn(async () => ({ closed: true, branchDeleted: true, revertUrl: null, state: 'closed' }));
vi.mock('@/services/factory/githubChange', () => ({ PAGE_BRANCH_PREFIX: 'vocion/seo-', openChangePull, discardChange, defaultBranch: vi.fn(async () => 'main') }));

let login: Record<string, unknown> | undefined;
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: vi.fn(async () => login) }));

type Run = { id: number; status: string; result: Record<string, unknown> | null; error: string | null; summary: string | null };
const runs = new Map<number, Run>();
const created: Array<Record<string, unknown>> = [];
let browserBusy = false;
class BrowserRunBusyError extends Error {}
vi.mock('@/services/browser/BrowserRunService', () => ({
  BrowserRunBusyError,
  createBrowserRun: vi.fn(async (input: Record<string, unknown>) => {
    if (input.start && browserBusy) {
      throw new BrowserRunBusyError('busy');
    }
    const id = 70 + created.length;
    created.push(input);
    runs.set(id, { id, status: input.start ? 'running' : 'proposed', result: null, error: null, summary: null });
    return { id };
  }),
  getBrowserRun: vi.fn(async (_org: string, id: number) => runs.get(id) ?? null),
  liveRunFor: vi.fn(async () => (browserBusy ? { id: 1, task: 'x' } : null)),
  startBrowserRun: vi.fn(async (_org: string, _user: string, id: number) => {
    runs.get(id)!.status = 'running';
  }),
}));

// The database, as the queue and the measure read it: proposed publish runs, and whether a project has SEO pages.
const db = { seoPages: [] as unknown[], updates: [] as unknown[] };
vi.mock('@/libs/DB', () => {
  const chain = () => {
    let table: Record<string, unknown> = {};
    const c: Record<string, unknown> = {};
    const rows = () => ('heartbeatAt' in table ? [...runs.values()].filter(r => r.status === 'proposed').map(r => ({ id: r.id, task: String(created[r.id - 70]?.task ?? '') })) : db.seoPages);
    Object.assign(c, {
      from: (t: Record<string, unknown>) => {
        table = t;
        return c;
      },
      innerJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, bad),
      catch: () => Promise.resolve(rows()),
    });
    return c;
  };
  const update = () => ({ set: (v: unknown) => ({ where: () => {
    db.updates.push(v);
    return Promise.resolve();
  } }) });
  return { db: { select: () => chain(), update } };
});

const startJob = vi.fn(async (id: string) => ({ id }));
vi.mock('@/libs/durable/jobs', () => ({ startJob }));
vi.mock('@/services/background/catalog', () => ({ JOB: { sitePublishSettle: 'site.publish-settle', sitePublishMerge: 'site.publish-merge' } }));
const refreshSeoBatch = vi.fn(async () => null);
vi.mock('@/services/seo/records', () => ({
  signedOff: (meta: { signoff?: { decision?: string } }) => meta.signoff?.decision === 'approve',
  refreshSeoBatch,
}));
// GitHub, by path: the pull request, its head's statuses and checks, and the file at the page's path.
let github: Record<string, { status: number; body?: unknown }> = {};
vi.mock('@/services/factory/githubChecks', () => ({
  ghFor: vi.fn(async (_org: string, repo: string) => ({ owner: repo.split('/')[0], repo: repo.split('/')[1], token: 't' })),
  call: vi.fn(async (_gh: unknown, path: string) => {
    const key = Object.keys(github).find(k => path.startsWith(k));
    const r = key ? github[key]! : { status: 404 };
    return r.status === 200 ? { ok: true, status: 200, data: r.body } : { ok: false, status: r.status, message: 'Not Found' };
  }),
}));
vi.mock('@/libs/net/publicUrl', () => ({ resolvesPublicly: vi.fn(async (raw: string) => ({ ok: true, url: new URL(raw) })) }));

const { sitePublishLiveAction: live, sitePublishPageAction: action } = await import('./site-publish-page');
const { checksOf, settlePublishRun, settlePull } = await import('@/services/publish/sitePublish');

const GITHUB = { id: 'site', kind: 'github', label: 'Northwind site', config: { repo: 'example-org/northwind-site', baseBranch: 'main', path: 'src/content/blog/{slug}.mdx', frontmatter: { title: '{metaTitle}', description: '{description}', pubDate: '{date}' } } };
const SQUARESPACE = { id: 'blog', kind: 'squarespace', config: { siteUrl: 'https://example-site.squarespace.com', blogPath: '/journal' } };
const SIGNED = { decision: 'approve', version: 4 };

beforeEach(() => {
  records.clear();
  created.length = 0;
  runs.clear();
  openChangePull.mockClear();
  discardChange.mockClear();
  startJob.mockClear();
  refreshSeoBatch.mockClear();
  draftVersion = 4;
  browserBusy = false;
  db.seoPages = [];
  db.updates = [];
  login = { email: 'editor@northwind-outfitters.example', password: 'fixture-password' };
  github = { '/pulls/12': { status: 200, body: { state: 'open', merged: false, head: { sha: 'abc' } } } };
  records.set(10, { id: 10, title: 'Northwind Outfitters', typeSlug: 'data_room', meta: { publishTargets: [GITHUB, SQUARESPACE] } });
  records.set(20, { id: 20, title: 'How to Choose a Three-Season Tent', typeSlug: 'seo_page', meta: { projectId: 10, batchId: 30, keyword: 'three season tent', draftArtifactId: 501, status: 'approved', signoff: SIGNED, slug: 'three-season-tents', metaTitle: 'Three-Season Tents: What Matters', metaDescription: 'What matters in a three-season tent, what does not, and what it should cost.', pageType: 'blog' } });
  records.set(21, { id: 21, title: 'Tent stakes', typeSlug: 'seo_page', meta: { projectId: 10, batchId: 30, keyword: 'tent stakes', draftArtifactId: 501, status: 'in_review' } });
  records.set(22, { id: 22, title: 'Outfitters in Boulder', typeSlug: 'seo_page', meta: { projectId: 10, batchId: 30, keyword: 'boulder outfitter', draftArtifactId: 501, status: 'approved', signoff: SIGNED, pageType: 'location', publishTargetId: 'blog' } });
  // The page names no target; its batch's destination does.
  records.set(30, { id: 30, title: 'Northwind Outfitters: tents', typeSlug: 'seo_batch', meta: { projectId: 10, destination: 'site' } });
  vi.stubGlobal('fetch', vi.fn(squarespaceFetch({ '/journal?format=json': { status: 200, body: { ...FIXTURE_BLOG_JSON, items: [] } } })));
});

const ctx = { orgId: 'org_nw', reviewedBy: 'user_1', runId: 99 };

describe('site.publish_page', () => {
  it('is asked on its card every time, even when a person says "publish it" in chat', () => {
    expect(action.approvalRequired).toBe(true);
    expect(action.requiresReviewDecision).toBe(true);
    expect(action.inputSchema.safeParse({ slug: 'tents' }).success).toBe(false);
  });

  it('publishes only what was signed off: the page, its draft, the very version', async () => {
    expect(await action.precheck!(ctx, { pageRecordId: 99 })).toBe('There is no record #99 in this workspace.');
    expect(await action.precheck!(ctx, { pageRecordId: 21 })).toBe('"Tent stakes" is not signed off: a person approves its current draft before it is published (it is in_review).');
    expect(await action.precheck!(ctx, { pageRecordId: 20, artifactId: 502 })).toBe('Artifact #502 is not the draft "How to Choose a Three-Season Tent" was signed off on (#501).');

    draftVersion = 5;

    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toBe('The draft changed after it was signed off (signed off on version 4, now version 5): a person signs off on this version first.');

    draftVersion = 4;
    db.seoPages = [{ id: 20 }];

    expect(await action.precheck!(ctx, { projectId: 10, publishTargetId: 'site', artifactId: 501 })).toMatch(/tracked in the SEO app: publish one by its page record/);
  });

  it('refuses a location page on a blog-only Squarespace target', async () => {
    expect(await action.precheck!(ctx, { pageRecordId: 22 })).toMatch(/^This is a location page, and the project's Squarespace target publishes blog posts only/);
  });

  it('shows the target, path, branch, titles, meta and the page rendered; uses the page\'s own meta and slug', async () => {
    const card = await action.reviewCard!(ctx, { pageRecordId: 20 });

    expect(card.fields.map(f => `${f.label}: ${f.value}`)).toEqual([
      'Target: Northwind site — GitHub example-org/northwind-site',
      'Path: src/content/blog/three-season-tents.mdx',
      'Branch: vocion/seo-three-season-tents-p20',
      'Title: How to Choose a Three-Season Tent',
      'Meta title: Three-Season Tents: What Matters',
      'Meta description: What matters in a three-season tent, what does not, and what it should cost.',
      'Project: Northwind Outfitters',
    ]);

    const file = (card.content?.[1] as { body: string }).body;

    expect(file).toMatch(/^---\ntitle: "Three-Season Tents: What Matters"\n/);
    expect(file).not.toMatch(/Meta description:|Slug:|## Meta/);
    expect(card.content?.[0]).toMatchObject({ markdown: true });
  });

  it('refuses to overwrite a page already at the path, unless it is a refresh, and says "replacing"', async () => {
    github['/contents/'] = { status: 200, body: { sha: 'f1' } };

    expect(await action.precheck!(ctx, { pageRecordId: 20 })).toMatch(/already exists on example-org\/northwind-site@main\. Publishing would replace it/);

    const card = await action.reviewCard!(ctx, { pageRecordId: 20, refresh: true });

    expect(card.fields.find(f => f.label === 'Path')!.value).toBe('src/content/blog/three-season-tents.mdx (replacing)');
    expect(card.badges).toContainEqual({ label: 'Replaces a page', tone: 'warn' });
  });

  it('opens the pull request on the page\'s own branch, records and follows it, and Undo withdraws it', async () => {
    const result = await action.execute(ctx, { pageRecordId: 20 });

    expect(openChangePull).toHaveBeenCalledWith('org_nw', expect.objectContaining({ branch: 'vocion/seo-three-season-tents-p20', prefix: 'vocion/seo-' }));
    expect(records.get(20)!.meta).toMatchObject({ status: 'publishing', pullRequestUrl: 'https://github.com/example-org/northwind-site/pull/12' });
    expect(refreshSeoBatch).toHaveBeenCalledWith('org_nw', 30);
    expect(startJob).toHaveBeenCalledWith('site-publish-merge:example-org/northwind-site#12', expect.objectContaining({ input: expect.objectContaining({ actionRunId: 99 }) }));

    await action.undo!(ctx, { pageRecordId: 20 }, result);

    expect(discardChange).toHaveBeenCalledWith('org_nw', { url: 'https://github.com/example-org/northwind-site/pull/12', repo: 'example-org/northwind-site', branch: 'vocion/seo-three-season-tents-p20' });
    expect(records.get(20)!.meta).toMatchObject({ status: 'approved', pullRequestUrl: null });
  });

  it('on Squarespace, saves a draft with the page\'s SEO fields, and queues behind a busy browser instead of failing', async () => {
    const first = await action.execute(ctx, { pageRecordId: 20, publishTargetId: 'blog' });
    const inputs = created[0]!.inputs as Record<string, string>;

    expect(first).toMatchObject({ kind: 'squarespace', browserRunId: 70, queued: false, postUrl: 'https://example-site.squarespace.com/journal/three-season-tents' });
    expect(inputs).toMatchObject({ url_slug: 'three-season-tents', seo_title: 'Three-Season Tents: What Matters' });
    expect(inputs.body_html).not.toMatch(/Meta description|Slug:/);
    expect(created[0]!.approvedAhead).toMatchObject({ whilePageShows: { text: 'Post · Draft' }, alwaysHold: ['publish', 'schedule'] });

    browserBusy = true;
    records.set(23, { ...records.get(20)!, id: 23, meta: { ...records.get(20)!.meta, slug: 'tent-care' } });
    const second = await action.execute(ctx, { pageRecordId: 23, publishTargetId: 'blog' });

    expect(second).toMatchObject({ queued: true });
    expect(created[1]).toMatchObject({ start: false });
  });

  it('never claims a live post at the page\'s slug that is not the page\'s own', async () => {
    vi.stubGlobal('fetch', vi.fn(squarespaceFetch()));
    records.get(20)!.meta.slug = 'choose-a-three-season-tent';

    expect(await action.precheck!(ctx, { pageRecordId: 20, publishTargetId: 'blog' })).toBe('A post is already live at https://example-site.squarespace.com/journal/choose-a-three-season-tent ("How to Choose a Three-Season Tent"), and it is not this page\'s. Give this page another slug, or update that post in Squarespace.');
  });
});

describe('following a Squarespace publish', () => {
  const owner = { userId: 'user_1', conversationId: null, agentSlug: null };
  const settle = { orgId: 'org_nw', phase: 'draft' as const, browserRunId: 70, pageRecordId: 20, siteUrl: 'https://example-site.squarespace.com', blogPath: '/journal', slug: 'choose-a-three-season-tent', title: 'How to Choose a Three-Season Tent', owner, actionRunId: 99 };

  it('starts a queued run when its turn comes, then records the saved draft and waits for the go-live card', async () => {
    runs.set(70, { id: 70, status: 'proposed', result: null, error: null, summary: null });
    created[0] = { task: 'Save a blog post as a DRAFT on the Squarespace site https://example-site.squarespace.com' };

    expect(await settlePublishRun(settle)).toEqual({ done: false });
    expect(runs.get(70)!.status).toBe('running');

    runs.set(70, { id: 70, status: 'done', result: { status: 'draft', editor_url: 'https://example-site.squarespace.com/config/pages/c1' }, error: null, summary: 'Saved.' });
    const drafted = await settlePublishRun(settle);

    expect(drafted.done).toBe(true);
    expect(records.get(20)!.meta).toMatchObject({ status: 'publishing', squarespaceDraft: { slug: 'choose-a-three-season-tent' } });
  });

  it('goes live on one card for the drafted posts, one run each in turn, and counts a post only once it is read back live', async () => {
    records.get(20)!.meta.squarespaceDraft = { slug: 'choose-a-three-season-tent' };
    records.get(20)!.meta.publishing = { targetId: 'blog', actionRunId: 99 };

    expect(live.requiresReviewDecision).toBe(true);
    expect(await live.precheck!(ctx, { pageRecordIds: [20, 21] })).toBe('Not all of these can go live: #21 "Tent stakes" has no Squarespace draft saved yet.');

    const out = await live.execute(ctx, { pageRecordIds: [20] });

    expect(out.started).toEqual([{ pageRecordId: 20, browserRunId: 70, queued: false }]);
    expect(created[0]!.approvedAhead).toMatchObject({ whilePageShows: { text: 'How to Choose a Three-Season Tent' } });

    vi.stubGlobal('fetch', vi.fn(squarespaceFetch()));
    runs.set(70, { id: 70, status: 'done', result: { status: 'published' }, error: null, summary: 'Published.' });
    const done = await settlePublishRun({ ...settle, phase: 'live' });

    expect(done.done).toBe(true);
    expect(records.get(20)!.meta).toMatchObject({ status: 'published', publishedUrl: 'https://example-site.squarespace.com/journal/choose-a-three-season-tent' });
    expect(db.updates).toHaveLength(1);
  });

  it('says a post not published stays a draft, and never claims a post the site does not list', async () => {
    runs.set(71, { id: 71, status: 'done', result: { status: 'draft' }, error: null, summary: 'Declined.' });
    const out = await settlePublishRun({ ...settle, phase: 'live', browserRunId: 71 });

    expect(out.line).toBe('"How to Choose a Three-Season Tent" stays a draft in Squarespace: it was not published.');
    expect(records.get(20)!.meta.publishedUrl).toBeUndefined();
    expect(db.updates).toHaveLength(0);
  });
});

describe('following a page\'s pull request', () => {
  const follow = { orgId: 'org_nw', repo: 'example-org/northwind-site', number: 12, url: 'https://github.com/example-org/northwind-site/pull/12', pageRecordId: 20, actionRunId: 99 };

  it('records its checks and the preview while open, and counts the page published only when merged', async () => {
    github['/commits/abc/status'] = { status: 200, body: { state: 'success', statuses: [{ context: 'Vercel', state: 'success', target_url: 'https://northwind-site-git-preview.example' }] } };
    github['/commits/abc/check-runs'] = { status: 200, body: { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }] } };

    expect(await settlePull(follow)).toEqual({ done: false });
    expect(records.get(20)!.meta).toMatchObject({ previewUrl: 'https://northwind-site-git-preview.example', pullRequestChecks: { state: 'passing' } });
    expect(db.updates).toHaveLength(0);

    github['/pulls/12'] = { status: 200, body: { state: 'closed', merged: true, merged_at: '2026-10-28T09:00:00Z', head: { sha: 'abc' } } };
    const out = await settlePull(follow);

    expect(out.done).toBe(true);
    expect(records.get(20)!.meta).toMatchObject({ status: 'published', publishing: { kind: 'github', mergedAt: '2026-10-28T09:00:00Z' } });
    expect(db.updates).toEqual([{ result: expect.anything() }]);
  });

  it('puts the page back to approved when the pull request is closed unmerged', async () => {
    github['/pulls/12'] = { status: 200, body: { state: 'closed', merged: false, closed_at: '2026-10-28T09:00:00Z' } };
    await settlePull(follow);

    expect(records.get(20)!.meta.status).toBe('approved');
  });

  it('reads checks as one line: failing names what failed', () => {
    expect(checksOf({ statuses: [{ context: 'ci/lint', state: 'failure' }] }, { check_runs: [{ name: 'e2e', status: 'in_progress', conclusion: null }] })).toEqual({ state: 'failing', preview: null, failing: ['ci/lint'] });
    expect(checksOf(null, null).state).toBe('none');
  });
});
