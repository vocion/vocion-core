/**
 * THE SEO PAGE PIPELINE, AS WORKFLOWS — what the SEO app's hand-offs start.
 *
 * Writing a page is a fixed procedure, so it is a workflow
 * (`templates/plugins/seo/workflows/`), visible step by step on its run
 * page, not a hidden automation re-reading a mission prompt:
 *
 *   seo-batch   one run per released page of a batch (`workflow.start`)
 *   seo-page    research → brief → draft → the editor's review (at most three
 *               rounds) → the person's sign-off (the approve step: the one
 *               approval a page gets) → the sign-off recorded on the page in
 *               code (`seo.record_signoff`) → `site.publish_page` (an unmerged
 *               pull request or a not-live Squarespace draft; run by the
 *               plugin's trust rule) → for Squarespace, going live on its
 *               own card (`site.publish_live`)
 *   seo-plan    a keyword plan a person sent back, revised from their note
 *   seo-opportunities  the weekly cadence check's plan for a project behind
 *
 * The volume gate stays code (`gate.ts`): only the pages it releases get a
 * run, and `seo_save_draft` still refuses one it has not. A page already in a
 * running or waiting run gets no second one.
 *
 * A workspace whose SEO app has not been upgraded yet has none of these
 * workflows: the hand-off then raises `seo.work_queued` for the old
 * `seo-continue` automation, so nothing stalls during the upgrade.
 */

import type { SeoWorkReason } from './work';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';

export const SEO_PAGE_WORKFLOW = 'seo-page';
export const SEO_BATCH_WORKFLOW = 'seo-batch';
export const SEO_PLAN_WORKFLOW = 'seo-plan';
export const SEO_OPPORTUNITIES_WORKFLOW = 'seo-opportunities';

/** Who starts the pipeline's runs. */
export const SEO_PIPELINE_INVOKER = 'seo';

/**
 * The page run an agent turn belongs to, from who it runs as
 * (`workflow:seo-page:<runId>`), or null outside one.
 * @param userId - The turn's user id.
 */
export function seoPageRunOf(userId: string | null | undefined): number | null {
  const m = /^workflow:seo-page:(\d+)$/.exec(userId ?? '');
  return m ? Number(m[1]) : null;
}

/** One page as a page run's input. */
export type PageRunItem = {
  page_id: number;
  keyword: string;
  location: string;
  page_type: string;
  client: string;
  batch_id: number;
  batch_ref: string;
  /** write: a first draft; redraft: the person sent it back with a note; revise: the editor did. */
  reason: 'write' | 'redraft' | 'revise';
  has_research: boolean;
  has_brief: boolean;
  publish_target: string;
  target_kind: string;
};

/**
 * Which workflows of the pipeline this workspace has.
 * @param orgId - The workspace.
 */
async function installed(orgId: string): Promise<Set<string>> {
  const rows = await db.select({ slug: workflowSchema.slug }).from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.status, 'active'), inArray(workflowSchema.slug, [SEO_PAGE_WORKFLOW, SEO_BATCH_WORKFLOW, SEO_PLAN_WORKFLOW, SEO_OPPORTUNITIES_WORKFLOW])));
  return new Set(rows.map(r => r.slug));
}

/**
 * Pages already in a page run that is running or waiting on someone.
 * @param orgId - The workspace.
 * @param pageIds - The pages.
 */
export async function pagesInFlight(orgId: string, pageIds: readonly number[]): Promise<Set<number>> {
  if (pageIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ page: sql<string>`${workflowRunSchema.input}->>'page_id'` })
    .from(workflowRunSchema)
    .innerJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId))
    .where(and(
      eq(workflowRunSchema.orgId, orgId),
      eq(workflowSchema.slug, SEO_PAGE_WORKFLOW),
      inArray(workflowRunSchema.status, ['running', 'paused']),
      inArray(sql`${workflowRunSchema.input}->>'page_id'`, pageIds.map(String)),
    ));
  return new Set(rows.map(r => Number(r.page)));
}

/**
 * The batch's released pages as page-run inputs, the ones already in a run
 * left out. Empty when the gate releases nothing. `only` narrows to pages.
 * @param orgId - The workspace.
 * @param batchId - The batch.
 * @param opts - Narrowing and the reason to give.
 * @param opts.only - Only these pages.
 * @param opts.reason - Why, for a page whose status does not say.
 */
export async function releasedPageItems(orgId: string, batchId: number, opts: { only?: readonly number[]; reason?: PageRunItem['reason'] } = {}): Promise<{ items: PageRunItem[]; line: string | null }> {
  const [{ readSeoGate, listSeoPages }, { getProject }] = await Promise.all([import('./records'), import('@/services/DataRoomService')]);
  const read = await readSeoGate(orgId, batchId);
  if (!read || !read.planSignedOff) {
    return { items: [], line: read?.gate.line ?? null };
  }
  const writable = new Set(read.gate.writable.filter(id => !opts.only || opts.only.includes(id)));
  const busy = await pagesInFlight(orgId, [...writable]);
  const pages = (await listSeoPages(orgId, batchId)).filter(p => writable.has(p.id) && !busy.has(p.id));
  const project = await getProject(orgId, read.batch.meta.projectId);
  const targets = project?.meta.publishTargets ?? [];
  const items = pages.map((p): PageRunItem => {
    const targetId = p.meta.publishTargetId ?? read.batch.meta.destination ?? targets[0]?.id;
    const target = targets.find(t => t.id === targetId);
    return {
      page_id: p.id,
      keyword: p.meta.keyword,
      location: p.meta.location ?? '',
      page_type: p.meta.pageType ?? 'other',
      client: project?.title ?? '',
      batch_id: batchId,
      batch_ref: read.batch.title,
      reason: p.meta.status === 'changes_requested' ? 'redraft' : opts.reason ?? (p.meta.draftArtifactId ? 'revise' : 'write'),
      has_research: typeof p.meta.serpArtifactId === 'number',
      has_brief: typeof p.meta.briefArtifactId === 'number',
      publish_target: target?.id ?? 'none',
      target_kind: target?.kind ?? 'none',
    };
  });
  return { items, line: read.gate.line };
}

