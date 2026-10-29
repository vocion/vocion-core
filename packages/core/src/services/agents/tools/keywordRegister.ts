/**
 * What the research tools read, kept in the client's Keywords register
 * (`services/seo/keywords.ts`) in code, as part of the call: keyword research
 * done in a chat leaves its rows behind whether or not the model remembers
 * to save it.
 *
 * Which project: the one the call names (`project_id`), else the project the
 * page in view is about, else the project the run last worked on (the
 * latest tool call in this conversation or run that named one, or the
 * project a background run was queued for). With none, nothing is kept and
 * the result says to name it.
 *
 * Where from: a chat turn is `chat`; a background run is `weekly` when it
 * answers the weekly opportunities check (its trigger names reason
 * `opportunities`), else `chat`.
 */

import type { RuntimeContext } from '../types';
import type { SerpResult } from '@/libs/tools/serp/types';
import type { KeywordResearch, SeoKeywordSource } from '@/services/seo/keywords';

/**
 * The Keywords page, narrowed to one project.
 * @param projectId - The project.
 */
export const keywordsHref = (projectId: number) => `/dashboard/p/seo-keywords?project=${projectId}`;

/** A background run's trigger, read once per run. */
const runBriefs = new Map<number, Promise<string>>();

async function runBrief(orgId: string, runId: number): Promise<string> {
  let brief = runBriefs.get(runId);
  if (!brief) {
    brief = (async () => {
      const [{ db }, { missionRunSchema }, { and, eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
      const [row] = await db.select({ brief: missionRunSchema.brief }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, runId))).limit(1);
      return row?.brief ?? '';
    })().catch(() => '');
    runBriefs.set(runId, brief);
    while (runBriefs.size > 200) {
      runBriefs.delete(runBriefs.keys().next().value!);
    }
  }
  return brief;
}

/**
 * Where research in this turn comes from.
 * @param ctx - The turn.
 */
export async function researchSource(ctx: RuntimeContext): Promise<SeoKeywordSource> {
  if (!ctx.missionRunId) {
    return 'chat';
  }
  return /"reason":\s*"opportunities"/.test(await runBrief(ctx.orgId, ctx.missionRunId)) ? 'weekly' : 'chat';
}

/**
 * The project the research is for, or null when nothing says.
 * @param ctx - The turn.
 * @param named - The project the call named.
 */
export async function researchProjectId(ctx: RuntimeContext, named?: number): Promise<number | null> {
  if (named) {
    return named;
  }
  const page = ctx.pageContext;
  const viewed = [page?.record, ...(page?.refs ?? [])].find(r => r?.type === 'object' && r.objectType === 'data_room');
  const fromPath = /^\/(?:[a-z]{2}\/)?dashboard\/projects\/(\d+)/.exec(page?.path ?? '');
  const fromPage = Number(viewed?.id ?? fromPath?.[1]);
  if (Number.isInteger(fromPage) && fromPage > 0) {
    return fromPage;
  }
  try {
    const [{ db }, { toolCallSchema }, { and, desc, eq, sql }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
    const scope = ctx.missionRunId ? eq(toolCallSchema.missionRunId, ctx.missionRunId) : ctx.conversationId ? eq(toolCallSchema.conversationId, ctx.conversationId) : null;
    if (scope) {
      const [row] = await db
        .select({ projectId: sql<string | null>`${toolCallSchema.input}->>'project_id'` })
        .from(toolCallSchema)
        .where(and(eq(toolCallSchema.orgId, ctx.orgId), scope, sql`${toolCallSchema.input}->>'project_id' ~ '^[0-9]+$'`))
        .orderBy(desc(toolCallSchema.createdAt), desc(toolCallSchema.id))
        .limit(1);
      if (row?.projectId) {
        return Number(row.projectId);
      }
    }
  } catch {
    // The register is a courtesy beside the research; the result says to name the project.
  }
  if (ctx.missionRunId) {
    const queued = /"projectId":\s*(\d+)/.exec(await runBrief(ctx.orgId, ctx.missionRunId));
    if (queued) {
      return Number(queued[1]);
    }
  }
  return null;
}

/**
 * What one Google results page says about its query, for the register.
 * Another engine's order is not Google's ranking and is not kept as one.
 * @param serp - The page.
 */
export function serpResearch(serp: SerpResult): KeywordResearch {
  return serp.isGoogleRanking
    ? { keyword: serp.query, serp: { checkedAt: serp.retrievedAt, results: serp.organic.map(o => ({ position: o.position, url: o.url, title: o.title, domain: o.domain })), ...(serp.location ? { location: serp.location } : {}), ...(serp.language ? { language: serp.language } : {}) } }
    : { keyword: serp.query };
}

/**
 * Keep what a research call read in the project's register, and say so in
 * a few words the result carries. Empty when the SEO app is off.
 * @param ctx - The turn.
 * @param named - The project the call named.
 * @param items - What was read.
 */
export async function keepResearch(ctx: RuntimeContext, named: number | undefined, items: KeywordResearch[]): Promise<{ keywords?: unknown }> {
  if (!ctx.enabledPlugins?.includes('seo') || items.length === 0) {
    return {};
  }
  try {
    const projectId = await researchProjectId(ctx, named);
    if (!projectId) {
      return { keywords: 'Not kept in a Keywords register: name the client project (project_id) and what you research is kept there.' };
    }
    const { keepKeywords } = await import('@/services/seo/keywords');
    const kept = await keepKeywords(ctx.orgId, projectId, items, { source: await researchSource(ctx), by: ctx.userId ?? `agent:${ctx.agentSlug ?? 'seo'}` });
    if (!kept) {
      return named ? { keywords: `Not kept: no project #${named} in this workspace.` } : {};
    }
    const made = kept.rows.filter(r => r.created).length;
    return { keywords: { kept: kept.rows.length, new: made, project: kept.project.title, href: keywordsHref(kept.project.id) } };
  } catch (err) {
    console.warn('[serp] the research could not be kept in the register', { orgId: ctx.orgId, error: (err as Error).message });
    return {};
  }
}
