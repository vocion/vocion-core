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
 *
 * Whatever happens is written on the page's record, so the batch page can show
 * the pull request, the draft or the live URL, with the run that made it.
 */

import type { PageFields, PublishTarget } from '@/libs/publish/targets';

export type PublishRequest = {
  pageRecordId?: number;
  projectId?: number;
  publishTargetId?: string;
  artifactId?: number;
  slug?: string;
  title?: string;
  metaDescription?: string;
};

export type PublishPlan = {
  project: { id: number; title: string };
  target: PublishTarget;
  page: PageFields & { recordId: number | null; descriptionFrom: 'given' | 'record' | 'first paragraph' };
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
  const para = markdown.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(?:#|[-*+]\s|\d+\.\s|>|```|\||!\[)/.test(p)) ?? '';
  const plain = para.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= 155) {
    return plain;
  }
  const cut = plain.slice(0, 155);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 100)).replace(/[,;:.\s]+$/, '')}…`;
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
  const { resolvePublishTarget, slugify, SLUG_RE } = await import('@/libs/publish/targets');

  let pageMeta: Meta = {};
  let pageTitle: string | null = null;
  if (input.pageRecordId) {
    const record = await readRecord(orgId, input.pageRecordId);
    if (!record) {
      return { ok: false, why: `There is no record #${input.pageRecordId} in this workspace.` };
    }
    pageMeta = record.meta;
    pageTitle = record.title;
  }

  const projectId = input.projectId ?? num(pageMeta.projectId);
  if (!projectId) {
    return { ok: false, why: input.pageRecordId ? `Record #${input.pageRecordId} belongs to no project (metadata.projectId), so there is nowhere it publishes to.` : 'Name the project the page belongs to (projectId).' };
  }
  const project = await readRecord(orgId, projectId);
  if (!project || project.typeSlug !== 'data_room') {
    return { ok: false, why: `#${projectId} is not a project in this workspace.` };
  }
  const resolved = resolvePublishTarget(project.meta.publishTargets, input.publishTargetId ?? text(pageMeta.publishTargetId));
  if (!resolved.ok) {
    return { ok: false, why: resolved.why };
  }
  if (resolved.target.kind === 'wordpress') {
    return { ok: false, why: 'Publishing to WordPress is not built yet: this project\'s target is WordPress.' };
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
  const markdown = artifact.kind === 'markdown' ? String(artifact.spec.md ?? '') : '';
  if (!markdown.trim()) {
    return { ok: false, why: `Artifact #${artifactId} (${artifact.title}) is ${artifact.kind === 'markdown' ? 'empty' : `a ${artifact.kind}, not a markdown draft`}.` };
  }

  const title = input.title ?? text(pageMeta.title) ?? pageTitle ?? artifact.title;
  const slug = input.slug ?? text(pageMeta.slug) ?? slugify(text(pageMeta.keyword) ?? title);
  if (!SLUG_RE.test(slug)) {
    return { ok: false, why: `"${slug}" is not a URL slug: lower case letters and digits joined by -.` };
  }
  const given = text(input.metaDescription);
  const recorded = text(pageMeta.metaDescription);
  const description = given ?? recorded ?? firstParagraph(markdown);
  return {
    ok: true,
    plan: {
      project: { id: project.id, title: project.title },
      target: resolved.target,
      page: { recordId: input.pageRecordId ?? null, title, slug, description, descriptionFrom: given ? 'given' : recorded ? 'record' : 'first paragraph', keyword: text(pageMeta.keyword), at: now },
      draft: { artifactId, title: artifact.title, version: artifact.currentVersion, markdown },
      before: input.pageRecordId ? { status: pageMeta.status ?? null, pullRequestUrl: pageMeta.pullRequestUrl ?? null, publishedUrl: pageMeta.publishedUrl ?? null } : null,
    },
  };
}

/**
 * Markdown rendered to HTML with the same renderer the app reads markdown
 * with (react-markdown, GitHub-flavoured), for a target that takes HTML.
 * @param markdown - The body.
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  const [{ createElement }, { renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import('react'),
    import('react-dom/server'),
    import('react-markdown'),
    import('remark-gfm'),
  ]);
  return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown));
}

/**
 * The file a GitHub target gets for this plan.
 * @param plan - The plan; its target must be github.
 */
