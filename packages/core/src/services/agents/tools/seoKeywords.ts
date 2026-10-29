/**
 * The Keywords register, for the SEO seats (`services/seo/keywords.ts`):
 *
 *   seo_list_keywords   a project's keywords: volume, competition, cluster, where the
 *                       client ranks, status, batch and page, each fact with its date
 *   seo_update_keywords the why (dated), the intent, a drop or a restore
 *
 * Rows are made and refreshed by the research tools themselves and follow
 * their pages in code; these read them and add what only a person or the
 * strategist knows. Planning a batch from rows is `seo_plan_batch` with
 * `keyword_ids`.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getKeywordRows, listProjectKeywords, pagesFromKeywords, SEO_KEYWORD_STATUSES, updateKeywords } from '@/services/seo/keywords';
import { readSeoProject } from '@/services/seo/projects';
import { keywordKey } from '@/services/seo/records';
import { keywordsHref } from './keywordRegister';

/** A planned page as `seo_plan_batch` takes it, as far as the register can fill it. */
type PlanPage = { keyword: string; intent?: string; volume?: number | null; cluster?: string };

/**
 * The line a plan's result carries about the register.
 * @param projectId - The project.
 */
export function registerLine(projectId: number): string {
  return `Each keyword is in the project's Keywords register, in this batch (${keywordsHref(projectId)}).`;
}

/**
 * The pages a plan from Keywords register rows makes, or why it may not: each
 * row must be this project's and none dropped. With pages given, every row's
 * keyword must be among them (they set the types and locations); without,
 * the rows make the pages, in the order given.
 * @param ctx - The turn.
 * @param ids - The rows, if the plan names any.
 * @param projectId - The project the plan names, if it names one.
 * @param given - The pages the plan gives, if any.
 */
export async function planFromKeywords<P extends PlanPage>(ctx: RuntimeContext, ids: number[] | undefined, projectId: number | undefined, given: P[] | undefined): Promise<{ pages: Array<P | PlanPage>; projectId?: number } | string> {
  const pages: Array<P | PlanPage> = Array.isArray(given) ? given : [];
  if (!ids?.length) {
    return { pages };
  }
  const rows = await getKeywordRows(ctx.orgId, ids);
  const unknown = ids.filter(id => !rows.some(r => r.id === id));
  if (unknown.length > 0) {
    return `Not planned: ${unknown.map(id => `#${id}`).join(', ')} ${unknown.length === 1 ? 'is not a keyword' : 'are not keywords'} in this workspace's register (seo_list_keywords).`;
  }
  const projects = [...new Set(rows.map(r => r.meta.projectId))];
  if (projects.length > 1 || (projectId && projects[0] !== projectId)) {
    return `Not planned: the keywords belong to ${projects.length > 1 ? 'different projects' : `project #${projects[0]}`}; one batch is one client's. Plan each project's keywords on their own.`;
  }
  const dropped = rows.filter(r => r.meta.status === 'dropped');
  if (dropped.length > 0) {
    return `Not planned: ${dropped.map(r => `"${r.meta.keyword}"`).join(', ')} ${dropped.length === 1 ? 'was' : 'were'} dropped${dropped[0]!.meta.why ? ` ("${dropped[0]!.meta.why.text}")` : ''}. Restore ${dropped.length === 1 ? 'it' : 'them'} first (seo_update_keywords restore) if the person wants ${dropped.length === 1 ? 'it' : 'them'} after all.`;
  }
  if (pages.length === 0) {
    return { pages: pagesFromKeywords(rows), projectId: projects[0] };
  }
  const missing = rows.filter(r => !pages.some(p => keywordKey(p.keyword) === keywordKey(r.meta.keyword)));
  if (missing.length > 0) {
    return `Not planned: ${missing.map(r => `"${r.meta.keyword}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} in keyword_ids but not in pages. Give each a page, or leave it out of keyword_ids.`;
  }
  return { pages, projectId: projects[0] };
}

/** Rows one list returns at most. */
const LIST_MAX = 200;

export function seoListKeywordsTool(ctx: RuntimeContext) {
  return tool(
    async ({ project_id, status }) => {
      const project = await readSeoProject(ctx.orgId, project_id);
      if (!project) {
        return `No project #${project_id} in this workspace.`;
      }
      const rows = (await listProjectKeywords(ctx.orgId, project_id)).filter(r => !status?.length || status.includes(r.meta.status));
      const day = (iso?: string) => iso?.slice(0, 10);
      return JSON.stringify({
        project: project.title,
        href: keywordsHref(project_id),
        count: rows.length,
        keywords: rows.slice(0, LIST_MAX).map(({ id, meta: m }) => ({
          id,
          keyword: m.keyword,
          status: m.status,
          ...(m.intent ? { intent: m.intent } : {}),
          ...(m.metricsCheckedAt ? { volume: m.volume ?? null, competition: m.competition ?? null, metricsRead: day(m.metricsCheckedAt) } : {}),
          ...(m.cluster ? { cluster: m.cluster } : {}),
          ...(m.serpCheckedAt ? { clientPosition: m.clientPosition ?? null, top3: (m.topResults ?? []).slice(0, 3).map(t => t.url), resultsRead: day(m.serpCheckedAt) } : {}),
          ...(m.pageId ? { batchId: m.batchId, pageId: m.pageId } : {}),
          ...(m.why ? { why: m.why.text, whySaid: day(m.why.at) } : {}),
          source: m.source,
        })),
      });
    },
    {
      name: 'seo_list_keywords',
      description: 'A client project\'s Keywords register: every keyword researched for it, with volume and competition, cluster, where the client ranks and the top results (each with the date it was read), its status (idea, in_batch, published, ranking, dropped), its batch and page, and why it is worth a page. Read it before researching a topic again or planning from keywords.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client project.'),
        status: z.array(z.enum(SEO_KEYWORD_STATUSES)).optional().describe('Only these statuses.'),
      }),
    },
  );
}

export function seoUpdateKeywordsTool(ctx: RuntimeContext) {
  return tool(
    async ({ keyword_ids, why, intent, drop, restore }) => {
      if (!why?.trim() && !intent?.trim() && !drop && !restore) {
        return 'Nothing written: give why, intent, drop or restore.';
      }
      if (drop && restore) {
        return 'Nothing written: drop or restore, not both.';
      }
      if (drop && !why?.trim()) {
        return 'Not dropped: say why (why), so the next person reads it.';
      }
      const lines = await updateKeywords(ctx.orgId, keyword_ids, { why, intent, drop, restore }, ctx.userId ?? (ctx.agentSlug ? `agent:${ctx.agentSlug}` : null));
      return lines.join('\n');
    },
    {
      name: 'seo_update_keywords',
      description: 'Write on Keywords register rows what only you or the person know: why the keyword is worth a page (kept with today\'s date), its intent, or drop it with why (not while its page is in a batch: that page is discarded on its sign-off) or restore a dropped one. Volumes, results and status otherwise come from research and pages, in code.',
      schema: z.object({
        keyword_ids: z.array(z.number().int().positive()).min(1).max(100).describe('The register rows (seo_list_keywords ids).'),
        why: z.string().max(400).optional().describe('One or two lines: why it is worth a page, or why it is dropped.'),
        intent: z.string().max(60).optional().describe('informational, commercial, transactional or navigational.'),
        drop: z.boolean().optional(),
        restore: z.boolean().optional(),
      }),
    },
  );
}
