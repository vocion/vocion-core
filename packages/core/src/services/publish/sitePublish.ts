/**
 * PUBLISHING A PAGE TO A CLIENT'S SITE — the work behind `site.publish_page`
 * (`libs/actions/site-publish-page.ts`).
 *
 * A page is a draft artifact (markdown) and, usually, the record that tracks
 * it (an `seo_page`, or any record carrying `metadata.projectId` and
 * `draftArtifactId`). Where it goes is its Project's publish target
 * (`libs/publish/targets.ts`). Two kinds publish today:
 *
 * - **github**: the page file, its frontmatter mirrored from the site's own,
 *   as one commit on `vocion/seo-<slug>` and a pull request
 *   (`services/factory/githubChange.ts`, generalised, not forked). Never
 *   merged from here: the client's team merges it.
 * - **squarespace**: two browser runs, a draft and then going live, the second
 *   click held for the person (`services/publish/squarespaceTask.ts`), followed
 *   by the `site.publish-settle` job, which reads the post back through the
 *   site's public JSON and records where it lives.
 * - **webflow**: a draft item in the site's blog collection through the Data
 *   API, created or updated in place by its slug, then published on its own
 *   approval (`services/publish/webflowPublish.ts`).
 *
 * Whatever happens is written on the page's record, so the batch page can show
 * the pull request, the draft or the live URL, with the run that made it.
 */

import type { PageFields, PublishTarget } from '@/libs/publish/targets';
import { slugify } from '@/libs/publish/targets';

export type PublishRequest = {
  pageRecordId?: number;
  /** The page replaces one already on the site at its path (a refresh), said so on the card. */
  refresh?: boolean;
  projectId?: number;
  publishTargetId?: string;
  artifactId?: number;
  slug?: string;
  title?: string;
  metaTitle?: string;
  metaDescription?: string;
};

/** Kinds of page a blog-only target cannot hold: they are pages of the site, not posts. */
const NOT_A_POST = new Set(['location', 'service', 'landing']);

export type PublishPlan = {
  project: { id: number; title: string };
  target: PublishTarget;
  page: PageFields & { recordId: number | null; descriptionFrom: 'given' | 'record' | 'first paragraph'; refresh: boolean; publishedUrl: string | null; existingUrl: string | null; draftUrl: string | null; webflowItemId?: string | null };
  draft: { artifactId: number; title: string; version: number; markdown: string };
  /** The page record's metadata before this publish, for Undo. */
  before: { status: unknown; pullRequestUrl: unknown; publishedUrl: unknown } | null;
};

type Meta = Record<string, unknown>;

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A description from the draft itself, when nobody wrote one: its first
 * paragraph of prose, without markdown, cut at a word near 155 characters.
 * @param markdown - The draft.
 */
export function firstParagraph(markdown: string): string {
  const para = markdown.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(?:[#>|]|[-*+]\s|\d+\.\s|```|!\[)/.test(p)) ?? '';
  const plain = para.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= 155) {
    return plain;
  }
  const cut = plain.slice(0, 155);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 100)).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * What the person signed off on, when the sign-off says: the draft's version
 * (`signoff.version`, `signoff.signedOffVersion` or `signedOffVersion`) and its
 * content hash. Null when the sign-off does not say, and then the sign-off's
 * own draft and round check (`signedOff`) is what holds.
 * @param meta - The page record's metadata.
 */
export function signedVersionOf(meta: Meta): { version: number | null; contentHash: string | null } {
  const signoff = (meta.signoff ?? {}) as Meta;
  return {
    version: num(signoff.version) ?? num(signoff.signedOffVersion) ?? num(meta.signedOffVersion),
    contentHash: text(signoff.contentHash),
  };
}

/**
 * A draft's text, hashed the way a sign-off records it: sha-256, hex.
 * @param markdown - The text.
 */
export async function contentHashOf(markdown: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(markdown).digest('hex');
}

/**
 * The last segment of a URL or a path: `https://site.example/blog/a-b/` and `blog/a-b` both give `a-b`.
 * @param urlOrPath - A URL, a path or a slug.
 */
export function lastSegment(urlOrPath: string): string {
  const path = urlOrPath.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  return path.split('/').filter(Boolean).pop() ?? '';
}

/**
 * A URL as compared: no scheme, no `www.`, no query, no trailing slash, lower case.
 * @param url - The URL.
 */
function sameUrl(url: string): string {
  return url.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0]!.replace(/\/+$/, '');
}

/**
 * Whether a project has pages tracked by the SEO app.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
async function projectHasSeoPages(orgId: string, projectId: number): Promise<boolean> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const [row] = await db.select({ id: businessObjectSchema.id })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, 'seo_page'), sql`(${businessObjectSchema.metadata} ->> 'projectId')::int = ${projectId}`))
    .limit(1)
    .catch(() => []);
  return Boolean(row);
}

/**
 * The page, its draft, its project and its target, read and checked; or why
 * it cannot publish, said for the person who can fix it. Explicit inputs win
 * over what the page record holds.
 * @param orgId - The workspace.
 * @param input - The request.
 * @param now - The clock.
 */