export async function pageFileFor(plan: PublishPlan): Promise<{ path: string; format: string; content: string }> {
  const { formatOf, renderPageFile } = await import('@/libs/publish/targets');
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
  const { writeMeta } = await import('@/libs/actions/factory-dispatch');
  await writeMeta(orgId, recordId, set);
}

/**
 * The page as a pull request on the target's repository.
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be github.
 * @param by - Who approved it, for the description.
 */
export async function publishToGithub(orgId: string, plan: PublishPlan, by: string | null) {
  if (plan.target.kind !== 'github') {
    throw new Error('not a GitHub target');
  }
  const { openChangePull, PAGE_BRANCH_PREFIX } = await import('@/services/factory/githubChange');
  const file = await pageFileFor(plan);
  const body = [
    `Adds the page **${plan.page.title}** at \`${file.path}\`.`,
    '',
    `- Meta description: ${plan.page.description}`,
    `- Drafted in Vocion: artifact #${plan.draft.artifactId} (version ${plan.draft.version})${plan.page.recordId ? `, page record #${plan.page.recordId}` : ''}, project "${plan.project.title}".`,
    `- Approved in Vocion's Review${by ? ` by ${by}` : ''}.`,
    '',
    'Review it here and merge it when it is right. Vocion never merges a page; closing this pull request withdraws it.',
  ].join('\n');
  const opened = await openChangePull(orgId, {
    repo: plan.target.config.repo,
    title: `Add page: ${plan.page.title}`.slice(0, 200),
    body,
    files: [{ path: file.path, content: file.content }],
    base: plan.target.config.baseBranch ?? null,
    branch: `${PAGE_BRANCH_PREFIX}${plan.page.slug}`.slice(0, 200),
    prefix: PAGE_BRANCH_PREFIX,
  });
  return { ...opened, path: file.path, format: file.format };
}

/** Who the browser runs belong to: the person whose approval started them. */
export type RunOwner = { userId: string; conversationId: number | null; agentSlug: string | null };

/**
 * Start the Squarespace draft run, and the job that follows it.
 * @param orgId - The workspace.
 * @param plan - The plan; its target must be squarespace.
 * @param login - The editor login, from the vault.
 * @param login.email - The account's email.
 * @param login.password - Its password.
 * @param owner - Whose browser it runs in.
 */
