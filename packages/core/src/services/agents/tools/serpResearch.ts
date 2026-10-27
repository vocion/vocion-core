/**
 * SERP research — what Google ranks for a query, what those pages are made
 * of, and how many people search it. The legwork before an SEO page is
 * planned: an agency cannot plan a page without first reading the top
 * results, and that reading used to happen by hand, once per keyword.
 *
 *   - `serp_search` — Google's results page: the organic top N with their
 *     domains, the featured snippet, People Also Ask, related searches, the
 *     ads count, who read it and when. Through `libs/tools/serp/` (Serper by
 *     default; DataForSEO; SerpApi). With no SERP provider it falls back to
 *     the `web_search` engine and says so in the result, because that order
 *     is not Google's.
 *   - `serp_compare` — reads the top pages (the browse provider's HTML,
 *     public addresses only), lays their facts side by side and files the
 *     **SERP brief** artifact (folder `seo/serp`), every row linked and
 *     dated. The agent then writes the synthesis into the brief with the same
 *     tool (`brief_id` + `synthesis`), each point cited to its pages.
 *   - `keyword_metrics` — search volume, CPC and competition from DataForSEO;
 *     anywhere else it says plainly that volume could not be established.
 *
 * Granted, not default (`harness.grantTools: [serp]`, or a tool by name):
 * every call is a paid vendor call, charged to `seo.research`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { ComparedPage, Synthesis } from '@/libs/tools/serp/brief';
import type { SerpOrganicResult, SerpResult } from '@/libs/tools/serp/types';
import { createHash } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { mapWithConcurrency } from '@/libs/concurrency';
import { FEATURES } from '@/libs/Langfuse/features';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { recurringHeadings, renderSerpBrief, renderSynthesis, SERP_BRIEF_FOLDER, withSynthesis } from '@/libs/tools/serp/brief';
import { extractPageFacts } from '@/libs/tools/serp/pageFacts';
import { keywordMetrics, searchSerp } from '@/libs/tools/serp/registry';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';
import { authorOf, renderMarkdownArtifact } from './renderArtifacts';

/** The grant that puts all three on an agent's belt. */
export const SERP_GRANT = 'serp';

export const SERP_TOOL_NAMES = ['serp_search', 'serp_compare', 'keyword_metrics'] as const;

/** Pages read at once by `serp_compare`: polite to the sites, quick enough for a turn. */
const COMPARE_CONCURRENCY = 4;

/** Results pages kept in this process for `serp_compare` to pick up by id. */
const RECENT_CAP = 200;
const recent = new Map<string, SerpResult>();

/**
 * Whether the agent holds a SERP tool: the group grant, or the tool by name.
 * @param ctx - The turn.
 * @param name - The tool.
 */
function granted(ctx: RuntimeContext, name: string): boolean {
  const grants = ctx.harnessConfig.grantTools ?? [];
  return grants.includes(SERP_GRANT) || grants.includes(name);
}

/**
 * A short id for one results page, stable for what was read and when.
 * @param serp - The page.
 */
export function serpResultIdOf(serp: SerpResult): string {
  return `serp_${createHash('sha256').update(`${serp.provider}|${serp.query}|${serp.location ?? ''}|${serp.language ?? ''}|${serp.retrievedAt}`).digest('hex').slice(0, 12)}`;
}

function remember(id: string, serp: SerpResult): void {
  recent.delete(id);
  recent.set(id, serp);
  while (recent.size > RECENT_CAP) {
    recent.delete(recent.keys().next().value!);
  }
}

/**
 * A results page `serp_search` returned earlier: from this process, else
 * from the run's own tool-call record (another process may have served the
 * search). Null when neither has it.
 * @param ctx - The turn.
 * @param id - The `serpResultId`.
 */
async function recall(ctx: RuntimeContext, id: string): Promise<SerpResult | null> {
  const local = recent.get(id);
  if (local) {
    return local;
  }
  if (!/^serp_[0-9a-f]{12}$/.test(id)) {
    return null;
  }
  try {
    const [{ db }, { toolCallSchema }, { and, desc, eq, like }] = await Promise.all([
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('drizzle-orm'),
    ]);
    const rows = await db
      .select({ output: toolCallSchema.output })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, ctx.orgId), eq(toolCallSchema.tool, 'serp_search'), like(toolCallSchema.output, `%"${id}"%`)))
      .orderBy(desc(toolCallSchema.createdAt))
      .limit(1);
    const parsed = rows[0]?.output ? JSON.parse(rows[0].output) as { serp?: SerpResult } : null;
    return parsed?.serp ?? null;
  } catch {
    return null;
  }
}