export async function planPublish(orgId: string, input: PublishRequest, now: Date = new Date()): Promise<{ ok: true; plan: PublishPlan } | { ok: false; why: string }> {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const { resolvePublishTarget, SLUG_RE } = await import('@/libs/publish/targets');

  let pageMeta: Meta = {};
  let pageTitle: string | null = null;
  let batchDestination: string | null = null;
  if (input.pageRecordId) {
    const record = await readRecord(orgId, input.pageRecordId);
    if (!record) {
      return { ok: false, why: `There is no record #${input.pageRecordId} in this workspace.` };
    }
    pageMeta = record.meta;
    pageTitle = record.title;
    if (record.typeSlug === 'seo_page') {
      // Approval is read from the person's sign-off on the current draft, never from the status alone.
      const { signedOff } = await import('@/services/seo/records');
      if (!signedOff(record.meta as Parameters<typeof signedOff>[0])) {
        return { ok: false, why: `"${record.title}" is not signed off: a person approves its current draft before it is published (it is ${String(pageMeta.status ?? 'not drafted')}).` };
      }
      // The sign-off covers that draft and nothing else: never another artifact named in the input.
      if (input.artifactId && input.artifactId !== num(pageMeta.draftArtifactId)) {
        return { ok: false, why: `Artifact #${input.artifactId} is not the draft "${record.title}" was signed off on (#${String(pageMeta.draftArtifactId)}).` };
      }
      const batchId = num(pageMeta.batchId);
      const batch = batchId ? await readRecord(orgId, batchId) : null;
      batchDestination = text(batch?.meta.destination);
    }
  }

  const projectId = input.projectId ?? num(pageMeta.projectId);
  if (!projectId) {
    return { ok: false, why: input.pageRecordId ? `Record #${input.pageRecordId} belongs to no project (metadata.projectId), so there is nowhere it publishes to.` : 'Name the project the page belongs to (projectId).' };
  }
  if (!input.pageRecordId && await projectHasSeoPages(orgId, projectId)) {
    // A project whose pages are tracked publishes them through their records, so the sign-off and the gate hold.
    return { ok: false, why: 'This project\'s pages are tracked in the SEO app: publish one by its page record (pageRecordId), which carries the sign-off.' };
  }
  const project = await readRecord(orgId, projectId);
  if (!project || project.typeSlug !== 'data_room') {
    return { ok: false, why: `#${projectId} is not a project in this workspace.` };
  }
  const resolved = resolvePublishTarget(project.meta.publishTargets, input.publishTargetId ?? text(pageMeta.publishTargetId) ?? batchDestination);
  if (!resolved.ok) {
    return { ok: false, why: resolved.why };
  }
  if (resolved.target.kind === 'wordpress') {
    return { ok: false, why: 'Publishing to WordPress is not built yet: this project\'s target is WordPress.' };
  }
  // The target's connection must be one this project may use: the
  // workspace's or this project's own, never another client's.
  const outOfScope = await publishTargetScopeRefusal(orgId, project.id, resolved.target);
  if (outOfScope) {
    return { ok: false, why: outOfScope };
  }

  const artifactId = input.artifactId ?? num(pageMeta.draftArtifactId);
  if (!artifactId) {
    return { ok: false, why: 'The page has no draft to publish (draftArtifactId).' };
  }
  const { getArtifact } = await import('@/services/ArtifactService');
  const artifact = await getArtifact({ orgId, id: artifactId });
  if (!artifact) {
    return { ok: false, why: `There is no artifact #${artifactId} in this workspace.` };
  }
  const raw = artifact.kind === 'markdown' ? String(artifact.spec.md ?? '') : '';
  if (!raw.trim()) {
    return { ok: false, why: `Artifact #${artifactId} (${artifact.title}) is ${artifact.kind === 'markdown' ? 'empty' : `a ${artifact.kind}, not a markdown draft`}.` };
  }
  const signed = signedVersionOf(pageMeta);
  if (signed.version !== null && signed.version !== artifact.currentVersion) {
    return { ok: false, why: `The draft changed after it was signed off (signed off on version ${signed.version}, now version ${artifact.currentVersion}): a person signs off on this version first.` };
  }
  if (signed.contentHash && signed.contentHash !== await contentHashOf(raw)) {
    return { ok: false, why: 'The draft\'s text is not the text that was signed off: a person signs off on it as it stands first.' };
  }
  const { emptyPlaceholders, stripBylineBlock, stripMetaBlock, wordCount } = await import('@/libs/publish/targets');
  // The body is the page: a trailing meta block and a leading byline are the page's fields, written into the frontmatter.
  const markdown = stripBylineBlock(stripMetaBlock(raw));
  const pageType = text(pageMeta.pageType);
  if ((resolved.target.kind === 'squarespace' || resolved.target.kind === 'webflow') && pageType && NOT_A_POST.has(pageType)) {
    const site = resolved.target.kind === 'squarespace' ? 'Squarespace' : 'Webflow';
    return { ok: false, why: `This is a ${pageType} page, and the project's ${site} target publishes blog posts only. Publish it to a target that takes site pages, or add it in ${site} by hand from the approved draft.` };
  }

  const title = input.title ?? text(pageMeta.title) ?? pageTitle ?? artifact.title;
  // The page's one slug: what the SEO plan wrote (`slug`, which may be a path such as
  // `lakeside/drain-cleaning`, or the URL a refresh rewrites), its last segment.
  const existingUrl = text(pageMeta.existingUrl);
  const planned = text(pageMeta.slug) ?? (existingUrl ? lastSegment(existingUrl) : null);
  const slug = input.slug ?? (planned ? slugify(lastSegment(planned)) : null) ?? slugify(text(pageMeta.keyword) ?? title);
  if (!SLUG_RE.test(slug)) {
    return { ok: false, why: `"${slug}" is not a URL slug: lower case letters and digits joined by -.` };
  }
  const metaTitle = text(input.metaTitle) ?? text(pageMeta.metaTitle) ?? title;
  const given = text(input.metaDescription);
  const recorded = text(pageMeta.metaDescription);
  const description = given ?? recorded ?? firstParagraph(markdown);
  const byline = bylineOf(pageMeta, project.meta);
  const fields = { author: byline?.name ?? null, authorSlug: byline?.slug ?? null, category: text(pageMeta.category), excerpt: text(pageMeta.excerpt), tags: tagsOf(pageMeta.tags), words: wordCount(markdown), image: text(pageMeta.image) };
  if (resolved.target.kind === 'github') {
    const empty = emptyPlaceholders(resolved.target, { title, metaTitle, description, slug, at: now, ...fields });
    if (empty.length > 0) {
      const needs = [...new Set(empty.map(n => (n === 'authorSlug' ? 'author' : n)))];
      return { ok: false, why: `The site's frontmatter needs ${needs.join(' and ')}, and "${title}" has none: ${needs.map(n => (n === 'category' ? 'give the page its category (seo_save_draft category)' : 'name its author, or mark one of the project\'s authors the default')).join('; ')}.` };
    }
  }
  return {
    ok: true,
    plan: {
      project: { id: project.id, title: project.title },
      target: resolved.target,
      page: { recordId: input.pageRecordId ?? null, title, metaTitle, slug, description, ...fields, descriptionFrom: given ? 'given' : recorded ? 'record' : 'first paragraph', keyword: text(pageMeta.keyword), at: now, refresh: input.refresh === true || pageMeta.refresh === true || Boolean(existingUrl), publishedUrl: text(pageMeta.publishedUrl), existingUrl, draftUrl: text(pageMeta.squarespaceDraftUrl), webflowItemId: text((pageMeta.webflowDraft as Meta | undefined)?.itemId) },
      draft: { artifactId, title: artifact.title, version: artifact.currentVersion, markdown },
      before: input.pageRecordId ? { status: pageMeta.status ?? null, pullRequestUrl: pageMeta.pullRequestUrl ?? null, publishedUrl: pageMeta.publishedUrl ?? null } : null,
    },
  };
}

