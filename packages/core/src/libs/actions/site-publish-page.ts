/**
 * `site.publish_page` and `site.publish_live` — A PAGE GOES TO THE CLIENT'S
 * SITE, after a person approves it on Review (`services/publish/sitePublish.ts`).
 *
 * The page is a draft artifact and, usually, the record that tracks it (an
 * `seo_page`, whose sign-off must cover the very version published):
 * `{ pageRecordId }` reads the rest from the record, and the explicit form
 * `{ projectId, publishTargetId, artifactId, slug, title, metaDescription }`
 * publishes a draft no record tracks, in a project whose pages the SEO app
 * does not track. Explicit fields win over the record's. The target is the
 * Project's (`publishTargets`).
 *
 * - **GitHub**: one commit with the page file on a branch of its own
 *   (`vocion/seo-<slug>-p<record>`) and its pull request; the record gets
 *   `pullRequestUrl`, then its checks and preview, then `published` when the
 *   client's team merges it. A file already at the path is replaced only on a
 *   refresh. Undo closes the pull request and deletes the branch. Never merged
 *   from Vocion.
 * - **Squarespace**: a browser run in the approver's browser saves the post
 *   as a draft (queued behind their other publish runs). Going live is
 *   `site.publish_live`: one card for the drafted posts, one run each, in
 *   turn. The live URL is read back from the site's public JSON by slug. No
 *   Undo: the post is the site's now, and deleting it is a person's call.
 *
 * Every run waits for a person and for their decision on the card itself
 * (`approvalRequired`, `requiresReviewDecision`): what reaches a client's
 * site is never decided by a word in chat alone.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

export const PUBLISH_PAGE_ACTION_ID = 'site.publish_page';
export const PUBLISH_LIVE_ACTION_ID = 'site.publish_live';

const publishPageInput = z.object({
  pageRecordId: z.coerce.number().int().positive().optional().describe('The page\'s record (an seo_page): its project, draft, target, title, slug and meta fields are read from it.'),
  projectId: z.coerce.number().int().positive().optional().describe('The project the page belongs to, when no record names it.'),
  publishTargetId: z.string().min(1).max(64).optional().describe('Which of the project\'s publish targets, when it has more than one.'),
  artifactId: z.coerce.number().int().positive().optional().describe('The draft: a markdown artifact.'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower case words joined by -').max(80).optional().describe('The URL slug, e.g. choose-a-three-season-tent.'),
  title: z.string().min(3).max(200).optional().describe('The page\'s title.'),
  metaTitle: z.string().min(3).max(120).optional().describe('The title search engines show, about 60 characters.'),
  metaDescription: z.string().min(20).max(320).optional().describe('The meta description, about 150 characters.'),
  refresh: z.boolean().optional().describe('The page replaces one already on the site at its path.'),
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

/**
 * Whose browser the runs use, and where they report.
 * @param ctx - The action's context.
 * @param ctx.reviewedBy - Who approved it on Review.
 * @param ctx.origin - Where it was proposed.
 * @param ctx.origin.userId - The person whose turn it was.
 * @param ctx.origin.conversationId - The conversation it was proposed in.
 * @param ctx.invokedBy - Who invoked it.
 */
function ownerOf(ctx: { reviewedBy?: string; origin?: { userId?: string | null; conversationId?: number | null }; invokedBy?: string }) {
  const userId = personOf(ctx);
  if (!userId) {
    throw new Error('A Squarespace publish runs in a person\'s browser: it needs a person to approve it.');
  }
  return { userId, conversationId: ctx.origin?.conversationId ?? null, agentSlug: ctx.invokedBy?.startsWith('agent:') ? ctx.invokedBy.slice('agent:'.length) : null };
}

/**
 * How a Squarespace publish signs in to this site: the stored login, and
 * whether the site's connector keeps a sign-in. Null when it has neither.
 * @param orgId - The workspace.
 * @param siteUrl - The site.
 */
