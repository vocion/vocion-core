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
 * - **Webflow**: the page is saved as a draft item (`isDraft: true`) in the
 *   site's blog collection through the Data API, created or updated in place
 *   by its slug (`services/publish/webflowPublish.ts`). Undo deletes an item
 *   it created. Going live is `site.publish_live`, the same separate card as
 *   Squarespace's: the item comes out of draft and is published.
 *
 * A person approves a page ONCE, on its sign-off (the page's workflow run,
 * `services/seo/pipeline.ts`). Publishing it as a draft — an unmerged pull
 * request, or a Squarespace post that is not live — then runs on that, under
 * the SEO plugin's trust rule, with no second card. Anything else waits for a
 * person (`holdForPerson`): a page with no person's sign-off on its current
 * words, or a page the SEO app does not track. Going live
 * (`site.publish_live`) is always its own card.
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
 * How a Squarespace publish signs in to this site, for the page's project:
 * the stored login, and whether the site's connector keeps a sign-in — each
 * one this project may use (`connectionScope.ts`). Null when it has neither.
 * @param orgId - The workspace.
 * @param siteUrl - The site.
 * @param projectId - The project the page belongs to.
 */
async function squarespaceSignIn(orgId: string, siteUrl: string, projectId: number) {
  const { squarespaceLogin } = await import('@/services/publish/sitePublish');
  const { squarespaceConnectionFor } = await import('@/services/publish/squarespaceSignIn');
  const scope = { projectId };
  const [login, connection] = await Promise.all([squarespaceLogin(orgId, scope), squarespaceConnectionFor(orgId, siteUrl, scope).catch(() => null)]);
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
  description: 'Publish a signed-off page to its project\'s site: on GitHub a pull request with the page file (frontmatter in the site\'s own shape), on Squarespace a draft post saved in the editor, on Webflow a draft item in the blog collection (going live is site.publish_live for both). Give pageRecordId; projectId and artifactId only for a project the SEO app does not track. Undo closes a GitHub pull request, or deletes a Webflow draft it created.',
  inputSchema: publishPageInput,
  grant: 'publish_page',
  external: true,
  // The publish step is where the site's system is asked for, and only there.
  connects: ['github', 'squarespace'],
  // Held for a person unless a person signed this page's current words off.
  async holdForPerson(ctx, raw) {
    const pageId = Number((raw as { pageRecordId?: unknown }).pageRecordId);
    if (!Number.isInteger(pageId) || pageId <= 0) {
      return 'only a page a person signed off publishes without its own card';
    }
    const [{ readRecord }, { artifactWords, signedOff }] = await Promise.all([import('./factory-dispatch'), import('@/services/seo/records')]);
    const record = await readRecord(ctx.orgId, pageId);
    if (record?.typeSlug !== 'seo_page') {
      return 'only an SEO page a person signed off publishes without its own card';
    }
    const meta = record.meta as Parameters<typeof signedOff>[0];
    const draft = meta.draftArtifactId;
    const words = typeof draft === 'number' ? (await artifactWords(ctx.orgId, [draft])).get(draft) : undefined;
    return words && signedOff(meta, words) ? null : 'a person has not signed off this page\'s current words';
  },
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
    if (plan.target.kind === 'webflow') {
      const { webflowPreflight } = await import('@/services/publish/webflowPublish');
      const pre = await webflowPreflight(ctx.orgId, plan);
      return pre.ok ? undefined : pre.why;
    }
    if (plan.target.kind === 'squarespace' && !await squarespaceSignIn(ctx.orgId, plan.target.config.siteUrl, plan.project.id)) {
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
    if (plan.target.kind === 'webflow') {
      const { webflowPreflight } = await import('@/services/publish/webflowPublish');
      const checked = await webflowPreflight(ctx.orgId, plan);
      const site = plan.target.config.siteUrl?.replace(/^https:\/\//, '') ?? 'the Webflow site';
      if (!checked.ok) {
        return { title: `Save "${plan.page.title}" as a draft on ${site}`, system: 'Webflow', headline: checked.why, fields: metaFields, verbs: { approve: 'Save the draft', reject: 'Not yet' } };
      }
      const { pre } = checked;
      const updating = pre.existing !== null;
      const webflowPreview = { kind: 'text' as const, id: 'preview', label: plan.page.title, tabLabel: 'Preview', body: plan.draft.markdown, html: pre.bodyHtml };
      return {
        title: `${updating ? 'Update' : 'Save'} "${plan.page.title}" as a draft on ${site}`,
        system: 'Webflow',
        object: { title: plan.page.title, subtitle: `${plan.project.title} · ${pre.collection.displayName} · /${plan.page.slug}`, section: 'Pages' },
        headline: updating
          ? `Update the item at /${plan.page.slug} in ${pre.collection.displayName}, as a draft. It never goes live here: going live is its own card.`
          : `Add the post to ${pre.collection.displayName} as a draft item. It never goes live here: going live is its own card.`,
        badges: [{ label: 'Webflow' }, { label: 'Draft only' }, ...(updating ? [{ label: 'Updates an item', tone: 'warn' as const }] : [{ label: 'Undo deletes it' }])],
        fields: [
          { label: 'Target', value: publishTargetLine(plan.target), ...(plan.target.config.siteUrl ? { href: plan.target.config.siteUrl } : {}) },
          ...(pre.postUrl ? [{ label: 'URL once live', value: pre.postUrl }] : []),
          ...metaFields,
          { label: 'Fields', value: Object.keys(pre.fieldData).join(', ') },
          ...(pre.notes.length > 0 ? [{ label: 'Changed for Webflow', value: pre.notes.join(' ') }] : []),
          { label: 'Project', value: plan.project.title },
        ],
        contentHeading: { label: 'The post', meta: `draft v${plan.draft.version}` },
        content: [webflowPreview, draftLink],
        nextAction: 'Approving saves the draft item in Webflow now.',
        verbs: { approve: updating ? 'Update the draft' : 'Save the draft', reject: 'Not yet' },
      };
    }
    const { postUrlOf } = await import('@/services/publish/squarespaceTask');
    const blogPath = plan.target.kind === 'squarespace' ? plan.target.config.blogPath ?? '/blog' : '/blog';
    const siteUrl = plan.target.kind === 'squarespace' ? plan.target.config.siteUrl : '';
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
    const base = { targetId: plan.target.id, kind: plan.target.kind, pageRecordId: plan.page.recordId, projectId: plan.project.id, slug: plan.page.slug, before: plan.before };
    if (plan.target.kind === 'github') {
      const opened = await publishToGithub(ctx.orgId, plan, ctx.reviewedBy ?? null);
      const line = `${opened.created ? 'Opened' : 'Added a commit to'} ${opened.url.replace('https://github.com/', '')}: ${opened.replaced ? 'replacing' : 'adding'} ${opened.path}. The client's team merges it; Undo closes it.`;
      await recordOnPage(ctx.orgId, plan.page.recordId, { status: 'publishing', pullRequestUrl: opened.url, publishing: { kind: 'github', targetId: plan.target.id, branch: opened.branch, path: opened.path, replaced: opened.replaced, at, by: ctx.reviewedBy ?? ctx.invokedBy ?? null, actionRunId: ctx.runId ?? null } });
      // Published when the client's team merges it: followed, never merged from here.
      await followPull({ orgId: ctx.orgId, repo: opened.repo, number: opened.number, url: opened.url, pageRecordId: plan.page.recordId, actionRunId: ctx.runId ?? null, projectId: plan.project.id });
      // The Done line reads this (`libs/decisions/receipt.ts` `outcomeOf`): "Pull request opened: <link>".
      const receipt = { text: opened.created ? 'Pull request opened' : 'Pull request updated', href: opened.url, linkLabel: `${opened.repo}#${opened.number}` };
      return { ...base, published: false, url: opened.url, repo: opened.repo, branch: opened.branch, number: opened.number, path: opened.path, created: opened.created, replaced: opened.replaced, line, receipt };
    }
    if (plan.target.kind === 'webflow') {
      const { saveWebflowDraft } = await import('@/services/publish/webflowPublish');
      const saved = await saveWebflowDraft(ctx.orgId, plan);
      const line = `${saved.created ? 'Saved' : 'Updated'} "${plan.page.title}" as a draft item in Webflow${saved.postUrl ? ` (live it will be ${saved.postUrl})` : ''}. Going live is its own approval (site.publish_live).`;
      await recordOnPage(ctx.orgId, plan.page.recordId, { status: 'publishing', webflowDraft: { itemId: saved.itemId, collectionId: saved.collectionId, siteId: saved.siteId, slug: plan.page.slug, savedAt: at, created: saved.created }, publishing: { kind: 'webflow', phase: 'draft', targetId: plan.target.id, itemId: saved.itemId, at, by: ctx.reviewedBy ?? ctx.invokedBy ?? null, actionRunId: ctx.runId ?? null, note: line } });
      const receipt = { text: saved.created ? 'Draft saved in Webflow' : 'Draft updated in Webflow' };
      return { ...base, published: false, itemId: saved.itemId, collectionId: saved.collectionId, siteId: saved.siteId, created: saved.created, postUrl: saved.postUrl, notes: saved.notes, line, receipt };
    }
    if (plan.target.kind !== 'squarespace') {
      throw new Error('Publishing to this kind of target is not built yet.');
    }
    const owner = ownerOf(ctx);
    const signIn = await squarespaceSignIn(ctx.orgId, plan.target.config.siteUrl, plan.project.id);
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
  canUndo: result => (result?.kind === 'github' && typeof result.url === 'string') || (result?.kind === 'webflow' && result.created === true),
  async undo(ctx, _input, result) {
    if (result?.kind === 'webflow' && result.created === true && typeof result.itemId === 'string') {
      const { deleteWebflowDraft } = await import('@/services/publish/webflowPublish');
      await deleteWebflowDraft(ctx.orgId, { siteId: String(result.siteId), collectionId: String(result.collectionId), itemId: result.itemId, projectId: typeof result.projectId === 'number' ? result.projectId : null });
      const before = (result.before ?? null) as { status?: unknown } | null;
      const { recordOnPage } = await import('@/services/publish/sitePublish');
      await recordOnPage(ctx.orgId, typeof result.pageRecordId === 'number' ? result.pageRecordId : null, { status: before?.status ?? 'approved', webflowDraft: null, publishing: { kind: 'webflow', withdrawnAt: new Date().toISOString(), itemId: result.itemId } });
      return { note: 'The draft item is deleted from Webflow.' };
    }
    if (result?.kind !== 'github' || typeof result.url !== 'string' || typeof result.branch !== 'string' || typeof result.repo !== 'string') {
      return { note: result?.kind === 'webflow' ? 'The item was there before this save, so it is left in Webflow: change it there if it should go.' : 'A Squarespace post is the site\'s once saved: delete it in the Squarespace editor if it should go.' };
    }
    const { discardChange } = await import('@/services/factory/githubChange');
    // The page's project's work, as the publish was: its connection closes it.
    const { withWorkProject } = await import('@/services/connect/connectionScope');
    const projectId = typeof result.projectId === 'number' ? result.projectId : undefined;
    const out = await withWorkProject(projectId, () => discardChange(ctx.orgId, { url: result.url as string, repo: result.repo as string, branch: result.branch as string }));
    const before = (result.before ?? null) as { status?: unknown; pullRequestUrl?: unknown } | null;
    const { recordOnPage } = await import('@/services/publish/sitePublish');
    await recordOnPage(ctx.orgId, typeof result.pageRecordId === 'number' ? result.pageRecordId : null, { status: before?.status ?? 'approved', pullRequestUrl: before?.pullRequestUrl ?? null, publishing: { kind: 'github', withdrawnAt: new Date().toISOString(), url: result.url, revertUrl: out.revertUrl } });
    return { ...out, note: out.revertUrl ? `It had merged; the revert is open at ${out.revertUrl}.` : 'The pull request is closed and its branch deleted.' };
  },
};

const publishLiveInput = z.object({
  pageRecordIds: z.array(z.coerce.number().int().positive()).min(1).max(50).describe('The pages whose Squarespace or Webflow drafts go live, in the order they go.'),
});

type LiveInput = z.infer<typeof publishLiveInput>;

type SquarespacePost = { pageRecordId: number; title: string; siteUrl: string; blogPath: string; slug: string; actionRunId: number | null };

/**
 * The drafted posts among these pages, Squarespace's and Webflow's, and why
 * each other one is not.
 * @param orgId - The workspace.
 * @param ids - The pages.
 */
async function draftedPosts(orgId: string, ids: number[]) {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const { resolvePublishTarget, webflowPostUrl } = await import('@/libs/publish/targets');
  const posts: SquarespacePost[] = [];
  const webflow: import('@/services/publish/webflowPublish').WebflowLivePost[] = [];
  const problems: string[] = [];
  for (const id of [...new Set(ids)]) {
    const page = await readRecord(orgId, id);
    const draft = page?.meta.squarespaceDraft as { slug?: string } | undefined;
    const wf = page?.meta.webflowDraft as { itemId?: string; collectionId?: string; siteId?: string; slug?: string } | null | undefined;
    const publishing = (page?.meta.publishing ?? {}) as { targetId?: string; actionRunId?: number };
    if (!page || (!draft?.slug && !wf?.itemId)) {
      problems.push(`#${id}${page ? ` "${page.title}"` : ''} has no draft saved on its site yet`);
      continue;
    }
    if (page.meta.status === 'published') {
      problems.push(`"${page.title}" is already live`);
      continue;
    }
    const project = typeof page.meta.projectId === 'number' ? await readRecord(orgId, page.meta.projectId) : null;
    const target = resolvePublishTarget(project?.meta.publishTargets, publishing.targetId ?? (page.meta.publishTargetId as string | undefined));
    const actionRunId = typeof publishing.actionRunId === 'number' ? publishing.actionRunId : null;
    if (target.ok && target.target.kind === 'webflow' && wf?.itemId && wf.collectionId) {
      const slug = wf.slug ?? String(page.meta.slug ?? '');
      webflow.push({ pageRecordId: id, projectId: typeof page.meta.projectId === 'number' ? page.meta.projectId : null, title: page.title, slug, siteId: wf.siteId ?? target.target.config.siteId ?? '', collectionId: wf.collectionId, itemId: wf.itemId, postUrl: webflowPostUrl(target.target, slug), actionRunId });
      continue;
    }
    if (!target.ok || target.target.kind !== 'squarespace' || !draft?.slug) {
      problems.push(`"${page.title}": ${target.ok ? `its draft is not on its ${target.target.kind} target` : target.why}`);
      continue;
    }
    posts.push({ pageRecordId: id, title: page.title, siteUrl: target.target.config.siteUrl, blogPath: target.target.config.blogPath ?? '/blog', slug: draft.slug, actionRunId });
  }
  return { posts, webflow, problems };
}

/**
 * Where the drafted posts are, in a word for the card: one site kind, or both.
 * @param drafted - The drafted posts.
 * @param drafted.posts - Squarespace's.
 * @param drafted.webflow - Webflow's.
 */
function systemOf(drafted: { posts: unknown[]; webflow: unknown[] }): string {
  return drafted.posts.length > 0 && drafted.webflow.length > 0 ? 'Squarespace and Webflow' : drafted.webflow.length > 0 ? 'Webflow' : 'Squarespace';
}

export const sitePublishLiveAction: Action<typeof publishLiveInput> = {
  id: PUBLISH_LIVE_ACTION_ID,
  name: 'Take drafted posts live',
  description: 'Publish drafts that site.publish_page saved, on Squarespace or Webflow: one approval for the listed pages. On Squarespace one browser run per post, in turn, each pressing Publish on its own draft and read back from the site; on Webflow each item is published through the API. Give pageRecordIds.',
  inputSchema: publishLiveInput,
  grant: 'publish_page',
  external: true,
  // The publish step is where the site's system is asked for, and only there.
  connects: ['github', 'squarespace'],
  approvalRequired: true,
  requiresReviewDecision: true,
  dedupKeyFor: input => `${PUBLISH_LIVE_ACTION_ID}:${[...new Set(input.pageRecordIds)].sort((a, b) => a - b).join(',')}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    const { posts, webflow, problems } = await draftedPosts(ctx.orgId, input.pageRecordIds);
    if (problems.length > 0) {
      return `Not all of these can go live: ${problems.join('; ')}.`;
    }
    return posts.length + webflow.length === 0 ? 'None of these pages has a draft to publish.' : undefined;
  },
  async reviewCard(ctx, raw): Promise<ReviewCard> {
    const input = raw as LiveInput;
    const drafted = await draftedPosts(ctx.orgId, input.pageRecordIds);
    const { posts, webflow, problems } = drafted;
    const { postUrlOf } = await import('@/services/publish/squarespaceTask');
    const n = posts.length + webflow.length;
    const system = systemOf(drafted);
    const how = [
      posts.length > 0 ? 'On Squarespace each draft goes live in turn: one browser run per post presses Publish on that post and nothing else, then reads it back from the site.' : null,
      webflow.length > 0 ? 'On Webflow each draft item is published on its own; the rest of the site is not published with it.' : null,
    ].filter(Boolean).join(' ');
    return {
      title: `Publish ${n} drafted post${n === 1 ? '' : 's'} on ${system}`,
      system,
      headline: `${how}${problems.length > 0 ? ` Not included: ${problems.join('; ')}.` : ''}`,
      badges: [...(posts.length > 0 ? [{ label: 'Squarespace' }] : []), ...(webflow.length > 0 ? [{ label: 'Webflow' }] : []), { label: 'Goes live', tone: 'warn' }],
      fields: [
        ...posts.map(p => ({ label: p.title, value: postUrlOf(p), href: postUrlOf(p) })),
        ...webflow.map(p => ({ label: p.title, value: p.postUrl ?? `/${p.slug} in Webflow`, ...(p.postUrl ? { href: p.postUrl } : {}) })),
      ],
      nextAction: posts.length > 0 ? 'Approving starts the runs in your browser, one after another, and publishes the Webflow items now.' : 'Approving publishes them now.',
      verbs: { approve: 'Publish them', reject: 'Not yet' },
    };
  },
  async execute(ctx, input) {
    const { posts, webflow, problems } = await draftedPosts(ctx.orgId, input.pageRecordIds);
    if (posts.length + webflow.length === 0) {
      throw new Error(problems.length > 0 ? problems.join('; ') : 'None of these pages has a draft to publish.');
    }
    const lines: string[] = [];
    let started: Awaited<ReturnType<typeof import('@/services/publish/sitePublish').startSquarespaceLive>> = [];
    if (posts.length > 0) {
      const { startSquarespaceLive } = await import('@/services/publish/sitePublish');
      started = await startSquarespaceLive(ctx.orgId, posts, ownerOf(ctx));
      lines.push(`${started.length} post${started.length === 1 ? '' : 's'} going live, one at a time: ${started.map(s => `Browser run ${s.browserRunId}`).join(', ')}.`);
    }
    let published: import('@/services/publish/webflowPublish').WebflowLiveOutcome[] = [];
    if (webflow.length > 0) {
      const { publishWebflowLive } = await import('@/services/publish/webflowPublish');
      published = await publishWebflowLive(ctx.orgId, webflow);
      lines.push(...published.map(p => p.line));
      if (published.every(p => !p.live) && posts.length === 0) {
        throw new Error(lines.join(' '));
      }
    }
    return { started, published, line: `${lines.join(' ')}${problems.length > 0 ? ` Not included: ${problems.join('; ')}.` : ''}` };
  },
};