/**
 * A page's tags as a list: the record's `tags`, a list or a comma-separated line.
 * @param value - `metadata.tags`.
 */
export function tagsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(list.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean))];
}

type AuthorLike = { name?: unknown; slug?: unknown; default?: unknown };

/**
 * Who signs the page, with the author's slug on the site: the page's byline
 * (`author`, a name or `{ name }`), else the project's default author. The
 * slug is the project author's `slug` when it names one, else the name
 * slugified. Null when neither names anyone.
 * @param pageMeta - The page record's metadata.
 * @param projectMeta - The project's metadata, with its `authors`.
 */
export function bylineOf(pageMeta: Meta, projectMeta: Meta): { name: string; slug: string } | null {
  const authors = (Array.isArray(projectMeta.authors) ? projectMeta.authors : []) as AuthorLike[];
  const key = (s: unknown) => (typeof s === 'string' ? s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') : '');
  const own = pageMeta.author;
  const named = text(typeof own === 'object' && own ? (own as AuthorLike).name : own);
  const known = named ? authors.find(a => key(a.name) && key(a.name) === key(named)) : authors.find(a => a.default === true) ?? (authors.length === 1 ? authors[0] : undefined);
  const name = named ?? text(known?.name);
  if (!name) {
    return null;
  }
  const ownSlug = typeof own === 'object' && own ? text((own as AuthorLike).slug) : null;
  return { name, slug: ownSlug ?? text(known?.slug) ?? slugify(name) };
}

/**
 * Why a project's publish target cannot publish for it: the connection that
 * serves the target — the GitHub connection listing its repository, the
 * Squarespace connector for its site — belongs to another project
 * (`services/connect/connectionScope.ts`). Null when the target's connection
 * is the workspace's or this project's, and when there is none yet (saying
 * how to connect one is the publish's own job).
 * @param orgId - The workspace.
 * @param projectId - The project the target is on.
 * @param target - The target.
 * @param target.kind - Its kind.
 * @param target.config - Its config.
 */
export async function publishTargetScopeRefusal(orgId: string, projectId: number, target: { kind: string; config: Record<string, unknown> }): Promise<string | null> {
  const scope = { projectId };
  if (target.kind === 'github' && typeof target.config.repo === 'string') {
    const { repoScopeRefusal } = await import('@/services/agents/tools/githubPullRead');
    return repoScopeRefusal(orgId, target.config.repo, scope);
  }
  if (target.kind === 'squarespace' && typeof target.config.siteUrl === 'string') {
    const { squarespaceConnectionFor, squarespaceOutOfScope } = await import('./squarespaceSignIn');
    return await squarespaceConnectionFor(orgId, target.config.siteUrl, scope) ? null : squarespaceOutOfScope(orgId, target.config.siteUrl, scope);
  }
  return null;
}

/** No inline styles: the page takes the site's own. */
const NO_STYLES = { h1: '', h2: '', h3: '', p: '', ul: '', ol: '', li: '', a: '', code: '', hr: '', table: '', th: '', td: '', blockquote: '' };

/**
 * Markdown rendered to HTML, for a target that takes HTML, a post pasted into
 * an editor, and the card's preview: the small escaping renderer the reports
 * already use (headings, paragraphs, lists, emphasis, code, links, tables,
 * rules), with no inline styles, so the site's own styles apply.
 * @param markdown - The body.
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  const { markdownToEmailHtml } = await import('@/services/reports/markdownToEmailHtml');
  return markdownToEmailHtml(markdown, NO_STYLES)
    .replace(/ style=""/g, '')
    .replace(/ role="presentation" cellpadding="0" cellspacing="0"/g, '');
}

/**
 * The file a GitHub target gets for this plan.
 * @param plan - The plan; its target must be github.
 */
export async function pageFileFor(plan: PublishPlan): Promise<{ path: string; format: string; content: string }> {
  const { formatOf } = await import('@/libs/publish/targets');
  const { renderPageFile } = await import('@/libs/publish/pageFile');
  if (plan.target.kind !== 'github') {
    throw new Error('not a GitHub target');
  }
  const html = formatOf(plan.target) === 'html' ? await markdownToHtml(plan.draft.markdown) : undefined;
  return renderPageFile(plan.target, plan.page, { markdown: plan.draft.markdown, html });
}

/**
 * Write what happened on the page's record, merged into its metadata.
 * @param orgId - The workspace.
 * @param recordId - The page record, when there is one.
 * @param set - The fields.
 */
export async function recordOnPage(orgId: string, recordId: number | null | undefined, set: Meta): Promise<void> {
  if (!recordId) {
    return;
  }
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  await writeMeta(orgId, recordId, set);
  // An SEO page's batch keeps its counts and gate line in step with its pages.
  const record = await readRecord(orgId, recordId).catch(() => null);
  const batchId = record?.typeSlug === 'seo_page' ? num(record.meta.batchId) : null;
  if (batchId) {
    const { refreshSeoBatch } = await import('@/services/seo/records');
    await refreshSeoBatch(orgId, batchId).catch(error => console.warn('[publish] the batch could not be refreshed', { batchId, reason: (error as Error).message }));
  }
}

/**
 * Stamp the publish run that sent a page out with when it was confirmed live
 * (a merge, a read-back), so "pages published" counts what reached the site,
 * never a pull request opened or a draft saved (`rows: published-pages`).
 * @param orgId - The workspace.
 * @param runId - The `site.publish_page` run.
 * @param live - When, where and how it was confirmed.
 * @param live.at - When.
 * @param live.url - The live page or the merged pull request.
 * @param live.how - `merged`, `read-back`, or `published` (the vendor's API said so: Webflow).
 */
export async function markRunLive(orgId: string, runId: number | null | undefined, live: { at: string; url: string; how: 'merged' | 'read-back' | 'published' }): Promise<void> {
  if (!runId) {
    return;
  }
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  await db.update(actionRunSchema)
    .set({ result: sql`coalesce(${actionRunSchema.result}, '{}'::jsonb) || ${JSON.stringify({ live })}::jsonb` })
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, runId)))
    .catch(error => console.warn('[publish] the run could not be marked live', { runId, reason: (error as Error).message }));
}