/**
 * Start one page's redraft run: the person sent it back, so its first step
 * files their note, then the draft is written again and reviewed. Started
 * for that page whatever the gate's released list says (a page sent back is
 * held until its note is filed, which is this run's first step); skipped
 * when the page is already in a run.
 * @param orgId - The workspace.
 * @param pageId - The page.
 */
export async function startRedraft(orgId: string, pageId: number): Promise<number | null> {
  const [{ getSeoPage, getSeoBatch }, { getProject }, { launchWorkflow }] = await Promise.all([import('./records'), import('@/services/DataRoomService'), import('@/services/WorkflowService')]);
  if ((await pagesInFlight(orgId, [pageId])).size > 0 || !(await installed(orgId)).has(SEO_PAGE_WORKFLOW)) {
    return null;
  }
  const page = await getSeoPage(orgId, pageId);
  if (!page) {
    return null;
  }
  const batch = await getSeoBatch(orgId, page.meta.batchId);
  const project = await getProject(orgId, page.meta.projectId);
  const targets = project?.meta.publishTargets ?? [];
  const target = targets.find(t => t.id === (page.meta.publishTargetId ?? batch?.meta.destination ?? targets[0]?.id));
  const item: PageRunItem & { index: number; total: number } = {
    page_id: page.id,
    keyword: page.meta.keyword,
    location: page.meta.location ?? '',
    page_type: page.meta.pageType ?? 'other',
    client: project?.title ?? '',
    batch_id: page.meta.batchId,
    batch_ref: batch?.title ?? `Batch #${page.meta.batchId}`,
    reason: 'redraft',
    has_research: typeof page.meta.serpArtifactId === 'number',
    has_brief: typeof page.meta.briefArtifactId === 'number',
    publish_target: target?.id ?? 'none',
    target_kind: target?.kind ?? 'none',
    index: 1,
    total: 1,
  };
  const run = await launchWorkflow({ orgId, slug: SEO_PAGE_WORKFLOW, input: item, triggerContext: { trigger: 'seo', reason: 'redraft' }, invokedBy: SEO_PIPELINE_INVOKER });
  return run.id;
}

/**
 * Start the work a hand-off asks for as workflow runs. True when it started
 * (or there was nothing to start); false when this workspace has no pipeline
 * workflows, so the caller falls back to the old event.
 * @param orgId - The workspace.
 * @param reason - Why.
 * @param payload - What the hand-off carries.
 */
export async function startSeoPipeline(orgId: string, reason: SeoWorkReason, payload: Record<string, unknown>): Promise<boolean> {
  const have = await installed(orgId);
  if (!have.has(SEO_PAGE_WORKFLOW) || !have.has(SEO_BATCH_WORKFLOW)) {
    return false;
  }
  const { launchWorkflow } = await import('@/services/WorkflowService');
  const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const batchId = num(payload.batchId);
  const startPages = async (only?: number[], why?: PageRunItem['reason']) => {
    if (!batchId) {
      return;
    }
    const { items } = await releasedPageItems(orgId, batchId, { ...(only ? { only } : {}), ...(why ? { reason: why } : {}) });
    if (items.length === 0) {
      return;
    }
    const indexed = items.map((it, i) => ({ ...it, index: i + 1, total: items.length }));
    await launchWorkflow({ orgId, slug: SEO_BATCH_WORKFLOW, input: { batch_id: batchId, batch_ref: items[0]!.batch_ref, client: items[0]!.client, pages: indexed }, triggerContext: { trigger: 'seo', reason }, invokedBy: SEO_PIPELINE_INVOKER });
  };
  if (reason === 'write') {
    await startPages();
    return true;
  }
  if (reason === 'revise') {
    const pageId = num(payload.pageId);
    await startPages(pageId ? [pageId] : undefined, 'revise');
    return true;
  }
  if (reason === 'opportunities') {
    if (!have.has(SEO_OPPORTUNITIES_WORKFLOW)) {
      return false;
    }
    await launchWorkflow({ orgId, slug: SEO_OPPORTUNITIES_WORKFLOW, input: { project_id: payload.projectId, client: payload.projectName ?? '', pages: payload.pages, focus: payload.focus ?? '', standing: payload.standing ?? '' }, triggerContext: { trigger: 'seo', reason }, invokedBy: SEO_PIPELINE_INVOKER });
    return true;
  }
  // A sign-off answered on the old card, or a plan's: the plan revised, or
  // the released pages started.
  if (payload.kind === 'plan') {
    if (payload.plan === 'revise') {
      if (!have.has(SEO_PLAN_WORKFLOW)) {
        return false;
      }
      await launchWorkflow({ orgId, slug: SEO_PLAN_WORKFLOW, input: { batch_id: batchId, note: payload.note ?? '' }, triggerContext: { trigger: 'seo', reason }, invokedBy: SEO_PIPELINE_INVOKER });
    } else if (payload.plan === 'approved') {
      await startPages();
    }
    return true;
  }
  // A page sign-off: a page sent back is redrafted (its note filed first),
  // and any page the gate now releases is started.
  const pageId = num(payload.pageId);
  if (pageId && payload.signoff === 'revise') {
    await startRedraft(orgId, pageId);
  }
  await startPages();
  return true;
}
