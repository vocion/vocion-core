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
 *     dated: the local pack, directories flagged and left out of every
 *     aggregate, a capped slice of each page's main text and the terms
 *     three or more ranking pages share. The agent then writes the synthesis
 *     into the brief with the same tool (`brief_id` + `synthesis`), each
 *     point cited to its pages. Google's ranking only: with no SERP provider
 *     it refuses rather than compare another engine's order.
 *   - `keyword_cluster` — which keywords one page should target: keywords
 *     whose top tens share three or more URLs are one cluster. Pure code over
 *     `serp_search` results, no volume needed.
 *   - `keyword_metrics` — search volume, CPC, competition and keyword ideas
 *     from DataForSEO; anywhere else it says plainly that they could not be
 *     established.
 *
 * With the SEO app on, every keyword these read is kept in the client
 * project's Keywords register, in code, as part of the call
 * (`keywordRegister.ts`): the results with the date they were read, the
 * volume, the cluster. Research done in a chat leaves its rows behind.
 *
 * Results pages are cached per run (`cachedSearch`): clustering ten keywords
 * and then comparing one of them reads that page once.
 *
 * Granted, not default (`harness.grantTools: [serp]`, or a tool by name):
 * every call is a paid vendor call, charged to `seo.research`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { ComparedPage, Synthesis } from '@/libs/tools/serp/brief';
import type { SerpOrganicResult, SerpQuery, SerpResult } from '@/libs/tools/serp/types';
import { createHash } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { stepProgress } from '@/libs/chat/stepProgress';
import { mapWithConcurrency } from '@/libs/concurrency';
import { FEATURES } from '@/libs/Langfuse/features';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { rankingPages, recurringHeadings, renderSerpBrief, renderSynthesis, SERP_BRIEF_FOLDER, termTable, withSynthesis } from '@/libs/tools/serp/brief';
import { clusterKeywords, SHARED_URLS_FOR_ONE_PAGE } from '@/libs/tools/serp/cluster';
import { isDirectoryDomain } from '@/libs/tools/serp/directories';
import { extractPageFacts } from '@/libs/tools/serp/pageFacts';
import { keywordIdeas, keywordMetrics, searchSerp } from '@/libs/tools/serp/registry';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';
import { keepResearch, serpResearch } from './keywordRegister';
import { authorOf, renderMarkdownArtifact } from './renderArtifacts';

/** The grant that puts all three on an agent's belt. */
export const SERP_GRANT = 'serp';

export const SERP_TOOL_NAMES = ['serp_search', 'serp_compare', 'keyword_cluster', 'keyword_metrics'] as const;

/** Pages read at once by `serp_compare`: polite to the sites, quick enough for a turn. */
const COMPARE_CONCURRENCY = 4;

/** Results pages kept in this process for `serp_compare` to pick up by id. */
const RECENT_CAP = 200;
const recent = new Map<string, SerpResult>();

/** Characters of each page's main text `serp_compare` hands the model, at most. */
const EXCERPT_CAP = 3_000;
/** Characters of main text across all pages, shared out so ten pages stay readable in one turn. */
const EXCERPT_BUDGET = 20_000;

/** Keywords one `keyword_cluster` call may read (one paid search each). */
const CLUSTER_MAX = 50;

/** Results pages a run already read, so the same search is paid for once. */
const RUN_CACHE_CAP = 500;
const RUN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const runCache = new Map<string, { at: number; serp: Promise<SerpResult> }>();

/**
 * The key one run's searches are cached under: the workspace, the run (the
 * mission run, else the conversation, else the trace) and the search itself.
 * @param ctx - The turn.
 * @param q - The search.
 */
function runCacheKey(ctx: RuntimeContext, q: SerpQuery): string | null {
  const run = ctx.missionRunId ? `m${ctx.missionRunId}` : ctx.conversationId ? `c${ctx.conversationId}` : ctx.traceId ? `t${ctx.traceId}` : null;
  if (!run) {
    return null;
  }
  const norm = (v?: string) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return [ctx.orgId, run, norm(q.query), norm(q.location), norm(q.language), norm(q.country), q.device ?? 'desktop', q.num ?? 10].join('|');
}