/** What the merge follower carries: the pull request a page went out in. */
export type PullFollow = {
  orgId: string;
  repo: string;
  number: number;
  url: string;
  pageRecordId: number | null;
  actionRunId?: number | null;
  /** The page's project: the follow job reads the pull request as that project's work (`libs/durable/jobs.ts`). */
  projectId?: number | null;
};

/**
 * Start following a page's pull request until the client's team merges or closes it.
 * @param follow - The pull request and the page.
 */
export async function followPull(follow: PullFollow): Promise<boolean> {
  const { startJob } = await import('@/libs/durable/jobs');
  const { JOB } = await import('@/services/background/catalog');
  return startJob(`site-publish-merge:${follow.repo}#${follow.number}`, { job: JOB.sitePublishMerge, input: follow }).then(() => true, () => false);
}

type CommitStatus = { state?: string; statuses?: Array<{ context?: string; state?: string; target_url?: string | null; description?: string | null }> };
type CheckRuns = { check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null; details_url?: string | null }> };

/**
 * The checks on a pull request's head and the preview its host deployed
 * (a Vercel or Netlify status's link), in one line for the page record.
 * @param status - The commit's combined status.
 * @param runs - The commit's check runs.
 */
export function checksOf(status: CommitStatus | null, runs: CheckRuns | null): { state: 'passing' | 'failing' | 'pending' | 'none'; preview: string | null; failing: string[] } {
  const statuses = status?.statuses ?? [];
  const checkRuns = runs?.check_runs ?? [];
  const failing = [
    ...statuses.filter(s => s.state === 'failure' || s.state === 'error').map(s => s.context ?? 'a status'),
    ...checkRuns.filter(r => r.status === 'completed' && r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion)).map(r => r.name ?? 'a check'),
  ];
  const pending = statuses.some(s => s.state === 'pending') || checkRuns.some(r => r.status !== 'completed');
  const previewOf = (ctx: string | undefined) => /vercel|netlify|preview|deploy/i.test(ctx ?? '');
  const preview = statuses.find(s => previewOf(s.context) && s.state === 'success' && s.target_url)?.target_url
    ?? checkRuns.find(r => previewOf(r.name) && r.conclusion === 'success' && r.details_url)?.details_url
    ?? null;
  const state = failing.length > 0 ? 'failing' : pending ? 'pending' : statuses.length + checkRuns.length > 0 ? 'passing' : 'none';
  return { state, preview, failing };
}

/**
 * One look at a page's pull request: its checks and preview recorded on the
 * page; merged moves the page to published, closed unmerged puts it back to
 * approved, open waits. Vocion never merges it.
 * @param follow - The pull request and the page.
 */