async function squarespaceSignIn(orgId: string, siteUrl: string) {
  const { squarespaceLogin } = await import('@/services/publish/sitePublish');
  const { squarespaceConnectionFor } = await import('@/services/publish/squarespaceSignIn');
  const [login, connection] = await Promise.all([squarespaceLogin(orgId), squarespaceConnectionFor(orgId, siteUrl).catch(() => null)]);
  return login || connection?.signIn.kept ? { login, kept: connection?.signIn.kept === true } : null;
}

/**
 * A publish proposal's title: `Publish "<page title>" → <target label>`, the
 * target by the label the project gave it, else where it points.
 * @param plan - The plan.
 * @param verb - `Publish`, or `Replace` for a page already at its path.
 */
export async function publishTitle(plan: Pick<import('@/services/publish/sitePublish').PublishPlan, 'page' | 'target'>, verb = 'Publish'): Promise<string> {
  const { publishTargetLine } = await import('@/libs/publish/targets');
  const where = plan.target.label?.trim() || publishTargetLine(plan.target);
  return `${verb} "${plan.page.title}" → ${where}`.slice(0, 200);
}

const NO_LOGIN = 'There is no way to sign in to this Squarespace site yet. Connect it under Connectors → Squarespace and sign in once (Sign in again, or Upload a session file under Advanced), or store the email and password of an account that can edit it; publishing signs in to the editor with that.';

