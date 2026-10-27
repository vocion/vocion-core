/**
 * `site.publish_page` — A PAGE GOES TO THE CLIENT'S SITE, after a person
 * approves it on Review (`services/publish/sitePublish.ts`).
 *
 * The page is a draft artifact and, usually, the record that tracks it (an
 * `seo_page`): `{ pageRecordId }` reads the rest from the record, and the
 * explicit form `{ projectId, publishTargetId, artifactId, slug, title,
 * metaDescription }` publishes a draft no record tracks yet. Explicit fields
 * win over the record's. The target is the Project's (`publishTargets`).
 *
 * - **GitHub**: one commit with the page file on `vocion/seo-<slug>` and its
 *   pull request; the record gets `pullRequestUrl`. Undo closes the pull
 *   request and deletes the branch. Never merged from Vocion.
 * - **Squarespace**: a browser run in the approver's browser saves the post as
 *   a draft (this approval covers its Save); a second run publishes it, and
 *   that click waits for the person. The post's live URL is read back from the
 *   site's public JSON. No Undo: the post is the site's now, and deleting it is
 *   a person's call in Squarespace.
 *
 * Every run waits for a person (`approvalRequired`): what reaches a client's
 * site is never an agent's decision alone.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

export const PUBLISH_PAGE_ACTION_ID = 'site.publish_page';

const publishPageInput = z.object({
  pageRecordId: z.coerce.number().int().positive().optional().describe('The page\'s record (an seo_page): its project, draft, target, title and slug are read from it.'),
  projectId: z.coerce.number().int().positive().optional().describe('The project the page belongs to, when no record names it.'),
  publishTargetId: z.string().min(1).max(64).optional().describe('Which of the project\'s publish targets, when it has more than one.'),
  artifactId: z.coerce.number().int().positive().optional().describe('The draft: a markdown artifact.'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower case words joined by -').max(80).optional().describe('The URL slug, e.g. choose-a-three-season-tent.'),
  title: z.string().min(3).max(200).optional().describe('The page\'s title.'),
  metaDescription: z.string().min(20).max(320).optional().describe('The meta description, about 150 characters.'),
}).refine(i => Boolean(i.pageRecordId || (i.projectId && i.artifactId)), { message: 'Name the page record (pageRecordId), or the project and the draft (projectId and artifactId).' });

type Input = z.infer<typeof publishPageInput>;

/**
 * The person whose browser a Squarespace run uses: whoever approved it, else
 * the person who asked for it.
 * @param ctx - The action's context.
 * @param ctx.reviewedBy - Who approved it on Review.
 * @param ctx.origin - Where it was proposed.
 * @param ctx.origin.userId - The person whose turn it was.
 * @param ctx.invokedBy - Who invoked it.
 */
function personOf(ctx: { reviewedBy?: string; origin?: { userId?: string | null }; invokedBy?: string }): string | null {
  const plain = (v: string | null | undefined) => (v && !v.includes(':') ? v : null);
  return plain(ctx.reviewedBy) ?? plain(ctx.origin?.userId) ?? plain(ctx.invokedBy);
}