export async function settlePull(follow: PullFollow): Promise<{ done: boolean; line?: string }> {
  const { call, ghFor } = await import('@/services/factory/githubChecks');
  const gh = await ghFor(follow.orgId, follow.repo);
  const res = await call<{ state?: string; merged?: boolean; merged_at?: string | null; closed_at?: string | null; head?: { sha?: string } }>(gh, `/pulls/${follow.number}`);
  if (!res.ok) {
    return { done: false };
  }
  const sha = res.data.head?.sha;
  if (sha && !res.data.merged && res.data.state !== 'closed') {
    const [status, runs] = await Promise.all([
      call<CommitStatus>(gh, `/commits/${sha}/status`),
      call<CheckRuns>(gh, `/commits/${sha}/check-runs`),
    ]);
    const checks = checksOf(status.ok ? status.data : null, runs.ok ? runs.data : null);
    const { readRecord } = await import('@/libs/actions/factory-dispatch');
    const prior = follow.pageRecordId ? ((await readRecord(follow.orgId, follow.pageRecordId))?.meta.pullRequestChecks ?? null) as Record<string, unknown> | null : null;
    if (!prior || prior.state !== checks.state || prior.preview !== checks.preview || prior.sha !== sha) {
      await recordOnPage(follow.orgId, follow.pageRecordId, { pullRequestChecks: { ...checks, sha, at: new Date().toISOString() }, ...(checks.preview ? { previewUrl: checks.preview } : {}) });
    }
  }
  if (res.data.merged) {
    const at = res.data.merged_at ?? new Date().toISOString();
    const line = `Merged ${follow.url.replace('https://github.com/', '')}: the page is on the site's main branch.`;
    await recordOnPage(follow.orgId, follow.pageRecordId, { status: 'published', publishing: { kind: 'github', url: follow.url, mergedAt: at, note: line } });
    await markRunLive(follow.orgId, follow.actionRunId, { at, url: follow.url, how: 'merged' });
    return { done: true, line };
  }
  if (res.data.state === 'closed') {
    const line = `${follow.url.replace('https://github.com/', '')} was closed without merging; the page is approved and unpublished.`;
    await recordOnPage(follow.orgId, follow.pageRecordId, { status: 'approved', publishing: { kind: 'github', url: follow.url, closedAt: res.data.closed_at ?? new Date().toISOString(), note: line } });
    return { done: true, line };
  }
  return { done: false };
}

/**
 * The branch a page goes out on: its slug, and its record, so two batches'
 * pages with one slug never share a pull request.
 * @param plan - The plan.
 */
export function pageBranchOf(plan: Pick<PublishPlan, 'page'>): string {
  return `vocion/seo-${plan.page.slug}${plan.page.recordId ? `-p${plan.page.recordId}` : ''}`.slice(0, 200);
}

/**
 * What a GitHub publish would write, checked against the repository: the
 * file, the branch, the base, and whether a file is already at that path on
 * the base (which only a refresh may replace).
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be github.
 */
export async function githubPreflight(orgId: string, plan: PublishPlan): Promise<{ file: { path: string; format: string; content: string }; branch: string; base: string; exists: boolean | null; why?: string }> {
  // The project's work: its repository is read with a connection this project may use.
  const { withWorkProject } = await import('@/services/connect/connectionScope');
  return withWorkProject(plan.project.id, () => githubPreflightInScope(orgId, plan));
}

async function githubPreflightInScope(orgId: string, plan: PublishPlan): Promise<{ file: { path: string; format: string; content: string }; branch: string; base: string; exists: boolean | null; why?: string }> {
  if (plan.target.kind !== 'github') {
    throw new Error('not a GitHub target');
  }
  const file = await pageFileFor(plan);
  const branch = pageBranchOf(plan);
  const { call, ghFor } = await import('@/services/factory/githubChecks');
  const { defaultBranch } = await import('@/services/factory/githubChange');
  const repo = plan.target.config.repo;
  let base = plan.target.config.baseBranch ?? '';
  let exists: boolean | null = null;
  try {
    base ||= await defaultBranch(orgId, repo);
    const gh = await ghFor(orgId, repo);
    const res = await call<unknown>(gh, `/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(base)}`);
    exists = res.ok ? true : res.status === 404 ? false : null;
  } catch {
    exists = null;
  }
  const why = exists && !plan.page.refresh
    ? `${file.path} already exists on ${repo}@${base}. Publishing would replace it: if this page is meant to refresh it, say so (refresh: true, or the page's existingUrl); otherwise give the page another slug.`
    : undefined;
  return { file, branch, base: base || 'the default branch', exists, ...(why ? { why } : {}) };
}

/**
 * The page as a pull request on the target's repository.
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be github.
 * @param by - Who approved it, for the description.
 */
export async function publishToGithub(orgId: string, plan: PublishPlan, by: string | null) {
  // The project's work: the pull request opens with a connection this project may use, or not at all.
  const { withWorkProject } = await import('@/services/connect/connectionScope');
  return withWorkProject(plan.project.id, () => publishToGithubInScope(orgId, plan, by));
}

async function publishToGithubInScope(orgId: string, plan: PublishPlan, by: string | null) {
  if (plan.target.kind !== 'github') {
    throw new Error('not a GitHub target');
  }
  const { openChangePull, PAGE_BRANCH_PREFIX } = await import('@/services/factory/githubChange');
  const pre = await githubPreflight(orgId, plan);
  if (pre.why) {
    throw new Error(pre.why);
  }
  const { file } = pre;
  const body = [
    `${pre.exists ? 'Replaces' : 'Adds'} the page **${plan.page.title}** at \`${file.path}\`.`,
    '',
    `- Meta title: ${plan.page.metaTitle ?? plan.page.title}`,
    `- Meta description: ${plan.page.description}`,
    `- Drafted in Vocion: artifact #${plan.draft.artifactId} (version ${plan.draft.version})${plan.page.recordId ? `, page record #${plan.page.recordId}` : ''}, project "${plan.project.title}".`,
    `- Approved in Vocion's Review${by ? ` by ${by}` : ''}.`,
    '',
    'Review it here and merge it when it is right. Vocion never merges a page; closing this pull request withdraws it.',
  ].join('\n');
  const opened = await openChangePull(orgId, {
    repo: plan.target.config.repo,
    title: `${pre.exists ? 'Refresh' : 'Add'} page: ${plan.page.title}`.slice(0, 200),
    body,
    files: [{ path: file.path, content: file.content }],
    base: plan.target.config.baseBranch ?? null,
    branch: pre.branch,
    prefix: PAGE_BRANCH_PREFIX,
  });
  return { ...opened, path: file.path, format: file.format, replaced: pre.exists === true };
}