export const sitePublishPageAction: Action<typeof publishPageInput> = {
  id: PUBLISH_PAGE_ACTION_ID,
  name: 'Publish a page to the client\'s site',
  description: 'Publish a signed-off page to its project\'s site: on GitHub a pull request with the page file (frontmatter in the site\'s own shape), on Squarespace a draft post saved in the editor (going live is site.publish_live). Give pageRecordId; projectId and artifactId only for a project the SEO app does not track. Undo closes a GitHub pull request and deletes its branch.',
  inputSchema: publishPageInput,
  grant: 'publish_page',
  external: true,
  approvalRequired: true,
  requiresReviewDecision: true,
  dedupKeyFor: input => (input.pageRecordId ? `${PUBLISH_PAGE_ACTION_ID}:page:${input.pageRecordId}` : `${PUBLISH_PAGE_ACTION_ID}:${input.projectId}:${input.artifactId}:${input.slug ?? ''}`),
  ownsDedupKey: true,
  // Every surface that lists the proposal reads `Publish "<page>" → <where>`, never "Site publish page".
  async proposalTitle(ctx, input) {
    const { planPublish } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(ctx.orgId, input).catch(() => null);
    return planned?.ok ? await publishTitle(planned.plan) : null;
  },
  async precheck(ctx, input) {
    const { planPublish, githubPreflight, squarespaceSlugCheck } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(ctx.orgId, input);
    if (!planned.ok) {
      return planned.why;
    }
    const { plan } = planned;
    if (plan.target.kind === 'github') {
      return (await githubPreflight(ctx.orgId, plan)).why;
    }
    if (plan.target.kind === 'squarespace' && !await squarespaceSignIn(ctx.orgId, plan.target.config.siteUrl)) {
      return NO_LOGIN;
    }
    return (await squarespaceSlugCheck(plan)) ?? undefined;
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
    const { markdownToHtml } = await import('@/services/publish/sitePublish');
    const preview = { kind: 'text' as const, id: 'preview', label: plan.page.title, tabLabel: 'Preview', body: plan.draft.markdown, html: await markdownToHtml(plan.draft.markdown) };
    const metaFields = [
      { label: 'Title', value: plan.page.title },
      { label: 'Meta title', value: plan.page.metaTitle ?? plan.page.title },
      { label: 'Meta description', value: plan.page.descriptionFrom === 'first paragraph' ? `${plan.page.description} (none was written; this is the draft's first paragraph)` : plan.page.description },
    ];
    if (plan.target.kind === 'github') {
      const { githubPreflight } = await import('@/services/publish/sitePublish');
      const pre = await githubPreflight(ctx.orgId, plan);
      const replacing = pre.exists === true;
      return {
        title: await publishTitle(plan, replacing ? 'Replace' : 'Publish'),
        system: 'GitHub',
        object: { title: plan.page.title, subtitle: `${plan.project.title} · ${pre.file.path}`, section: 'Pages' },
        headline: replacing
          ? `Open a pull request on ${plan.target.config.repo} replacing ${pre.file.path}, which is already on ${pre.base}. Nothing merges until the client's team merges it.`
          : `Open a pull request on ${plan.target.config.repo} adding ${pre.file.path}. Nothing merges until the client's team merges it.`,
        badges: [{ label: 'GitHub' }, ...(replacing ? [{ label: 'Replaces a page', tone: 'warn' as const }] : []), { label: 'Pull request, not merged' }, { label: 'Undo closes it' }],
        fields: [
          { label: 'Target', value: publishTargetLine(plan.target), href: `https://github.com/${plan.target.config.repo}` },
          { label: 'Path', value: `${pre.file.path}${replacing ? ' (replacing)' : ''}` },
          { label: 'Branch', value: pre.branch },
          ...metaFields,
          { label: 'Project', value: plan.project.title },
        ],
        contentHeading: { label: 'The page', meta: `draft v${plan.draft.version}` },
        content: [preview, { kind: 'text', id: 'file', label: pre.file.path, tabLabel: 'File', body: pre.file.content, preformatted: true }, draftLink],
        nextAction: 'Approving opens the pull request now.',
        verbs: { approve: 'Open the pull request', reject: 'Not yet' },
      };
    }
    const { postUrlOf } = await import('@/services/publish/squarespaceTask');
    const blogPath = plan.target.kind === 'squarespace' ? plan.target.config.blogPath ?? '/blog' : '/blog';
    const siteUrl = plan.target.config.siteUrl;
    return {
      title: `Save "${plan.page.title}" as a draft on ${siteUrl.replace(/^https:\/\//, '')}`,
      system: 'Squarespace',
      object: { title: plan.page.title, subtitle: `${plan.project.title} · ${blogPath}/${plan.page.slug}`, section: 'Pages' },
      headline: 'Save this post as a draft in the site\'s Squarespace editor, signed in with the site\'s kept sign-in (or the stored login). It never goes live here: going live is its own card, for the drafted posts together.',
      badges: [{ label: 'Squarespace' }, { label: 'Draft only' }, { label: 'No Undo once saved', tone: 'warn' }],
      fields: [
        { label: 'Target', value: publishTargetLine(plan.target), href: `${siteUrl.replace(/\/+$/, '')}${blogPath}` },
        { label: 'URL once live', value: postUrlOf({ siteUrl, blogPath, slug: plan.page.slug }) },
        ...metaFields,
        { label: 'Project', value: plan.project.title },
      ],
      contentHeading: { label: 'The post', meta: `draft v${plan.draft.version}` },
      content: [preview, draftLink],
      nextAction: 'Approving starts a browser run in your browser that saves the draft, after any publish runs already waiting.',
      verbs: { approve: 'Save the draft', reject: 'Not yet' },
    };
  },
  async execute(ctx, input) {
    const { followPull, planPublish, publishToGithub, recordOnPage, squarespaceSlugCheck, startSquarespaceDraft } = await import('@/services/publish/sitePublish');
    const planned = await planPublish(ctx.orgId, input);
    if (!planned.ok) {
      throw new Error(planned.why);
    }
    const { plan } = planned;
    const at = new Date().toISOString();
    const base = { targetId: plan.target.id, kind: plan.target.kind, pageRecordId: plan.page.recordId, slug: plan.page.slug, before: plan.before };
    if (plan.target.kind === 'github') {
      const opened = await publishToGithub(ctx.orgId, plan, ctx.reviewedBy ?? null);
      const line = `${opened.created ? 'Opened' : 'Added a commit to'} ${opened.url.replace('https://github.com/', '')}: ${opened.replaced ? 'replacing' : 'adding'} ${opened.path}. The client's team merges it; Undo closes it.`;
      await recordOnPage(ctx.orgId, plan.page.recordId, { status: 'publishing', pullRequestUrl: opened.url, publishing: { kind: 'github', targetId: plan.target.id, branch: opened.branch, path: opened.path, replaced: opened.replaced, at, by: ctx.reviewedBy ?? ctx.invokedBy ?? null, actionRunId: ctx.runId ?? null } });
      // Published when the client's team merges it: followed, never merged from here.
      await followPull({ orgId: ctx.orgId, repo: opened.repo, number: opened.number, url: opened.url, pageRecordId: plan.page.recordId, actionRunId: ctx.runId ?? null });
      // The Done line reads this (`libs/decisions/receipt.ts` `outcomeOf`): "Pull request opened: <link>".
      const receipt = { text: opened.created ? 'Pull request opened' : 'Pull request updated', href: opened.url, linkLabel: `${opened.repo}#${opened.number}` };
      return { ...base, published: false, url: opened.url, repo: opened.repo, branch: opened.branch, number: opened.number, path: opened.path, created: opened.created, replaced: opened.replaced, line, receipt };
    }
    if (plan.target.kind !== 'squarespace') {
      throw new Error('Publishing to this kind of target is not built yet.');
    }
    const owner = ownerOf(ctx);
    const signIn = await squarespaceSignIn(ctx.orgId, plan.target.config.siteUrl);
    if (!signIn) {
      throw new Error(NO_LOGIN);
    }
    const taken = await squarespaceSlugCheck(plan);
    if (taken) {
      throw new Error(taken);
    }
    const started = await startSquarespaceDraft(ctx.orgId, plan, signIn.login, owner, ctx.runId ?? null);
    await recordOnPage(ctx.orgId, plan.page.recordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'draft', targetId: plan.target.id, browserRunId: started.browserRunId, href: `/dashboard/browser/${started.browserRunId}`, at, by: owner.userId, actionRunId: ctx.runId ?? null, ...(started.queued ? { note: 'Waiting its turn in your browser.' } : {}) } });
    const line = `Browser run ${started.browserRunId} ${started.queued ? 'is queued to save' : 'is saving'} "${plan.page.title}" as a draft on ${plan.target.config.siteUrl}.${started.followed ? '' : ' Its result will not be read back on its own: check the run.'}`;
    const receipt = { text: started.queued ? 'Draft queued for Squarespace' : 'Saving the draft in Squarespace', href: `/dashboard/browser/${started.browserRunId}`, linkLabel: 'the browser run' };
    return { ...base, published: false, browserRunId: started.browserRunId, queued: started.queued, link: `/dashboard/browser/${started.browserRunId}`, postUrl: started.postUrl, line, receipt };
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