export async function startSquarespaceDraft(orgId: string, plan: PublishPlan, login: { email: string; password: string }, owner: RunOwner) {
  if (plan.target.kind !== 'squarespace') {
    throw new Error('not a Squarespace target');
  }
  const { draftRun, postUrlOf } = await import('./squarespaceTask');
  const { createBrowserRun } = await import('@/services/browser/BrowserRunService');
  const blogPath = plan.target.config.blogPath ?? '/blog';
  const post = {
    siteUrl: plan.target.config.siteUrl,
    blogPath,
    title: plan.page.title,
    slug: plan.page.slug,
    bodyMarkdown: plan.draft.markdown.replace(/^\s*#\s+[^\n]*\n+/, '').trim(),
    excerpt: plan.page.description,
    seoTitle: plan.page.title,
    seoDescription: plan.page.description,
  };
  const spec = draftRun(post, login);
  const run = await createBrowserRun({
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
    start: true,
    approvedAhead: spec.approvedAhead,
  });
  const settle: SettleInput = { orgId, phase: 'draft', browserRunId: run.id, pageRecordId: plan.page.recordId, siteUrl: plan.target.config.siteUrl, blogPath, slug: plan.page.slug, title: plan.page.title, owner };
  const { startJob } = await import('@/libs/durable/jobs');
  const { JOB } = await import('@/services/background/catalog');
  const followed = await startJob(`site-publish-settle:${run.id}`, { job: JOB.sitePublishSettle, input: settle }).then(() => true, (error: Error) => {
    console.warn('[publish] the read-back job could not start', { run: run.id, reason: error.message });
    return false;
  });
  return { browserRunId: run.id, postUrl: postUrlOf(post), followed };
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
};

/**
 * One look at a Squarespace publish run: still going, or ended — and then
 * what it did, read back from the site's public JSON and written on the page
 * record. A draft that saved starts the going-live run in the same browser
 * (its Publish click waits for the person) and hands the job on to it.
 * @param input - The run and the page.
 */
export async function settlePublishRun(input: SettleInput): Promise<{ done: boolean; next?: SettleInput; line?: string }> {
  const { getBrowserRun } = await import('@/services/browser/BrowserRunService');
  const run = await getBrowserRun(input.orgId, input.browserRunId);
  if (!run) {
    return { done: true, line: `Browser run ${input.browserRunId} is gone.` };
  }
  if (['proposed', 'queued', 'running', 'waiting'].includes(run.status)) {
    return { done: false };
  }
  const { reportedStatus, liveRun, postUrlOf } = await import('./squarespaceTask');
  const { findPublishedPost } = await import('@/libs/sources/squarespace');
  const at = new Date().toISOString();
  const runRef = { browserRunId: run.id, href: `/dashboard/browser/${run.id}` };
  const found = await findPublishedPost(input.siteUrl, input.blogPath, { slug: input.slug, title: input.title });
  const live = found.post;
  if (live) {
    // Live on the site, read back from its public JSON: the one source a visitor sees.
    const line = input.phase === 'live'
      ? `"${input.title}" is live at ${live.url}.`
      : run.status === 'done'
        ? `"${input.title}" is live at ${live.url}: it went live during the draft run, which was told only to save a draft.`
        : `"${input.title}" was already live at ${live.url}; the draft run changed nothing.`;
    await recordOnPage(input.orgId, input.pageRecordId, { status: 'published', publishedUrl: live.url, publishing: { kind: 'squarespace', phase: input.phase, ...runRef, readBackAt: at, note: line } });
    return { done: true, line };
  }
  if (run.status !== 'done') {
    const line = `The ${input.phase === 'draft' ? 'draft' : 'going-live'} run ${run.status === 'stopped' ? 'was stopped' : `could not finish: ${run.error ?? run.summary ?? 'no reason given'}`}.${input.phase === 'live' ? ' The post stays a draft in Squarespace.' : ''}`;
    await recordOnPage(input.orgId, input.pageRecordId, { status: input.phase === 'draft' ? 'approved' : 'publishing', publishing: { kind: 'squarespace', phase: input.phase, ...runRef, at, error: line } });
    return { done: true, line };
  }
  const editorUrl = typeof run.result?.editor_url === 'string' ? run.result.editor_url : null;
  if (input.phase === 'draft') {
    if (reportedStatus(run.result) === 'published') {
      // The run says live but the site does not list it yet: say both, never guess.
      const line = `The draft run says "${input.title}" is published, but ${input.blogPath}?format=json does not list it yet${found.why ? ` (${found.why})` : ''}.`;
      await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'draft', ...runRef, editorUrl, at, note: line } });
      return { done: true, line };
    }
    await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', squarespaceDraftUrl: editorUrl, publishing: { kind: 'squarespace', phase: 'draft', ...runRef, editorUrl, at, note: `Saved as a draft in Squarespace; going live waits for your approval.` } });
    const { createBrowserRun, BrowserRunBusyError } = await import('@/services/browser/BrowserRunService');
    const spec = liveRun({ siteUrl: input.siteUrl, blogPath: input.blogPath, title: input.title, slug: input.slug }, editorUrl);
    const make = (start: boolean) => createBrowserRun({ orgId: input.orgId, userId: input.owner.userId, conversationId: input.owner.conversationId, agentSlug: input.owner.agentSlug, task: spec.task, startUrl: spec.startUrl, inputs: spec.inputs, secretNames: spec.secretNames, outputs: spec.outputs, proposedBy: 'person', start, continuing: start });
    // The person's browser may be busy with something else by now: then it waits for their Start.
    const next = await make(true).catch(async (error) => {
      if (error instanceof BrowserRunBusyError) {
        return make(false);
      }
      throw error;
    });
    const { browserRunLabel } = await import('@/libs/browser/run');
    return { done: false, next: { ...input, phase: 'live', browserRunId: next.id }, line: `Saved "${input.title}" as a draft; ${browserRunLabel(next.id)} publishes it when you approve.` };
  }
  const status = reportedStatus(run.result);
  const line = status === 'published'
    ? `The run published "${input.title}", but ${input.blogPath}?format=json does not list it yet${found.why ? ` (${found.why})` : ''}; it should be at ${postUrlOf(input)}.`
    : `"${input.title}" stays a draft in Squarespace: going live was not approved.`;
  await recordOnPage(input.orgId, input.pageRecordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'live', ...runRef, at, note: line } });
  return { done: true, line };
}