/** Who the browser runs belong to: the person whose approval started them. */
export type RunOwner = { userId: string; conversationId: number | null; agentSlug: string | null };

/**
 * A browser run for a publish, started now when the person's browser is free,
 * else filed to wait its turn (`proposed`): the settle job starts it when the
 * runs filed before it are done, one at a time, oldest first, so approving
 * several cards in a row queues their runs instead of failing.
 * @param orgId - The workspace.
 * @param owner - Whose browser.
 * @param spec - The run.
 * @param continuing - Carry on from the page the browser is on.
 */
async function startOrQueue(orgId: string, owner: RunOwner, spec: import('./squarespaceTask').PublishRunSpec, continuing = false) {
  const { createBrowserRun, BrowserRunBusyError } = await import('@/services/browser/BrowserRunService');
  const make = (start: boolean) => createBrowserRun({
    orgId,
    userId: owner.userId,
    conversationId: owner.conversationId,
    agentSlug: owner.agentSlug,
    task: spec.task,
    startUrl: spec.startUrl,
    inputs: spec.inputs,
    secretNames: spec.secretNames,
    outputs: spec.outputs,
    proposedBy: 'person',
    start,
    continuing: start && continuing,
    approvedAhead: spec.approvedAhead,
    keptSignIn: spec.keptSignIn ?? null,
  });
  const queued = await waitingPublishRuns(orgId, owner.userId);
  if (queued.length > 0) {
    return { run: await make(false), queued: true };
  }
  return make(true).then(run => ({ run, queued: false })).catch(async (error) => {
    if (error instanceof BrowserRunBusyError) {
      return { run: await make(false), queued: true };
    }
    throw error;
  });
}

/**
 * The person's publish runs filed to wait their turn, oldest first.
 * @param orgId - The workspace.
 * @param userId - The person.
 */
async function waitingPublishRuns(orgId: string, userId: string): Promise<number[]> {
  const { and, asc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { browserRunSchema } = await import('@/models/Schema');
  const { isPublishTask } = await import('./squarespaceTask');
  const rows = await db.select({ id: browserRunSchema.id, task: browserRunSchema.task })
    .from(browserRunSchema)
    .where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.userId, userId), eq(browserRunSchema.status, 'proposed')))
    .orderBy(asc(browserRunSchema.id))
    .catch(() => []);
  return rows.filter(r => isPublishTask(r.task)).map(r => r.id);
}

/**
 * Start a queued publish run when it is its turn: the person's browser is
 * free and no publish run was filed before it. True when it started.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param runId - The queued run.
 */
async function startWhenItsTurn(orgId: string, userId: string, runId: number): Promise<boolean> {
  const { liveRunFor, startBrowserRun } = await import('@/services/browser/BrowserRunService');
  if (await liveRunFor(orgId, userId)) {
    return false;
  }
  const waiting = await waitingPublishRuns(orgId, userId);
  if (waiting[0] !== runId) {
    return false;
  }
  return startBrowserRun(orgId, userId, runId).then(() => true, () => false);
}

/**
 * Follow a publish run with the settle job.
 * @param settle - What the job carries.
 */
async function follow(settle: SettleInput): Promise<boolean> {
  const { startJob } = await import('@/libs/durable/jobs');
  const { JOB } = await import('@/services/background/catalog');
  return startJob(`site-publish-settle:${settle.browserRunId}`, { job: JOB.sitePublishSettle, input: settle }).then(() => true, (error: Error) => {
    console.warn('[publish] the read-back job could not start', { run: settle.browserRunId, reason: error.message });
    return false;
  });
}

/**
 * Before a Squarespace publish: a post already live at this slug that is not
 * this page's is someone else's, and is never overwritten or claimed.
 * @param plan - The plan; its target must be squarespace.
 */
export async function squarespaceSlugCheck(plan: PublishPlan): Promise<string | null> {
  if (plan.target.kind !== 'squarespace') {
    return null;
  }
  const { findPublishedPost } = await import('@/libs/sources/squarespace');
  const { post } = await findPublishedPost(plan.target.config.siteUrl, plan.target.config.blogPath ?? '/blog', { slug: plan.page.slug });
  // Ours: the post this page already published, or the one it was planned to refresh.
  const ours = [plan.page.publishedUrl, plan.page.existingUrl].filter(Boolean).map(u => sameUrl(u!));
  if (post && !ours.includes(sameUrl(post.url))) {
    return `A post is already live at ${post.url} ("${post.title}"), and it is not this page's. Give this page another slug, or update that post in Squarespace.`;
  }
  return null;
}

/**
 * The workspace's Squarespace editor login, from the vault, or null when none is stored.
 * @param orgId - The workspace.
 * @param scope - The work's scope (`connectionScope.ts`); the current work's when omitted.
 * @param scope.projectId - The project the publish is for.
 */