const publishLiveInput = z.object({
  pageRecordIds: z.array(z.coerce.number().int().positive()).min(1).max(50).describe('The pages whose Squarespace drafts go live, in the order they go.'),
});

type LiveInput = z.infer<typeof publishLiveInput>;

/**
 * The drafted Squarespace posts among these pages, and why each other one is not.
 * @param orgId - The workspace.
 * @param ids - The pages.
 */
async function draftedPosts(orgId: string, ids: number[]) {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const { resolvePublishTarget } = await import('@/libs/publish/targets');
  const posts: Array<{ pageRecordId: number; title: string; siteUrl: string; blogPath: string; slug: string; actionRunId: number | null }> = [];
  const problems: string[] = [];
  for (const id of [...new Set(ids)]) {
    const page = await readRecord(orgId, id);
    const draft = page?.meta.squarespaceDraft as { slug?: string } | undefined;
    const publishing = (page?.meta.publishing ?? {}) as { targetId?: string; actionRunId?: number };
    if (!page || !draft?.slug) {
      problems.push(`#${id}${page ? ` "${page.title}"` : ''} has no Squarespace draft saved yet`);
      continue;
    }
    if (page.meta.status === 'published') {
      problems.push(`"${page.title}" is already live`);
      continue;
    }
    const project = typeof page.meta.projectId === 'number' ? await readRecord(orgId, page.meta.projectId) : null;
    const target = resolvePublishTarget(project?.meta.publishTargets, publishing.targetId ?? (page.meta.publishTargetId as string | undefined));
    if (!target.ok || target.target.kind !== 'squarespace') {
      problems.push(`"${page.title}": ${target.ok ? 'its target is not Squarespace' : target.why}`);
      continue;
    }
    posts.push({ pageRecordId: id, title: page.title, siteUrl: target.target.config.siteUrl, blogPath: target.target.config.blogPath ?? '/blog', slug: draft.slug, actionRunId: typeof publishing.actionRunId === 'number' ? publishing.actionRunId : null });
  }
  return { posts, problems };
}