/**
 * Google's results page for a search, read once per run: a second ask for
 * the same search in the same run (the same keyword clustered, then
 * compared) gets the page already read and spends nothing. Charges what the
 * vendor billed on the first read only.
 * @param ctx - The turn.
 * @param q - The search.
 * @param googleOnly - Refuse the web search fallback (SEO work).
 */
export async function cachedSearch(ctx: RuntimeContext, q: SerpQuery, googleOnly: boolean): Promise<{ serp: SerpResult; cached: boolean }> {
  const key = runCacheKey(ctx, q);
  const now = Date.now();
  const hit = key ? runCache.get(key) : undefined;
  if (hit && now - hit.at < RUN_CACHE_TTL_MS) {
    const serp = await hit.serp;
    if (!googleOnly || serp.isGoogleRanking) {
      return { serp, cached: true };
    }
  }
  const pending = searchSerp(q, { orgId: ctx.orgId, ...(googleOnly ? { googleOnly } : {}) });
  if (key) {
    runCache.set(key, { at: now, serp: pending });
    pending.catch(() => runCache.delete(key));
    while (runCache.size > RUN_CACHE_CAP) {
      runCache.delete(runCache.keys().next().value!);
    }
  }
  const serp = await pending;
  remember(serpResultIdOf(serp), serp);
  if (serp.isGoogleRanking) {
    await charge(ctx, `serp/${serp.provider}`, serp.billedUnits);
  }
  return { serp, cached: false };
}

/** Test seam: forget every cached results page. */
export function clearSerpRunCache(): void {
  runCache.clear();
  recent.clear();
}

/** What SEO work refuses to build on another engine's order. */
const NOT_GOOGLE = 'SEO research needs Google\'s own ranking, and no SERP provider is configured. A workspace admin can add a Serper key under API credentials (Tools → Google results). Say the research could not run; do not compare web search results or remembered rankings in its place.';

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
export async function recall(ctx: RuntimeContext, id: string): Promise<SerpResult | null> {
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

let budget: Promise<typeof import('@/services/BudgetService')> | null = null;

/**
 * `BudgetService`, imported on first use: it reaches the database handle,
 * which validates the whole environment at import (see generateImage.ts).
 * One import shared by every caller, so a cluster's parallel searches do not
 * each start one.
 */
function budgetService(): Promise<typeof import('@/services/BudgetService')> {
  budget ??= import('@/services/BudgetService').catch((err) => {
    budget = null;
    throw err;
  });
  return budget;
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
    const { chargeUsage } = await budgetService();
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
    return 'SERP research is not configured: no SERP provider key. A workspace admin can add a Serper key under API credentials. Say the research could not run; do not substitute remembered rankings.';
  }
  return `SERP research failed: ${(err as Error).message ?? 'unknown error'}. Do not substitute remembered rankings.`;
}