export async function squarespaceLogin(orgId: string, scope?: { projectId: number | null }): Promise<{ email: string; password: string } | null> {
  const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
  // Another project's login is refused by the resolver, and reads as none here.
  const login = await getCredentialsForSource(orgId, 'squarespace', scope).catch(() => undefined) as Record<string, unknown> | undefined;
  return typeof login?.email === 'string' && typeof login?.password === 'string' ? { email: login.email, password: login.password } : null;
}

/**
 * Start the Squarespace draft run, or queue it behind the person's other
 * publish runs, and the job that follows it. The run starts from the site's
 * kept sign-in when its connector holds one, and types the login only when
 * that is missing or expired (`squarespaceSignIn.ts`).
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be squarespace.
 * @param login - The editor login, from the vault, or null when none is stored.
 * @param owner - Whose browser it runs in.
 * @param actionRunId - The publish run, stamped when the post is confirmed live.
 */
export async function startSquarespaceDraft(orgId: string, plan: PublishPlan, login: { email: string; password: string } | null, owner: RunOwner, actionRunId: number | null = null) {
  if (plan.target.kind !== 'squarespace') {
    throw new Error('not a Squarespace target');
  }
  const { draftRun, postUrlOf } = await import('./squarespaceTask');
  const { runSignInOf, squarespaceConnectionFor } = await import('./squarespaceSignIn');
  const connection = await squarespaceConnectionFor(orgId, plan.target.config.siteUrl, { projectId: plan.project.id }).catch(() => null);
  const blogPath = plan.target.config.blogPath ?? '/blog';
  const post = {
    siteUrl: plan.target.config.siteUrl,
    blogPath,
    title: plan.page.title,
    slug: plan.page.slug,
    bodyHtml: await markdownToHtml(plan.draft.markdown.replace(/^\s*#\s+(?:\S[^\n]*)?\n+/, '').trim()),
    excerpt: plan.page.description,
    seoTitle: plan.page.metaTitle ?? plan.page.title,
    seoDescription: plan.page.description,
  };
  const spec = { ...draftRun(post, { kept: connection?.signIn.kept === true, login }), keptSignIn: runSignInOf(connection) };
  const { run, queued } = await startOrQueue(orgId, owner, spec);
  const followed = await follow({ orgId, phase: 'draft', browserRunId: run.id, pageRecordId: plan.page.recordId, siteUrl: plan.target.config.siteUrl, blogPath, slug: plan.page.slug, title: plan.page.title, owner, actionRunId, signInSourceId: connection?.sourceId ?? null });
  return { browserRunId: run.id, postUrl: postUrlOf(post), followed, queued };
}

/** A drafted post to take live: its page and where it lives. */
export type LivePost = { pageRecordId: number; siteUrl: string; blogPath: string; slug: string; title: string; actionRunId: number | null };

/**
 * Take drafted posts live, one approval for all of them: one run per post,
 * in order, each pressing Publish on its own draft (approved ahead by the card
 * that listed them), each followed and read back.
 * @param orgId - The workspace.
 * @param posts - The drafted posts.
 * @param owner - Whose browser.
 */
export async function startSquarespaceLive(orgId: string, posts: LivePost[], owner: RunOwner): Promise<Array<{ pageRecordId: number; browserRunId: number; queued: boolean }>> {
  const { liveRun } = await import('./squarespaceTask');
  const { runSignInOf, squarespaceConnectionFor } = await import('./squarespaceSignIn');
  const { projectOfRecord } = await import('@/services/connect/connectionScope');
  const started: Array<{ pageRecordId: number; browserRunId: number; queued: boolean }> = [];
  for (const p of posts) {
    // Each post is its page's project's work: that project's sign-in and login, never another's.
    const scope = { projectId: await projectOfRecord(orgId, p.pageRecordId).catch(() => null) };
    const login = await squarespaceLogin(orgId, scope);
    // The same kept sign-in as the draft run: going live starts signed in too.
    const connection = await squarespaceConnectionFor(orgId, p.siteUrl, scope).catch(() => null);
    const spec = { ...liveRun(p, { kept: connection?.signIn.kept === true, login }), keptSignIn: runSignInOf(connection) };
    const { run, queued } = await startOrQueue(orgId, owner, spec, true);
    await follow({ orgId, phase: 'live', browserRunId: run.id, pageRecordId: p.pageRecordId, siteUrl: p.siteUrl, blogPath: p.blogPath, slug: p.slug, title: p.title, owner, actionRunId: p.actionRunId, signInSourceId: connection?.sourceId ?? null });
    await recordOnPage(orgId, p.pageRecordId, { publishing: { kind: 'squarespace', phase: 'live', browserRunId: run.id, href: `/dashboard/browser/${run.id}`, at: new Date().toISOString(), note: queued ? 'Going live: waiting its turn in your browser.' : 'Going live.' } });
    started.push({ pageRecordId: p.pageRecordId, browserRunId: run.id, queued });
  }
  return started;
}

/** What the settle job carries between passes. */
export type SettleInput = {
  orgId: string;
  phase: 'draft' | 'live';
  browserRunId: number;
  pageRecordId: number | null;
  siteUrl: string;
  blogPath: string;
  slug: string;
  title: string;
  owner: RunOwner;
  /** The `site.publish_page` run, stamped when the post is confirmed live. */
  actionRunId?: number | null;
  /** The site's Squarespace connector, whose kept sign-in the run used; marked when it needs a fresh one. */
  signInSourceId?: number | null;
};

/**
 * One look at a Squarespace publish run: waiting its turn (started when it
 * is), still going, or ended — and then what it did, read back from the
 * site's public JSON by the post's slug alone and written on the page record.
 * A saved draft waits for the go-live card (`site.publish_live`).
 * @param input - The run and the page.
 */
export async function settlePublishRun(input: SettleInput): Promise<{ done: boolean; line?: string }> {
  const { getBrowserRun } = await import('@/services/browser/BrowserRunService');
  const run = await getBrowserRun(input.orgId, input.browserRunId);
  if (!run) {
    return { done: true, line: `Browser run ${input.browserRunId} is gone.` };
  }
  if (run.status === 'proposed') {
    await startWhenItsTurn(input.orgId, input.owner.userId, run.id);
    return { done: false };
  }
  if (['queued', 'running', 'waiting'].includes(run.status)) {
    return { done: false };
  }
  const { reportedStatus, postUrlOf } = await import('./squarespaceTask');
  const { findPublishedPost } = await import('@/libs/sources/squarespace');
  const at = new Date().toISOString();
  const runRef = { browserRunId: run.id, href: `/dashboard/browser/${run.id}` };
  const found = await findPublishedPost(input.siteUrl, input.blogPath, { slug: input.slug });
  const live = found.post;
  const editorUrl = typeof run.result?.editor_url === 'string' ? run.result.editor_url : null;
  if (live && run.status === 'done') {
    // Live on the site at this page's slug, read back from its public JSON: the one source a visitor sees.
    const line = input.phase === 'live'
      ? `"${input.title}" is live at ${live.url}.`
      : `"${input.title}" is live at ${live.url}: it went live during the draft run, which was told only to save a draft.`;
    await recordOnPage(input.orgId, input.pageRecordId, { status: 'published', publishedUrl: live.url, publishing: { kind: 'squarespace', phase: input.phase, ...runRef, readBackAt: at, note: line } });
    await markRunLive(input.orgId, input.actionRunId, { at, url: live.url, how: 'read-back' });
    return { done: true, line };
  }
  const { needsFreshSignIn } = await import('./squarespaceSignIn');
  if (needsFreshSignIn(run)) {
    // Not a failure: the work waits on a person signing in again, and carries on by itself after.
    return waitOnSignIn(input, runRef, at);
  }
  if (run.status !== 'done') {
    const line = `The ${input.phase === 'draft' ? 'draft' : 'going-live'} run ${run.status === 'stopped' ? 'was stopped' : `could not finish: ${run.error ?? run.summary ?? 'no reason given'}`}.${input.phase === 'live' ? ' The post stays a draft in Squarespace.' : ''}`;
    await recordOnPage(input.orgId, input.pageRecordId, { status: input.phase === 'draft' ? 'approved' : 'publishing', publishing: { kind: 'squarespace', phase: input.phase, ...runRef, at, error: line } });
    return { done: true, line };
  }
  if (input.phase === 'draft') {
    if (reportedStatus(run.result) === 'published') {
      // The run says live but the site does not list it yet: say both, never guess.
      const line = `The draft run says "${input.title}" is published, but ${input.blogPath}?format=json does not list it yet${found.why ? ` (${found.why})` : ''}.`;
      await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'draft', ...runRef, editorUrl, at, note: line } });
      return { done: true, line };
    }
    const line = `Saved "${input.title}" as a draft in Squarespace. Going live is one approval for the drafted posts (site.publish_live).`;
    await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', squarespaceDraftUrl: editorUrl, squarespaceDraft: { slug: input.slug, savedAt: at, browserRunId: run.id }, publishing: { kind: 'squarespace', phase: 'draft', ...runRef, editorUrl, at, note: line } });
    return { done: true, line };
  }
  const status = reportedStatus(run.result);
  const line = status === 'published'
    ? `The run published "${input.title}", but ${input.blogPath}?format=json does not list it yet${found.why ? ` (${found.why})` : ''}; it should be at ${postUrlOf(input)}.`
    : `"${input.title}" stays a draft in Squarespace: it was not published.`;
  await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'live', ...runRef, at, note: line } });
  return { done: true, line };
}