/**
 * Charge what a vendor billed to `seo.research` (and the agent, and the
 * workspace). The fallback bills nothing here.
 * @param ctx - The turn.
 * @param model - The pricing row, `serp/<vendor>`.
 * @param units - Billed units.
 */
async function charge(ctx: RuntimeContext, model: string, units: number): Promise<void> {
  if (units <= 0) {
    return;
  }
  try {
    // Imported here: `BudgetService` reaches the database handle, which
    // validates the whole environment at import (see generateImage.ts).
    const { chargeUsage } = await import('@/services/BudgetService');
    await chargeUsage({ orgId: ctx.orgId, agentSlug: ctx.agentSlug, feature: FEATURES.SEO_RESEARCH, model, usage: { inputTokens: units } });
  } catch (err) {
    console.warn('[serp] could not record the charge', { orgId: ctx.orgId, model, units, error: (err as Error).message });
  }
}

/**
 * Words for a provider failure the model can act on, never a secret.
 * @param err - What was thrown.
 */
function failure(err: unknown): string {
  if (err instanceof ToolProviderKeyUnavailableError) {
    return `${err.message}. A workspace admin can re-enter it under API credentials. Say the research could not run; do not substitute remembered rankings.`;
  }
  if (err instanceof ProviderNotConfiguredError) {
    return 'SERP research is not configured: no SERP provider key and no web search provider. A workspace admin can add a Serper key under API credentials. Say the research could not run; do not substitute remembered rankings.';
  }
  return `SERP research failed: ${(err as Error).message ?? 'unknown error'}. Do not substitute remembered rankings.`;
}

const whereArgs = {
  location: z.string().max(120).optional().describe('Where the search is made from, as Google names places: "Denver, Colorado, United States". Omit for the country as a whole.'),
  language: z.string().min(2).max(8).optional().describe('Interface language, ISO 639-1 (Google `hl`), e.g. "en".'),
  country: z.string().length(2).optional().describe('Country, ISO 3166-1 alpha-2 (Google `gl`), e.g. "us".'),
  device: z.enum(['desktop', 'mobile']).optional().describe('Desktop (default) or mobile results.'),
};

function serpSearchTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const serp = await searchSerp({ query: args.query, location: args.location, language: args.language, country: args.country, device: args.device, num: args.num ?? 10 }, { orgId: ctx.orgId });
        const id = serpResultIdOf(serp);
        remember(id, serp);
        if (serp.isGoogleRanking) {
          await charge(ctx, `serp/${serp.provider}`, serp.billedUnits);
        }
        // JSON, with the page first: `serp_compare` finds it again by id in
        // the tool-call record, which keeps the first 10,000 characters.
        return JSON.stringify({ serpResultId: id, serp });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: 'serp_search',
      description: [
        'Read Google\'s results page for a search query: the organic top results (position, URL, domain, title, snippet, the date Google showed), the featured snippet, People Also Ask, related searches, the ads count, which provider read it and `retrievedAt`.',
        'Use before planning or briefing an SEO page, and quote positions with the date they were read. Returns `serpResultId` for `serp_compare`.',
        'If `serp.isGoogleRanking` is false the result came from the web search engine because no SERP provider is configured: say so (the `note` says it in words) and never present its order as Google\'s ranking.',
      ].join(' '),
      schema: z.object({
        query: z.string().min(1).max(400).describe('The search query, exactly as a person would type it'),
        ...whereArgs,
        num: z.number().int().min(1).max(100).optional().describe('How many organic results (default 10)'),
      }),
    },
  );
}

const pointSchema = z.object({
  point: z.string().min(1).max(400).describe('One finding, in plain words'),
  sources: z.array(z.number().int().min(1).max(100)).describe('Positions (the # column) of the pages that show it'),
});

const synthesisSchema = z.object({
  intent: z.string().min(1).max(600).describe('What the searcher wants, read from what ranks: to learn, compare, buy or find a place, and in what form'),
  common_subtopics: z.array(pointSchema).max(20).describe('What the top pages all cover — a new page must too'),
  gaps: z.array(pointSchema).max(20).describe('What the top pages miss or do thinly — where a new page can win'),
});