/** Which client's register the research is kept in. */
const projectArg = z.number().int().positive().optional().describe('The client project (list_projects) this is for: what it reads is kept in that project\'s Keywords register.');

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
        const { serp } = await cachedSearch(ctx, { query: args.query, location: args.location, language: args.language, country: args.country, device: args.device, num: args.num ?? 10 }, false);
        const id = serpResultIdOf(serp);
        remember(id, serp);
        const directoryPositions = serp.organic.filter(r => isDirectoryDomain(r.domain)).map(r => r.position);
        const kept = await keepResearch(ctx, args.project_id, [serpResearch(serp)]);
        // JSON, with the page first: `serp_compare` finds it again by id in
        // the tool-call record, which keeps the first 10,000 characters.
        return JSON.stringify({ serpResultId: id, serp, ...(directoryPositions.length ? { directoryPositions } : {}), ...kept });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: 'serp_search',
      description: [
        'Read Google\'s results page for a search query: the organic top results (position, URL, domain, title, snippet, the date Google showed), the local pack (the businesses on the map: name, rating, reviews, category, website, address), the featured snippet, People Also Ask, related searches, the ads count, which provider read it and `retrievedAt`.',
        '`directoryPositions` lists results that are directories, marketplaces or social sites (Yelp, Angi and the like): they rank, but they are not pages a business writes.',
        'Use before planning or briefing an SEO page, and quote positions with the date they were read. For a city or service-area page, search the city query itself ("water heater repair fairview") with `location` set to that city. Returns `serpResultId` for `serp_compare`.',
        'If `serp.isGoogleRanking` is false the result came from the web search engine because no SERP provider is configured: say so (the `note` says it in words) and never present its order as Google\'s ranking; serp_compare and keyword_cluster refuse it.',
      ].join(' '),
      schema: z.object({
        query: z.string().min(1).max(400).describe('The search query, exactly as a person would type it'),
        ...whereArgs,
        num: z.number().int().min(1).max(100).optional().describe('How many organic results (default 10)'),
        project_id: projectArg,
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
  common_subtopics: z.array(pointSchema).max(20).describe('What the ranking pages (not the directories) all cover in their body text — a new page must too'),
  gaps: z.array(pointSchema).max(20).describe('What the ranking pages\' body text misses or does thinly — where a new page can win'),
});

/**
 * Read the top pages of a results page into the compared facts, each
 * directory flagged.
 * @param ctx - The turn.
 * @param results - The organic results to read.
 */
async function readPages(ctx: RuntimeContext, results: SerpOrganicResult[]): Promise<ComparedPage[]> {
  const provider = getBrowseProvider();
  const readPage = async (r: SerpOrganicResult): Promise<ComparedPage> => {
    const base = { position: r.position, url: r.url, domain: r.domain, serpTitle: r.title, ...(r.date ? { serpDate: r.date } : {}), ...(isDirectoryDomain(r.domain || r.url) ? { directory: true } : {}) };
    try {
      const raw = await provider.fetchHtml(r.url, { orgId: ctx.orgId });
      return raw ? { ...base, facts: extractPageFacts(raw.html, raw.url) } : { ...base, facts: null, error: 'not an HTML page' };
    } catch (err) {
      return { ...base, facts: null, error: (err as Error).message?.slice(0, 160) || 'could not be read' };
    }
  };
  // Where the reading has got to, on the step's own line: "(4 of 10)".
  const progress = stepProgress(ctx.emit, 'serp_compare');
  let read = 0;
  return mapWithConcurrency(results, COMPARE_CONCURRENCY, async (r) => {
    const page = await readPage(r);
    read += 1;
    progress.count(read, results.length);
    return page;
  });
}

/**
 * Each ranking page's main text, cut to its share of the budget, so the model
 * judges gaps from what pages say and not from their headings alone.
 * @param pages - The compared pages.
 */