export const sitePublishLiveAction: Action<typeof publishLiveInput> = {
  id: PUBLISH_LIVE_ACTION_ID,
  name: 'Take drafted posts live on Squarespace',
  description: 'Publish Squarespace drafts that site.publish_page saved: one approval for the listed pages, then one browser run per post, in turn, each pressing Publish on its own draft and read back from the site. Give pageRecordIds.',
  inputSchema: publishLiveInput,
  grant: 'publish_page',
  external: true,
  approvalRequired: true,
  requiresReviewDecision: true,
  dedupKeyFor: input => `${PUBLISH_LIVE_ACTION_ID}:${[...new Set(input.pageRecordIds)].sort((a, b) => a - b).join(',')}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const { posts, problems } = await draftedPosts(ctx.orgId, input.pageRecordIds);
    if (problems.length > 0) {
      return `Not all of these can go live: ${problems.join('; ')}.`;
    }
    return posts.length === 0 ? 'None of these pages has a Squarespace draft to publish.' : undefined;
  },
  async reviewCard(ctx, raw): Promise<ReviewCard> {
    const input = raw as LiveInput;
    const { posts, problems } = await draftedPosts(ctx.orgId, input.pageRecordIds);
    const { postUrlOf } = await import('@/services/publish/squarespaceTask');
    return {
      title: `Publish ${posts.length} drafted post${posts.length === 1 ? '' : 's'} on Squarespace`,
      system: 'Squarespace',
      headline: `Each draft goes live in turn: one browser run per post presses Publish on that post and nothing else, then reads it back from the site.${problems.length > 0 ? ` Not included: ${problems.join('; ')}.` : ''}`,
      badges: [{ label: 'Squarespace' }, { label: 'Goes live', tone: 'warn' }],
      fields: posts.map(p => ({ label: p.title, value: postUrlOf(p), href: postUrlOf(p) })),
      nextAction: 'Approving starts the runs in your browser, one after another.',
      verbs: { approve: 'Publish them', reject: 'Not yet' },
    };
  },
  async execute(ctx, input) {
    const { posts, problems } = await draftedPosts(ctx.orgId, input.pageRecordIds);
    if (posts.length === 0) {
      throw new Error(problems.length > 0 ? problems.join('; ') : 'None of these pages has a Squarespace draft to publish.');
    }
    const { startSquarespaceLive } = await import('@/services/publish/sitePublish');
    const started = await startSquarespaceLive(ctx.orgId, posts, ownerOf(ctx));
    return { started, line: `${started.length} post${started.length === 1 ? '' : 's'} going live, one at a time: ${started.map(s => `Browser run ${s.browserRunId}`).join(', ')}.${problems.length > 0 ? ` Not included: ${problems.join('; ')}.` : ''}` };
  },
};