export const sitePublishPageAction: Action<typeof publishPageInput> = {
  id: PUBLISH_PAGE_ACTION_ID,
  name: 'Publish a page to the client\'s site',
  description: 'Publish an approved page to its project\'s site: on GitHub a pull request with the page file (frontmatter in the site\'s own shape), on Squarespace a draft post saved in the editor and then published when the person approves. Give pageRecordId, or projectId and artifactId with title and slug. Undo closes a GitHub pull request and deletes its branch.',
  inputSchema: publishPageInput,
  grant: 'publish_page',
  external: true,
  approvalRequired: true,
  dedupKeyFor: input => (input.pageRecordId ? `${PUBLISH_PAGE_ACTION_ID}:page:${input.pageRecordId}` : `${PUBLISH_PAGE_ACTION_ID}:${input.projectId}:${input.artifactId}:${input.slug ?? ''}`),
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const { planPublish } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(ctx.orgId, input);
    if (!planned.ok) {
      return planned.why;
    }
    const { plan } = planned;
    if (plan.target.kind === 'github') {
      const { pageFileFor } = await import('@/services/publish/sitePublish');
      await pageFileFor(plan);
      return undefined;
    }
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    const login = await getCredentialsForSource(ctx.orgId, 'squarespace').catch(() => undefined) as Record<string, unknown> | undefined;
    if (!login?.email || !login?.password) {
      return 'No Squarespace editor login is stored. Connect Squarespace (Connectors → Squarespace) with the email and password of an account that can edit the site; publishing signs in to the editor with it.';
    }
    return undefined;
  },
  async reviewCard(ctx, raw): Promise<ReviewCard> {
    const input = raw as Input;
    const { planPublish } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(ctx.orgId, input);
    if (!planned.ok) {
      return { title: 'Publish a page', system: 'Site', headline: planned.why, fields: [] };
    }
    const { plan } = planned;
    const { publishTargetLine } = await import('@/libs/publish/targets');
    const draftLink = { kind: 'document' as const, id: 'draft', label: plan.draft.title, tabLabel: 'Draft', href: `/dashboard/artifacts/${plan.draft.artifactId}`, version: String(plan.draft.version), summary: plan.page.description };
    const preview = { kind: 'text' as const, id: 'preview', label: plan.page.title, tabLabel: 'Preview', body: plan.draft.markdown, markdown: true };
    const descriptionField = { label: 'Meta description', value: plan.page.descriptionFrom === 'first paragraph' ? `${plan.page.description} (none was written; this is the draft's first paragraph)` : plan.page.description };
    if (plan.target.kind === 'github') {
      const { pageFileFor } = await import('@/services/publish/sitePublish');
      const file = await pageFileFor(plan);
      return {
        title: `Publish "${plan.page.title}" to ${plan.target.config.repo}`,
        system: 'GitHub',
        object: { title: plan.page.title, subtitle: `${plan.project.title} · ${file.path}`, section: 'Pages' },
        headline: `Open a pull request on ${plan.target.config.repo} adding ${file.path}. Nothing merges until the client's team merges it.`,
        badges: [{ label: 'GitHub' }, { label: 'Pull request, not merged' }, { label: 'Undo closes it' }],
        fields: [
          { label: 'Target', value: publishTargetLine(plan.target), href: `https://github.com/${plan.target.config.repo}` },
          { label: 'Path', value: file.path },
          { label: 'Branch', value: `vocion/seo-${plan.page.slug}` },
          { label: 'Title', value: plan.page.title },
          descriptionField,
          { label: 'Project', value: plan.project.title },
        ],
        contentHeading: { label: 'The page', meta: `draft v${plan.draft.version}` },
        content: [preview, { kind: 'text', id: 'file', label: file.path, tabLabel: 'File', body: file.content, preformatted: true }, draftLink],
        nextAction: 'Approving opens the pull request now.',
        verbs: { approve: 'Open the pull request', reject: 'Not yet' },
      };
    }
    const { postUrlOf } = await import('@/services/publish/squarespaceTask');
    const blogPath = plan.target.kind === 'squarespace' ? plan.target.config.blogPath ?? '/blog' : '/blog';
    const siteUrl = plan.target.config.siteUrl;
    return {
      title: `Publish "${plan.page.title}" to ${siteUrl.replace(/^https:\/\//, '')}`,
      system: 'Squarespace',
      object: { title: plan.page.title, subtitle: `${plan.project.title} · ${blogPath}/${plan.page.slug}`, section: 'Pages' },
      headline: 'Save this post as a draft in the site\'s Squarespace editor, signed in with the stored login. Going live is a second click that waits for you, with the draft on screen.',
      badges: [{ label: 'Squarespace' }, { label: 'Draft first' }, { label: 'No Undo once saved', tone: 'warn' }],
      fields: [
        { label: 'Target', value: publishTargetLine(plan.target), href: `${siteUrl.replace(/\/+$/, '')}${blogPath}` },
        { label: 'URL once live', value: postUrlOf({ siteUrl, blogPath, slug: plan.page.slug }) },
        { label: 'Title', value: plan.page.title },
        descriptionField,
        { label: 'Project', value: plan.project.title },
      ],
      contentHeading: { label: 'The post', meta: `draft v${plan.draft.version}` },
      content: [preview, draftLink],
      nextAction: 'Approving starts a browser run in your browser that saves the draft; it then asks you before it publishes.',
      verbs: { approve: 'Save the draft', reject: 'Not yet' },
    };
  },
  async execute(ctx, input) {
    const { followPull, planPublish, publishToGithub, recordOnPage, startSquarespaceDraft } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(ctx.orgId, input);
    if (!planned.ok) {
      throw new Error(planned.why);
    }
    const { plan } = planned;
    const at = new Date().toISOString();
    const base = { targetId: plan.target.id, kind: plan.target.kind, pageRecordId: plan.page.recordId, slug: plan.page.slug, before: plan.before };
    if (plan.target.kind === 'github') {
      const opened = await publishToGithub(ctx.orgId, plan, ctx.reviewedBy ?? null);
      const line = `${opened.created ? 'Opened' : 'Added a commit to'} ${opened.url.replace('https://github.com/', '')}: ${opened.path}. The client's team merges it; Undo closes it.`;
      await recordOnPage(ctx.orgId, plan.page.recordId, { status: 'publishing', pullRequestUrl: opened.url, publishing: { kind: 'github', targetId: plan.target.id, branch: opened.branch, path: opened.path, at, by: ctx.reviewedBy ?? ctx.invokedBy ?? null, actionRunId: ctx.runId ?? null } });
      // Published when the client's team merges it: followed, never merged from here.
      await followPull({ orgId: ctx.orgId, repo: opened.repo, number: opened.number, url: opened.url, pageRecordId: plan.page.recordId });
      return { ...base, published: true, url: opened.url, repo: opened.repo, branch: opened.branch, number: opened.number, path: opened.path, created: opened.created, line };
    }
    if (plan.target.kind !== 'squarespace') {
      throw new Error('Publishing to this kind of target is not built yet.');
    }
    const userId = personOf(ctx);
    if (!userId) {
      throw new Error('A Squarespace publish runs in a person\'s browser: it needs a person to approve it.');
    }
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    const login = await getCredentialsForSource(ctx.orgId, 'squarespace') as Record<string, unknown> | undefined;
    if (typeof login?.email !== 'string' || typeof login?.password !== 'string') {
      throw new TypeError('No Squarespace editor login is stored: connect Squarespace with the email and password of an account that can edit the site.');
    }
    const started = await startSquarespaceDraft(ctx.orgId, plan, { email: login.email, password: login.password }, {
      userId,
      conversationId: ctx.origin?.conversationId ?? null,
      agentSlug: ctx.invokedBy?.startsWith('agent:') ? ctx.invokedBy.slice('agent:'.length) : null,
    });
    await recordOnPage(ctx.orgId, plan.page.recordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'draft', targetId: plan.target.id, browserRunId: started.browserRunId, href: `/dashboard/browser/${started.browserRunId}`, at, by: userId, actionRunId: ctx.runId ?? null } });
    const line = `Browser run ${started.browserRunId} is saving "${plan.page.title}" as a draft on ${plan.target.config.siteUrl}; it asks you before it publishes.${started.followed ? '' : ' Its result will not be read back on its own: check the run.'}`;
    return { ...base, published: false, browserRunId: started.browserRunId, link: `/dashboard/browser/${started.browserRunId}`, postUrl: started.postUrl, line };
  },
  canUndo: result => result?.kind === 'github' && typeof result.url === 'string',
  async undo(ctx, _input, result) {
    if (result?.kind !== 'github' || typeof result.url !== 'string' || typeof result.branch !== 'string' || typeof result.repo !== 'string') {
      return { note: 'A Squarespace post is the site\'s once saved: delete it in the Squarespace editor if it should go.' };
    }
    const { discardChange } = await import('@/services/factory/githubChange');
    const out = await discardChange(ctx.orgId, { url: result.url, repo: result.repo, branch: result.branch });
    const before = (result.before ?? null) as { status?: unknown; pullRequestUrl?: unknown } | null;
    const { recordOnPage } = await import('@/services/publish/sitePublish');
    await recordOnPage(ctx.orgId, typeof result.pageRecordId === 'number' ? result.pageRecordId : null, { status: before?.status ?? 'approved', pullRequestUrl: before?.pullRequestUrl ?? null, publishing: { kind: 'github', withdrawnAt: new Date().toISOString(), url: result.url, revertUrl: out.revertUrl } });
    return { ...out, note: out.revertUrl ? `It had merged; the revert is open at ${out.revertUrl}.` : 'The pull request is closed and its branch deleted.' };
  },
};