export function excerptsOf(pages: ComparedPage[]): Map<number, string> {
  const readable = rankingPages(pages).filter(p => p.facts!.text);
  const each = readable.length ? Math.min(EXCERPT_CAP, Math.floor(EXCERPT_BUDGET / readable.length)) : 0;
  return new Map(readable.map((p) => {
    const text = p.facts!.text;
    if (text.length <= each) {
      return [p.position, text];
    }
    const cut = text.slice(0, each);
    const end = cut.lastIndexOf(' ');
    return [p.position, `${cut.slice(0, end > each * 0.8 ? end : each)} …`];
  }));
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
  const pages: ComparedPage[] = md.split('\n').flatMap((line) => {
    const m = /^\| (\d+) \| \[[^\]]*\]\((\S+?)\)/.exec(line);
    return m ? [{ position: Number(m[1]), url: m[2]!, domain: '', serpTitle: '', facts: null, ...(line.includes(' · directory |') ? { directory: true } : {}) }] : [];
  });
  // What "the ranking pages cover" is never a directory's listing page.
  const directories = new Set(pages.filter(p => p.directory).map(p => p.position));
  const leaning = synthesis.commonSubtopics.filter(p => p.sources.some(n => directories.has(n)));
  if (leaning.length > 0) {
    return `Not written: ${leaning.map(p => `"${p.point}"`).join(', ')} cite${leaning.length === 1 ? 's' : ''} ${[...new Set(leaning.flatMap(p => p.sources.filter(n => directories.has(n))))].map(n => `#${n}`).join(', ')}, which ${directories.size === 1 ? 'is a directory' : 'are directories'}. Common subtopics are what the business pages cover: cite only those, then call serp_compare with brief_id ${briefId} again.`;
  }
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
        if (serp && !serp.isGoogleRanking) {
          // A brief on another engine's order reads as authoritative and is not.
          return `Not compared: ${args.serp_result_id} is ${serp.provider.replace(/^web_search:/, '')} web search results, not Google's ranking. ${NOT_GOOGLE}`;
        }
        if (!serp) {
          if (!args.query) {
            return 'serp_compare needs `query` or `serp_result_id` (or `brief_id` with `synthesis`).';
          }
          serp = (await cachedSearch(ctx, { query: args.query, location: args.location, language: args.language, country: args.country, device: args.device, num: 10 }, true)).serp;
        }
        const kept = await keepResearch(ctx, undefined, [serpResearch(serp)]);
        const top = serp.organic.slice(0, args.top ?? 10);
        if (top.length === 0) {
          return `The results page for "${serp.query}" had no organic results to compare.`;
        }
        const pages = await readPages(ctx, top);
        const md = renderSerpBrief(serp, pages);
        const { artifactId, receipt } = await renderMarkdownArtifact(ctx, `SERP brief: ${serp.query}`, md, SERP_BRIEF_FOLDER);
        const excerpts = excerptsOf(pages);
        const ranking = rankingPages(pages).length;
        return JSON.stringify({
          briefArtifactId: artifactId,
          serpResultId: serpResultIdOf(serp),
          query: serp.query,
          ...(serp.location ? { location: serp.location } : {}),
          provider: serp.provider,
          retrievedAt: serp.retrievedAt,
          ...(serp.localPack?.length ? { localPack: serp.localPack } : {}),
          pages: pages.map((p) => {
            const flag = p.directory ? { directory: true } : {};
            return p.facts
              ? {
                  position: p.position,
                  url: p.url,
                  domain: p.domain,
                  ...flag,
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
                  ...(excerpts.has(p.position) ? { text: excerpts.get(p.position) } : {}),
                }
              : { position: p.position, url: p.url, domain: p.domain, ...flag, couldNotRead: p.error };
          }),
          sharedHeadings: recurringHeadings(pages),
          sharedTerms: termTable(pages, serp.query),
          peopleAlsoAsk: serp.peopleAlsoAsk.map(q => q.question),
          receipt,
          ...kept,
          next: artifactId === null
            ? 'The brief could not be filed; report the facts above instead.'
            : [
                `Now write the synthesis from these facts: call serp_compare again with brief_id ${artifactId} and synthesis { intent, common_subtopics, gaps }, each point citing the positions of the pages that show it.`,
                `Judge coverage and gaps from each page's \`text\` and \`sharedTerms\`, not from headings alone: a subject a page covers in its body counts even with no heading for it.`,
                ranking < pages.length ? `Pages marked \`directory\` are listed but are not pages a business writes: never count them in what "the ranking pages cover" and never cite them for a subtopic.` : null,
                serp.localPack?.length ? 'The local pack shows who wins the map for this search: name it in the intent when the search is local.' : null,
              ].filter(Boolean).join(' '),
        });
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) {
          return NOT_GOOGLE;
        }
        return failure(err);
      }
    },
    {
      name: 'serp_compare',
      description: [
        'Read the top pages Google ranks for a query and compare them: per page the title, meta description, H1–H3 outline, word count, schema.org types, whether it has an FAQ, images, internal and external links, the published and updated dates it states, and a slice of its main text; the local pack; the headings and the body terms three or more ranking pages share, each with the pages that use it. Directories, marketplaces and social sites are flagged and left out of every aggregate. Files a "SERP brief" artifact (folder seo/serp) with every row linked and dated.',
        'Google\'s ranking only: with no SERP provider configured it refuses rather than compare web search results.',
        'Pass `serp_result_id` from serp_search (or a `query` to search afresh) and `top` (5–10). Then call it once more with `brief_id` and `synthesis` to write the intent, the subtopics every ranking page covers and the gaps, judged from the pages\' text, each point citing page positions.',
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

function keywordClusterTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const keywords = [...new Map(args.keywords.map(k => k.trim()).filter(Boolean).map(k => [k.toLowerCase().replace(/\s+/g, ' '), k])).values()];
      if (keywords.length < 2) {
        return 'keyword_cluster needs at least two different keywords.';
      }
      if (keywords.length > CLUSTER_MAX) {
        return `keyword_cluster reads one results page per keyword; ${keywords.length} is more than the ${CLUSTER_MAX} one call may read. Split the list.`;
      }
      // One results page per keyword: the step's line says how far it has read.
      const progress = stepProgress(ctx.emit, 'keyword_cluster');
      let done = 0;
      const read = await mapWithConcurrency(keywords, COMPARE_CONCURRENCY, async (keyword) => {
        try {
          const { serp, cached } = await cachedSearch(ctx, { query: keyword, location: args.location, language: args.language, country: args.country, num: 10 }, true);
          return { keyword, serp, cached };
        } catch (err) {
          return { keyword, error: err };
        } finally {
          done += 1;
          progress.count(done, keywords.length);
        }
      });
      const failed = read.filter((r): r is { keyword: string; error: unknown } => 'error' in r);
      if (failed.length === read.length) {
        const err = failed[0]!.error;
        return err instanceof ProviderNotConfiguredError ? NOT_GOOGLE : failure(err);
      }
      const ok = read.filter((r): r is { keyword: string; serp: SerpResult; cached: boolean } => 'serp' in r);
      const clusters = clusterKeywords(ok.map(r => ({ keyword: r.keyword, urls: r.serp.organic.slice(0, 10).map(o => o.url) })), { minShared: SHARED_URLS_FOR_ONE_PAGE });
      const idOf = new Map(ok.map(r => [r.keyword, serpResultIdOf(r.serp)]));
      const headOf = new Map(clusters.flatMap(c => c.members.map(m => [m.keyword, c.head] as const)));
      const kept = await keepResearch(ctx, args.project_id, ok.map((r) => {
        const read = serpResearch(r.serp);
        const head = headOf.get(r.keyword);
        return { ...read, keyword: r.keyword, ...(head ? { cluster: { head, checkedAt: r.serp.retrievedAt } } : {}) };
      }));
      return JSON.stringify({
        rule: `Keywords whose Google top 10s share ${SHARED_URLS_FOR_ONE_PAGE} or more URLs belong on one page; each joins the cluster whose head it overlaps most.`,
        provider: ok[0]!.serp.provider,
        ...(args.location ? { location: args.location } : {}),
        retrievedAt: ok.map(r => r.serp.retrievedAt).sort()[0],
        searchesRead: ok.filter(r => !r.cached).length,
        searchesReused: ok.filter(r => r.cached).length,
        clusters: clusters.map(c => ({
          page: c.head,
          keywords: c.members.map(m => ({ keyword: m.keyword, serpResultId: idOf.get(m.keyword), ...(m.keyword === c.head ? {} : { sharedWithHead: m.sharedWithHead, sharedUrls: m.sharedUrls }) })),
        })),
        ...(failed.length ? { couldNotRead: failed.map(f => ({ keyword: f.keyword, why: failure(f.error) })) } : {}),
        next: 'Plan one page per cluster (seo_plan_batch): the head as the target keyword, the rest as its secondary keywords. A keyword alone in its cluster gets its own page or is dropped. Each serpResultId can go straight to serp_compare without searching again.',
        ...kept,
      });
    },
    {
      name: 'keyword_cluster',
      description: [
        'Group keywords by what Google ranks for them: keywords whose top 10 results share 3 or more URLs belong on one page; the rest need pages of their own. Reads one Google results page per keyword (reused within the run, so a later serp_compare on the same keyword is free) and needs no search volume.',
        'Use before seo_plan_batch so two planned pages never target the same results. Google\'s ranking only: refuses without a SERP provider.',
      ].join(' '),
      schema: z.object({
        keywords: z.array(z.string().min(1).max(200)).min(2).max(CLUSTER_MAX).describe('The candidate keywords, as people search them; the most important first (each cluster forms around the first keyword in it)'),
        location: whereArgs.location,
        language: whereArgs.language,
        country: whereArgs.country,
        project_id: projectArg,
      }),
    },
  );
}

function keywordMetricsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const keywords = [...new Set(args.keywords.map(k => k.trim()).filter(Boolean))];
        const where = { location: args.location, language: args.language };
        const [outcome, ideas] = await Promise.all([
          keywordMetrics(keywords, where, { orgId: ctx.orgId }),
          args.ideas === false ? Promise.resolve(null) : keywordIdeas(keywords, where, { orgId: ctx.orgId }),
        ]);
        let ideasOut: Record<string, unknown> = {};
        if (ideas?.ok) {
          await charge(ctx, 'serp/dataforseo-keyword-ideas', ideas.result.billedUnits);
          ideasOut = { ideas: ideas.result.ideas, ideasFrom: ideas.result.seeds };
        } else if (ideas) {
          ideasOut = { ideas: null, ideasUnavailable: ideas.reason };
        }
        if (!outcome.ok) {
          // Looked at, with nothing established: the rows say so by having no volume.
          const kept = await keepResearch(ctx, args.project_id, keywords.map(keyword => ({ keyword })));
          return JSON.stringify({ ok: false, keywords, reason: outcome.reason, ...ideasOut, ...kept });
        }
        await charge(ctx, 'serp/dataforseo-search-volume', outcome.result.billedUnits);
        const r = outcome.result;
        const kept = await keepResearch(ctx, args.project_id, r.metrics.map(m => ({ keyword: m.keyword, metrics: { checkedAt: r.retrievedAt, volume: m.searchVolume, competition: m.competition, competitionIndex: m.competitionIndex, cpc: m.cpc, location: r.location, language: r.language } })));
        return JSON.stringify({ ok: true, source: 'Google Ads data via DataForSEO', ...r, ...ideasOut, ...kept });
      } catch (err) {
        return failure(err).replace('SERP research', 'Keyword metrics').replace('remembered rankings', 'estimated volumes');
      }
    },
    {
      name: 'keyword_metrics',
      description: 'Monthly search volume, cost per click and competition for up to 1,000 keywords, plus keyword ideas (related searches Google Ads suggests for the first 20, with their numbers), from Google Ads data (DataForSEO), with when it was read. Volume and ideas need DataForSEO: on Serper or SerpApi alone it says it could not establish them — say that, never estimate a number or invent keywords.',
      schema: z.object({
        keywords: z.array(z.string().min(1).max(80)).min(1).max(1000).describe('The keywords, as people search them'),
        location: z.string().max(120).optional().describe('As Google names places: "United States" (default), "Denver, Colorado, United States"'),
        language: z.string().min(2).max(8).optional().describe('ISO 639-1, default "en"'),
        ideas: z.boolean().optional().describe('Also fetch keyword ideas for these keywords (default true; another paid call)'),
        project_id: projectArg,
      }),
    },
  );
}

/**
 * The SERP tools this agent was granted: all of them with `serp`, or any one by name.
 * @param ctx - The turn.
 */
export function serpTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const build: Record<(typeof SERP_TOOL_NAMES)[number], (c: RuntimeContext) => StructuredToolInterface> = {
    serp_search: serpSearchTool,
    serp_compare: serpCompareTool,
    keyword_cluster: keywordClusterTool,
    keyword_metrics: keywordMetricsTool,
  };
  return SERP_TOOL_NAMES.filter(name => granted(ctx, name)).map(name => build[name](ctx));
}