/**
 * A publish run Squarespace would not sign in: the connector says it needs a
 * fresh sign-in, and the page waits on it, publishing, with everything it
 * needs to carry on once a person has signed in (`resumeWaitingOnSignIn`).
 * @param input - The run and the page.
 * @param runRef - The run, as the page links it.
 * @param runRef.browserRunId - The run.
 * @param runRef.href - Its page.
 * @param at - When.
 */
async function waitOnSignIn(input: SettleInput, runRef: { browserRunId: number; href: string }, at: string): Promise<{ done: boolean; line: string }> {
  const { freshSignInLine } = await import('./squarespaceSignIn');
  const { markSignInNeeded } = await import('@/services/browser/keptSignIn');
  const line = freshSignInLine(input.siteUrl, Boolean(input.signInSourceId));
  if (input.signInSourceId) {
    await markSignInNeeded(input.orgId, input.signInSourceId, `Squarespace showed its sign-in page to browser run ${input.browserRunId} and would not sign it in.`).catch(error => console.warn('[publish] the connector could not be marked', { reason: (error as Error).message }));
  }
  const waiting: import('./squarespaceSignIn').WaitingOnSignIn = {
    waitingOn: 'sign-in',
    site: input.siteUrl,
    signInSourceId: input.signInSourceId ?? null,
    phase: input.phase,
    owner: input.owner,
    actionRunId: input.actionRunId ?? null,
    ...(input.phase === 'live' ? { post: { siteUrl: input.siteUrl, blogPath: input.blogPath, slug: input.slug, title: input.title } } : {}),
  };
  await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', publishing: { kind: 'squarespace', ...waiting, ...runRef, at, note: line } });
  return { done: true, line };
}