/**
 * Read the top pages of a results page into the compared facts.
 * @param ctx - The turn.
 * @param results - The organic results to read.
 */
async function readPages(ctx: RuntimeContext, results: SerpOrganicResult[]): Promise<ComparedPage[]> {
  const provider = getBrowseProvider();
  return mapWithConcurrency(results, COMPARE_CONCURRENCY, async (r): Promise<ComparedPage> => {
    const base = { position: r.position, url: r.url, domain: r.domain, serpTitle: r.title, ...(r.date ? { serpDate: r.date } : {}) };
    try {
      const raw = await provider.fetchHtml(r.url, { orgId: ctx.orgId });
      return raw ? { ...base, facts: extractPageFacts(raw.html, raw.url) } : { ...base, facts: null, error: 'not an HTML page' };
    } catch (err) {
      return { ...base, facts: null, error: (err as Error).message?.slice(0, 160) || 'could not be read' };
    }
  });
}

/**
 * Write the agent's synthesis into a brief it filed.
 * @param ctx - The turn.
 * @param briefId - The brief artifact.
 * @param synthesis - What the agent concluded.
 */
async function writeSynthesis(ctx: RuntimeContext, briefId: number, synthesis: Synthesis): Promise<string> {
  const { getArtifact, toPayload, updateArtifact } = await import('@/services/ArtifactService');
  const brief = await getArtifact({ orgId: ctx.orgId, id: briefId });
  const md = typeof brief?.spec?.md === 'string' ? brief.spec.md : null;
  if (!brief || md === null) {
    return `No SERP brief #${briefId} in this workspace. Run serp_compare without brief_id first.`;
  }
  // The citations resolve against the brief's own rows, read back from it.
  const pages: ComparedPage[] = [...md.matchAll(/^\| (\d+) \| \[[^\]]*\]\((\S+?)\)/gm)].map(m => ({ position: Number(m[1]), url: m[2]!, domain: '', serpTitle: '', facts: null }));
  const next = withSynthesis(md, renderSynthesis(synthesis, pages));
  if (next === null) {
    return `SERP brief #${briefId} no longer has its synthesis section (it was edited). Use update_artifact to add the synthesis by hand.`;
  }
  const { artifact, version } = await updateArtifact({
    orgId: ctx.orgId,
    id: briefId,
    contentMarkdown: next,
    author: authorOf(ctx),
    changeSummary: 'wrote the synthesis',
    runId: ctx.traceId ?? null,
  });
  ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
  ctx.emit({ type: 'version_written', ref: { type: 'artifact', id: String(artifact.id), label: artifact.title }, artifactId: artifact.id, from: version.version > 1 ? version.version - 1 : null, to: version.version });
  return `Wrote the synthesis into "${artifact.title}" (v${version.version}). The person sees it in the pane — do not repeat it as text.`;
}

function serpCompareTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        if (args.brief_id !== undefined && args.synthesis) {
          return await writeSynthesis(ctx, args.brief_id, {
            intent: args.synthesis.intent,
            commonSubtopics: args.synthesis.common_subtopics,
            gaps: args.synthesis.gaps,
          });
        }
        let serp: SerpResult | null = null;
        if (args.serp_result_id) {
          serp = await recall(ctx, args.serp_result_id);
          if (!serp && !args.query) {
            return `No results page ${args.serp_result_id} was found (it may be from another workspace or too old). Call serp_compare with the query instead.`;
          }
        }
        if (!serp) {
          if (!args.query) {
            return 'serp_compare needs `query` or `serp_result_id` (or `brief_id` with `synthesis`).';
          }
          serp = await searchSerp({ query: args.query, location: args.location, language: args.language, country: args.country, device: args.device, num: 10 }, { orgId: ctx.orgId });
          remember(serpResultIdOf(serp), serp);
          if (serp.isGoogleRanking) {
            await charge(ctx, `serp/${serp.provider}`, serp.billedUnits);
          }
        }
        const top = serp.organic.slice(0, args.top ?? 10);
        if (top.length === 0) {
          return `The results page for "${serp.query}" had no organic results to compare.`;
        }
        const pages = await readPages(ctx, top);
        const md = renderSerpBrief(serp, pages);
        const { artifactId, receipt } = await renderMarkdownArtifact(ctx, `SERP brief: ${serp.query}`, md, SERP_BRIEF_FOLDER);
        return JSON.stringify({
          briefArtifactId: artifactId,
          serpResultId: serpResultIdOf(serp),
          query: serp.query,
          provider: serp.provider,
          isGoogleRanking: serp.isGoogleRanking,
          ...(serp.note ? { note: serp.note } : {}),
          retrievedAt: serp.retrievedAt,
          pages: pages.map(p => p.facts
            ? {
                position: p.position,
                url: p.url,
                domain: p.domain,
                title: p.facts.title,
                metaDescription: p.facts.metaDescription,
                wordCount: p.facts.wordCount,
                outline: p.facts.outline.slice(0, 40).map(h => `H${h.level} ${h.text}`),
                schemaTypes: p.facts.schemaTypes,
                faq: p.facts.faq.present,
                imagesCount: p.facts.imagesCount,
                links: p.facts.links,
                published: p.facts.published,
                updated: p.facts.updated,
              }
            : { position: p.position, url: p.url, domain: p.domain, couldNotRead: p.error }),
          sharedHeadings: recurringHeadings(pages),
          peopleAlsoAsk: serp.peopleAlsoAsk.map(q => q.question),
          receipt,
          next: artifactId === null
            ? 'The brief could not be filed; report the facts above instead.'
            : `Now write the synthesis from these facts: call serp_compare again with brief_id ${artifactId} and synthesis { intent, common_subtopics, gaps }, each point citing the positions of the pages that show it.`,
        });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: 'serp_compare',
      description: [
        'Read the top pages Google ranks for a query and compare them: per page the title, meta description, H1–H3 outline, word count, schema.org types, whether it has an FAQ, images, internal and external links, and the published and updated dates it states. Files a "SERP brief" artifact (folder seo/serp) with every row linked and dated.',
        'Pass `serp_result_id` from serp_search (or a `query` to search afresh) and `top` (5–10). Then call it once more with `brief_id` and `synthesis` to write the intent, the subtopics every top page covers and the gaps, each point citing page positions.',
      ].join(' '),
      schema: z.object({
        query: z.string().min(1).max(400).optional().describe('The search query; omit when passing serp_result_id'),
        serp_result_id: z.string().max(40).optional().describe('The serpResultId serp_search returned'),
        top: z.number().int().min(5).max(10).optional().describe('How many of the top results to read (5–10, default 10)'),
        ...whereArgs,
        brief_id: z.number().int().positive().optional().describe('With `synthesis`: the brief artifact to write the synthesis into'),
        synthesis: synthesisSchema.optional().describe('With `brief_id`: your synthesis of the brief\'s facts'),
      }),
    },
  );
}

function keywordMetricsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const keywords = [...new Set(args.keywords.map(k => k.trim()).filter(Boolean))];
        const outcome = await keywordMetrics(keywords, { location: args.location, language: args.language }, { orgId: ctx.orgId });
        if (!outcome.ok) {
          return JSON.stringify({ ok: false, keywords, reason: outcome.reason });
        }
        await charge(ctx, 'serp/dataforseo-search-volume', outcome.result.billedUnits);
        return JSON.stringify({ ok: true, source: 'Google Ads data via DataForSEO', ...outcome.result });
      } catch (err) {
        return failure(err).replace('SERP research', 'Keyword metrics').replace('remembered rankings', 'estimated volumes');
      }
    },
    {
      name: 'keyword_metrics',
      description: 'Monthly search volume, cost per click and competition for up to 1,000 keywords, from Google Ads data (DataForSEO), with when it was read. When no provider has volume it says it could not establish volume — say that, never estimate a number.',
      schema: z.object({
        keywords: z.array(z.string().min(1).max(80)).min(1).max(1000).describe('The keywords, as people search them'),
        location: z.string().max(120).optional().describe('As Google names places: "United States" (default), "Denver, Colorado, United States"'),
        language: z.string().min(2).max(8).optional().describe('ISO 639-1, default "en"'),
      }),
    },
  );
}

/**
 * The SERP tools this agent was granted: all three with `serp`, or any one by name.
 * @param ctx - The turn.
 */
export function serpTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const build: Record<(typeof SERP_TOOL_NAMES)[number], (c: RuntimeContext) => StructuredToolInterface> = {
    serp_search: serpSearchTool,
    serp_compare: serpCompareTool,
    keyword_metrics: keywordMetricsTool,
  };
  return SERP_TOOL_NAMES.filter(name => granted(ctx, name)).map(name => build[name](ctx));
}
