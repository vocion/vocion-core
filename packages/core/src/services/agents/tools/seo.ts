/**
 * The SEO app's tools — present while the `seo` plugin is on.
 *
 *   seo_plan_batch       a batch and its keyword plan for one project; files the plan's sign-off
 *   seo_next_pages       what the project's gate lets be written now, why the rest wait, and the client's adopted rules
 *   seo_start_writing    queue the released pages for the background run (writing never runs in a chat turn)
 *   seo_save_research    the SERP brief artifact on a page; a location page's must be its own city's read
 *   seo_save_brief       the page brief on a page; REFUSES a page whose plan is not signed off
 *   seo_save_draft       the draft and its meta on a page; REFUSES a page the gate has not released
 *   seo_save_review      the editor's verdict; a pass files the page's sign-off itself;
 *                        FAILS a location page that is a sibling with the city swapped
 *   seo_record_feedback  a note on a page, its scope, and where it was filed — checked, not taken on trust
 *
 * The gate is code (`services/seo/gate.ts`), not a prompt, and so are the
 * asks (`services/seo/signoff.ts`): these tools are the only path that
 * attaches a draft, they read the project's gate before they write, and they
 * file every sign-off a person answers. Each step records the model that
 * actually ran it (`modelThatRan.ts`) on the page — the call that made the
 * tool call, a teammate's own — so the batch page can say "Written by
 * Opus 5.5" and mean it.
 *
 * The tools take `project_id` (a Project, internally a `data_room` record)
 * and reach it through `services/seo/projects.ts`.
 */

import type { RuntimeContext } from '../types';
import type { ToolCallRuntime } from '@/services/seo/modelThatRan';
import type { SeoFeedback, SeoPageRecord, SeoPageType } from '@/services/seo/records';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { SERP_BRIEF_FOLDER, serpBriefMeta, SYNTHESIS_END, SYNTHESIS_START } from '@/libs/tools/serp/brief';
import { anchorArtifact, createArtifact, getArtifact } from '@/services/ArtifactService';
import { LOCATION_PAGE_SIMILARITY_LIMIT, nearDuplicates, queryNamesLocation } from '@/services/seo/duplicates';
import { whyNotWritable } from '@/services/seo/gate';
import { checkPageMeta } from '@/services/seo/meta';
import { modelThatRan } from '@/services/seo/modelThatRan';
import { readSeoProject, seoProjectHref } from '@/services/seo/projects';
import { feedbackCheck, getSeoBatch, getSeoPage, listProjectSeoPages, listSeoPages, patchSeoPage, pathKey, planApproved, planSeoBatch, readSeoGate, refreshSeoBatch, revisePlan, SEO_LEARNING_STEP, SEO_PAGE_TYPES, SeoSetupError } from '@/services/seo/records';
import { fileSeoPlanAsk, fileSeoSignoffAsk, withdrawPageAsks } from '@/services/seo/signoff';
import { findingsMd, followFrom, normaliseFindings, queueSeoWork, SEO_EDITOR_ROUNDS } from '@/services/seo/work';
import { describeVoiceFindings, draftVoiceFindings } from '@/services/seo/voiceCheck';
import { recordIdArg, recordIdOf } from './recordIdArg';

export const SEO_PLUGIN = 'seo';

const pageHref = (id: number) => `/dashboard/objects/${id}`;
const batchHref = (id: number) => `/dashboard/p/seo-pages?batch=${id}`;
const artifactLink = (id: number) => `/dashboard/artifacts/${id}`;

/**
 * Models often stringify nested tool args — parse JSON strings back.
 * @param v - The raw argument.
 */
function coerceJson<T>(v: T): T {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return v;
    }
  }
  return v;
}

async function pageArg(ctx: RuntimeContext, raw: number | string): Promise<SeoPageRecord | string> {
  const ref = await recordIdOf(ctx.orgId, raw);
  if ('reason' in ref) {
    return `Not saved: no such page (${ref.reason}).`;
  }
  const page = await getSeoPage(ctx.orgId, ref.id);
  return page ?? `Not saved: #${ref.id} is not an SEO page in this workspace.`;
}

async function artifactArg(ctx: RuntimeContext, id: number, page: SeoPageRecord, role: string, what: string): Promise<string | null> {
  const artifact = await getArtifact({ orgId: ctx.orgId, id });
  if (!artifact) {
    return `Not saved: no artifact #${id} in this workspace. Make the ${what} first (render it as a markdown artifact), then pass its id.`;
  }
  // The artifact lives on the page's record too, so the record lists it beside
  // its versions — unless it already lives on a record (one SERP brief can
  // serve several pages of a topic, never two location pages; it stays where
  // it was first filed).
  if (!artifact.recordId) {
    await anchorArtifact({ orgId: ctx.orgId, id, record: { type: 'object', id: String(page.id), role } }).catch(() => null);
  }
  return null;
}

/**
 * Why an artifact is not a finished SERP brief, or null when it is: one
 * `serp_compare` filed (folder `seo/serp`) from Google's ranking, with its
 * synthesis written in; for a location page, read for a query naming its
 * place and not already another page's research.
 * @param ctx - The turn.
 * @param id - The artifact.
 * @param page - The page it is for.
 */
async function serpBriefProblem(ctx: RuntimeContext, id: number, page: SeoPageRecord): Promise<string | null> {
  const artifact = await getArtifact({ orgId: ctx.orgId, id });
  if (!artifact) {
    return null; // artifactArg says so.
  }
  if (artifact.folder !== SERP_BRIEF_FOLDER) {
    return `Not saved: artifact #${id} is not a SERP brief. Run serp_compare for the keyword; it files the brief in ${SERP_BRIEF_FOLDER}, and pass that id.`;
  }
  const md = typeof artifact.spec?.md === 'string' ? artifact.spec.md : '';
  const meta = serpBriefMeta(md);
  // A brief on another engine's order (filed before serp_compare refused
  // them) reads as authoritative and is not.
  if ((meta && !meta.google) || (!meta && /web search \(not Google\)/.test(md))) {
    return `Not saved: SERP brief #${id} was built on web search results, not Google's ranking. A workspace admin can add a Serper key under API credentials; then run serp_compare again.`;
  }
  const start = md.indexOf(SYNTHESIS_START);
  const end = md.indexOf(SYNTHESIS_END);
  if (start >= 0 && end > start && /_Not written yet\._/.test(md.slice(start, end))) {
    return `Not saved: SERP brief #${id} has no synthesis yet. Call serp_compare with brief_id ${id} and synthesis { intent, common_subtopics, gaps } first.`;
  }
  if (page.meta.pageType === 'location') {
    const location = page.meta.location?.trim();
    if (!location) {
      return `Not saved: page #${page.id} is a location page with no location. Its location (the city or area) is set when it is planned.`;
    }
    const query = meta?.query ?? artifact.title.replace(/^SERP brief:\s*/, '');
    if (!queryNamesLocation(query, location)) {
      return `Not saved: page #${page.id} is a location page for ${location}, and SERP brief #${id} reads "${query}", which does not name ${location}. A location page is researched on its own city's results: serp_search the query with ${location} in it (and location set to ${location}), serp_compare it, and attach that brief.`;
    }
    if (artifact.recordId && artifact.recordId !== String(page.id)) {
      return `Not saved: SERP brief #${id} is already the research of record #${artifact.recordId}. Each location page gets its own read of its own city's results; run serp_compare for "${page.meta.keyword}".`;
    }
  }
  return null;
}

/** The section a location page's brief must carry: what is true of that place. */
const LOCAL_SUBSTANCE = /^#{1,6}\s+(?:\d+[.)]\s*)?\**local substance\b/im;

/**
 * Why a location page's brief is missing its local substance, or null.
 * @param ctx - The turn.
 * @param id - The brief artifact.
 * @param page - The page.
 */
async function localSubstanceProblem(ctx: RuntimeContext, id: number, page: SeoPageRecord): Promise<string | null> {
  if (page.meta.pageType !== 'location') {
    return null;
  }
  const artifact = await getArtifact({ orgId: ctx.orgId, id });
  const md = typeof artifact?.spec?.md === 'string' ? artifact.spec.md : null;
  if (md === null || LOCAL_SUBSTANCE.test(md)) {
    return null; // artifactArg reports a missing artifact.
  }
  return `Not saved: page #${page.id} is a location page for ${page.meta.location ?? 'its area'}, and brief #${id} has no "Local substance" section. Add one (a heading "Local substance"): the client's projects, reviews and customers in ${page.meta.location ?? 'that area'} from the project, service-area facts, local codes or conditions, each with its source. If the project has nothing for that place, say so in that section; never invent it.`;
}

/**
 * The markdown of an artifact, or null.
 * @param ctx - The turn.
 * @param id - The artifact.
 */
async function markdownOf(ctx: RuntimeContext, id: number | undefined): Promise<string | null> {
  if (!id) {
    return null;
  }
  const artifact = await getArtifact({ orgId: ctx.orgId, id });
  return typeof artifact?.spec?.md === 'string' ? artifact.spec.md : null;
}

/**
 * The sibling location pages in this page's batch its draft is too similar
 * to. Empty for any other page, or with no sibling drafted.
 * @param ctx - The turn.
 * @param page - The page under review.
 */
async function siblingDuplicates(ctx: RuntimeContext, page: SeoPageRecord) {
  if (page.meta.pageType !== 'location') {
    return [];
  }
  const own = await markdownOf(ctx, page.meta.draftArtifactId);
  if (!own) {
    return [];
  }
  const siblings = (await listSeoPages(ctx.orgId, page.meta.batchId)).filter(p => p.id !== page.id && p.meta.pageType === 'location' && p.meta.draftArtifactId && p.meta.status !== 'rejected');
  const drafts = await Promise.all(siblings.map(async p => ({ pageId: p.id, keyword: p.meta.keyword, location: p.meta.location, markdown: await markdownOf(ctx, p.meta.draftArtifactId) ?? '' })));
  return nearDuplicates({ pageId: page.id, keyword: page.meta.keyword, location: page.meta.location, markdown: own }, drafts.filter(d => d.markdown));
}

/**
 * Why a page's batch may not be briefed or drafted, or null when its keyword
 * plan is signed off.
 * @param ctx - The turn.
 * @param page - The page.
 */
async function planProblem(ctx: RuntimeContext, page: SeoPageRecord): Promise<string | null> {
  const batch = await getSeoBatch(ctx.orgId, page.meta.batchId);
  if (!batch) {
    return `Not saved: page #${page.id} belongs to no batch.`;
  }
  if (planApproved(batch.meta)) {
    return null;
  }
  const plan = batch.meta.plan!;
  return plan.state === 'revise'
    ? `Not saved: the keyword plan for batch #${batch.id} was sent back${plan.note ? ` ("${plan.note}")` : ''}. Revise it with seo_plan_batch and batch_id ${batch.id}; nothing is briefed or drafted until a person approves it.`
    : `Not saved: the keyword plan for batch #${batch.id} is waiting on a person's sign-off${plan.askId ? ` (ask #${plan.askId})` : ''}. Nothing is briefed or drafted until it is approved.`;
}

/**
 * Why drafting or reviewing may not run here, or null: they run in the
 * background run (`work.ts`), never inside a person's chat turn, where they
 * ran into the turn's spend ceiling mid-review.
 * @param ctx - The turn.
 * @param what - What was attempted.
 */
function backgroundOnly(ctx: RuntimeContext, what: string): string | null {
  return ctx.missionRunId
    ? null
    : `Not ${what}: writing and reviewing run in the background, not in this chat turn. Call seo_start_writing with the batch; it queues the released pages and the person hears progress here.`;
}

function failed(err: unknown): string {
  return err instanceof SeoSetupError ? err.message : `Not saved: ${(err as Error).message}`;
}

/**
 * The seat a step is filed as: the teammate that ran it, else this turn's agent.
 * @param ctx - The turn.
 * @param ran - The stamp of the model that ran the step.
 */
function seat(ctx: RuntimeContext, ran: { agent: string | null } | null): string | null {
  return ran?.agent ?? ctx.agentSlug ?? null;
}

const pageSchema = z.object({
  keyword: z.string().min(1).max(200),
  title: z.string().max(200).optional().describe('A working title; defaults to the keyword.'),
  secondary_keywords: z.array(z.string().max(200)).max(20).optional(),
  intent: z.string().max(60).optional().describe('informational, commercial, transactional or navigational.'),
  volume: z.number().int().nonnegative().nullable().optional().describe('Monthly search volume when keyword_metrics established it; leave out when it did not.'),
  page_type: z.enum(SEO_PAGE_TYPES).optional().describe('location (one city or service area), service, blog, landing or other. The project\'s first sample covers one page of each type.'),
  location: z.string().max(120).optional().describe('For a location page: the city or area it is for, e.g. "Fairview".'),
  cluster: z.string().max(120).optional().describe('The keyword cluster the page belongs to (keyword_cluster).'),
  existing_url: z.string().max(500).optional().describe('The live page this one rewrites, when it is a refresh.'),
  slug: z.string().max(200).optional().describe('The URL slug planned for a new page.'),
  refresh: z.boolean().optional().describe('True when this rewrites a page the client already has (give existing_url).'),
});

type PageInput = z.infer<typeof pageSchema>;

export function seoPlanBatchTool(ctx: RuntimeContext) {
  return tool(
    async (raw, runtime?: ToolCallRuntime) => {
      const args = raw as { project_id?: number; batch_id?: number | string; topic: string; destination?: string; why?: string; pages: unknown };
      const pages = coerceJson(args.pages) as PageInput[];
      if (!Array.isArray(pages) || pages.length === 0) {
        return 'Not planned: name at least one page (its target keyword).';
      }
      const placeless = pages.filter(p => p.page_type === 'location' && !p.location?.trim());
      if (placeless.length > 0) {
        return `Not planned: ${placeless.map(p => `"${p.keyword}"`).join(', ')} ${placeless.length === 1 ? 'is a location page' : 'are location pages'} with no location. Give each the city or service area it is for.`;
      }
      const refreshWithoutUrl = pages.filter(p => p.refresh && !p.existing_url?.trim());
      if (refreshWithoutUrl.length > 0) {
        return `Not planned: ${refreshWithoutUrl.map(p => `"${p.keyword}"`).join(', ')} ${refreshWithoutUrl.length === 1 ? 'is a refresh' : 'are refreshes'} with no existing_url. A refresh names the live page it rewrites.`;
      }
      const input = pages.map(p => ({ keyword: p.keyword, title: p.title, secondaryKeywords: p.secondary_keywords, intent: p.intent, volume: p.volume, pageType: p.page_type as SeoPageType | undefined, location: p.location, cluster: p.cluster, existingUrl: p.existing_url, slug: p.slug, refresh: p.refresh }));
      try {
        const plannedBy = await modelThatRan(ctx, runtime);
        const by = ctx.userId ?? `agent:${seat(ctx, plannedBy) ?? 'unknown'}`;
        if (args.batch_id !== undefined) {
          const ref = await recordIdOf(ctx.orgId, args.batch_id);
          if ('reason' in ref) {
            return `Not planned: ${ref.reason}.`;
          }
          const revised = await revisePlan(ctx.orgId, by, ref.id, { topic: args.topic, destination: args.destination, pages: input, plannedBy });
          if (typeof revised === 'string') {
            return `Not planned: ${revised}`;
          }
          const ask = await fileSeoPlanAsk({ orgId: ctx.orgId, batchId: revised.batch.id, agentSlug: seat(ctx, plannedBy), why: args.why });
          return `Revised the keyword plan for batch #${revised.batch.id} (${revised.pages.length} pages, ${batchHref(revised.batch.id)}) and filed its sign-off${ask ? ` (ask #${ask.askId})` : ''}. Nothing is briefed or drafted until a person approves it.`;
        }
        if (!args.project_id) {
          return 'Not planned: name the client project (project_id), or batch_id to revise a plan that was sent back.';
        }
        const { batch, pages: made } = await planSeoBatch(ctx.orgId, by, { projectId: args.project_id, topic: args.topic, destination: args.destination, pages: input, plannedBy });
        const ask = await fileSeoPlanAsk({ orgId: ctx.orgId, batchId: batch.id, agentSlug: seat(ctx, plannedBy), why: args.why });
        const locations = made.filter(p => p.meta.pageType === 'location').length;
        return [
          `Planned batch #${batch.id} "${batch.title}" with ${made.length} pages (${batchHref(batch.id)}).`,
          `Filed the keyword plan's sign-off for a person${ask ? ` (ask #${ask.askId})` : ''}: the map of keyword, page type, location, intent, cluster and target.`,
          'STOP HERE: brief and draft nothing until they approve it — seo_save_brief and seo_save_draft refuse until then, and you are woken when they answer. Do not file another ask for it. SERP research may go on meanwhile (seo_save_research).',
          locations > 0 ? `${locations} location page${locations === 1 ? '' : 's'}: each is researched on its own city's results (seo_save_research refuses a brief whose query does not name its location) and must carry local substance; the editor's review fails one that is ${Math.round(LOCATION_PAGE_SIMILARITY_LIMIT * 100)}% or more the same as a sibling.` : null,
        ].filter(Boolean).join('\n');
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: 'seo_plan_batch',
      description: 'Plan a batch of SEO pages for one client project: a batch and one proposed page per target keyword, in writing order, each with its page type, location, intent, cluster and whether it refreshes a live page. Files ONE sign-off ask showing the keyword map; then stop: nothing is briefed or drafted until a person approves it, and you are woken when they answer. Refuses a keyword the project already has a page for in another open batch or live, or a URL another page lives at, unless the page is marked `refresh` with the `existing_url` it rewrites. To revise a plan a person sent back, pass batch_id with the whole revised list. Use after the SERP research for the topic (keyword_cluster first, so each page targets one cluster).',
      schema: z.object({
        project_id: z.number().int().positive().optional().describe('The client project (list_projects) the pages are for. Not needed with batch_id.'),
        batch_id: recordIdArg('A batch whose plan was sent back, to revise it').optional(),
        topic: z.string().min(1).max(200).describe('What the batch covers, in a few words, e.g. "Trail running shoes".'),
        destination: z.string().max(120).optional().describe('The project\'s publish target id these pages ship to, when it has one.'),
        why: z.string().max(2000).optional().describe('Why these pages, in a few lines a person reads beside the map.'),
        pages: z.array(pageSchema).min(1).max(200),
      }),
    },
  );
}

export function seoNextPagesTool(ctx: RuntimeContext) {
  return tool(
    async ({ batch_id }) => {
      const ref = await recordIdOf(ctx.orgId, batch_id);
      if ('reason' in ref) {
        return `No such batch: ${ref.reason}.`;
      }
      const read = await readSeoGate(ctx.orgId, ref.id);
      if (!read) {
        return `#${ref.id} is not an SEO batch in this workspace.`;
      }
      const { batch, pages, gate } = read;
      const nextStep = (p: SeoPageRecord) => p.meta.status === 'changes_requested'
        ? 'redraft (read its feedback first)'
        : !p.meta.serpArtifactId ? 'research' : !p.meta.briefArtifactId ? 'brief' : 'draft';
      const writable = pages.filter(p => gate.writable.includes(p.id)).map(p => ({
        id: p.id,
        keyword: p.meta.keyword,
        ...(p.meta.pageType ? { pageType: p.meta.pageType } : {}),
        ...(p.meta.location ? { location: p.meta.location } : {}),
        ...(p.meta.existingUrl ? { refreshes: p.meta.existingUrl } : {}),
        status: p.meta.status,
        next: nextStep(p),
        href: pageHref(p.id),
      }));
      const waiting = pages.filter(p => !gate.writable.includes(p.id) && p.meta.status !== 'rejected' && p.meta.status !== 'approved' && p.meta.status !== 'published');
      const reasons = new Map<string, number[]>();
      for (const p of waiting) {
        const why = !read.planSignedOff ? 'the keyword plan waits on a person\'s sign-off' : whyNotWritable(read.project, p.id) ?? 'it may be written';
        reasons.set(why, [...(reasons.get(why) ?? []), p.id]);
      }
      // The client's own adopted rules from sign-offs, mounted for this
      // project's pages only (`data_room/<id>`-scoped learnings).
      const { objectKnowledge } = await import('@/services/MemoryService');
      const scope = `data_room/${batch.meta.projectId}`;
      const clientRules = (await objectKnowledge(ctx.orgId, [scope]).catch(() => new Map<string, string[]>())).get(scope) ?? [];
      return JSON.stringify({
        batch: { id: batch.id, title: batch.title, href: batchHref(batch.id), project: seoProjectHref(batch.meta.projectId), plan: batch.meta.plan?.state ?? 'approved' },
        gate: { stage: gate.stage, line: gate.line, released: gate.allowed, written: gate.written, approved: gate.approved, total: gate.total },
        writeNow: writable,
        waiting: [...reasons.entries()].map(([why, ids]) => ({ why, pages: ids.length, ids: ids.slice(0, 20) })),
        ...(clientRules.length > 0 ? { clientRulesFromSignoffs: clientRules } : {}),
      });
    },
    {
      name: 'seo_next_pages',
      description: 'What the project\'s volume gate lets be written in a batch right now — each page with its next step (research, brief, draft, redraft) — and, for the rest, why they wait (the keyword plan or the project\'s sample has not been signed off, feedback has not been filed, a page is waiting on a person), plus the rules this client adopted from sign-offs. Call before writing or reviewing anything in a batch, and again after each sign-off.',
      schema: z.object({ batch_id: recordIdArg('The batch') }),
    },
  );
}

export function seoStartWritingTool(ctx: RuntimeContext) {
  return tool(
    async ({ batch_id }) => {
      const ref = await recordIdOf(ctx.orgId, batch_id);
      if ('reason' in ref) {
        return `No such batch: ${ref.reason}.`;
      }
      const read = await readSeoGate(ctx.orgId, ref.id);
      if (!read) {
        return `#${ref.id} is not an SEO batch in this workspace.`;
      }
      if (!read.planSignedOff) {
        return `Nothing queued: batch #${ref.id}'s keyword plan waits on a person's sign-off. Say so; it starts when they approve it.`;
      }
      if (read.gate.writable.length === 0) {
        return `Nothing to write now in batch #${ref.id}: ${read.gate.line}.`;
      }
      await followFrom(ctx.orgId, ref.id, ctx.conversationId);
      const queued = await queueSeoWork(ctx.orgId, 'write', { batchId: ref.id, projectId: read.batch.meta.projectId, writable: read.gate.writable.length, line: read.gate.line }, `write:${ref.id}:${read.gate.writable.join(',')}:${new Date().toISOString().slice(0, 16)}`);
      if (!queued) {
        return `Not queued: the background run for batch #${ref.id} could not be started. Say so plainly; nothing was written.`;
      }
      return `Queued ${read.gate.writable.length} ${read.gate.writable.length === 1 ? 'page' : 'pages'} of batch #${ref.id} for the background run: research, brief, draft and the editor's review, each with its own sign-off for the person. It runs outside this turn on the SEO team's budget; progress shows on the batch (${batchHref(ref.id)}) and here. Tell the person what is running and stop.`;
    },
    {
      name: 'seo_start_writing',
      description: 'Start writing the pages the project\'s gate has released in a batch, in the BACKGROUND: the writer drafts and the editor reviews each page, sending drafts back with findings for up to three rounds, and each passed page\'s sign-off is filed for the person. Drafting never runs inside a chat turn; call this instead, tell the person what is running, and stop.',
      schema: z.object({ batch_id: recordIdArg('The batch') }),
    },
  );
}

export function seoSaveResearchTool(ctx: RuntimeContext) {
  return tool(
    async ({ page_id, serp_artifact_id }) => {
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      const bad = await serpBriefProblem(ctx, serp_artifact_id, page) ?? await artifactArg(ctx, serp_artifact_id, page, 'serp', 'SERP brief');
      if (bad) {
        return bad;
      }
      const status = page.meta.status === 'proposed' ? 'researched' : page.meta.status;
      await patchSeoPage(ctx.orgId, page, { serpArtifactId: serp_artifact_id, status });
      await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      return `SERP brief ${artifactLink(serp_artifact_id)} is on page #${page.id} "${page.meta.keyword}" (${status}). Next: the page brief (seo_save_brief), once the keyword plan is signed off.`;
    },
    {
      name: 'seo_save_research',
      description: 'Attach the SERP brief serp_compare filed (folder seo/serp), with its synthesis written in, to an SEO page. One brief can serve several pages of the same topic, except location pages: a location page needs its own brief, read for a query that names its city. Refuses a brief built on web search results rather than Google\'s ranking. Moves a proposed page to researched.',
      schema: z.object({ page_id: recordIdArg('The SEO page'), serp_artifact_id: z.number().int().positive().describe('The SERP brief artifact id serp_compare returned (briefArtifactId)') }),
    },
  );
}

export function seoSaveBriefTool(ctx: RuntimeContext) {
  return tool(
    async ({ page_id, brief_artifact_id }, runtime?: ToolCallRuntime) => {
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      const held = await planProblem(ctx, page);
      if (held) {
        return held;
      }
      const bad = await localSubstanceProblem(ctx, brief_artifact_id, page) ?? await artifactArg(ctx, brief_artifact_id, page, 'brief', 'page brief');
      if (bad) {
        return bad;
      }
      const ran = await modelThatRan(ctx, runtime);
      const status = page.meta.status === 'proposed' || page.meta.status === 'researched' ? 'briefed' : page.meta.status;
      await patchSeoPage(ctx.orgId, page, { briefArtifactId: brief_artifact_id, status, ...(ran ? { models: { plan: ran } } : {}) });
      await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      const read = await readSeoGate(ctx.orgId, page.meta.batchId);
      const why = read ? whyNotWritable(read.project, page.id) : null;
      return `Brief ${artifactLink(brief_artifact_id)} is on page #${page.id} "${page.meta.keyword}"${ran ? `, planned on ${ran.name}` : ''}. ${why ? `It cannot be drafted yet: ${why}.` : 'It may be drafted now (seo_save_draft).'}`;
    },
    {
      name: 'seo_save_brief',
      description: 'Attach the page brief (a markdown artifact: search intent, the outline, what the top results cover and miss, the client rules that apply, internal links, the meta title, description and slug) to an SEO page. A location page\'s brief must have a "Local substance" section: what is true of that place for this client (projects, reviews, service-area facts), so the page is not a sibling with the city swapped. Refused while the batch\'s keyword plan waits on a person. Records the model that planned it.',
      schema: z.object({ page_id: recordIdArg('The SEO page'), brief_artifact_id: z.number().int().positive() }),
    },
  );
}

export function seoSaveDraftTool(ctx: RuntimeContext) {
  return tool(
    async (raw, runtime?: ToolCallRuntime) => {
      const { page_id, draft_artifact_id, meta_title, meta_description, slug } = raw as { page_id: number | string; draft_artifact_id: number; meta_title?: string; meta_description?: string; slug?: string };
      const elsewhere = backgroundOnly(ctx, 'saved');
      if (elsewhere) {
        return elsewhere;
      }
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      const held = await planProblem(ctx, page);
      if (held) {
        return held;
      }
      // THE GATE, in code — the project's. A page past the sample, or any
      // page while feedback anywhere in the project waits to be filed, is
      // refused here whatever the prompt said.
      const read = await readSeoGate(ctx.orgId, page.meta.batchId);
      if (!read) {
        return `Not saved: page #${page.id} belongs to no batch.`;
      }
      const why = whyNotWritable(read.project, page.id);
      if (why) {
        return `Not saved: page #${page.id} "${page.meta.keyword}" is not released — ${why}. Gate: ${read.gate.line}.`;
      }
      if (!page.meta.briefArtifactId) {
        return `Not saved: page #${page.id} has no brief. Write the brief first (seo_save_brief); the draft is written from it.`;
      }
      // The meta lives on the page, checked here; the body carries none.
      // The slug is the page's own (planned, F2's `slug`), checked here with
      // the meta: unique by path within the project.
      const taken = new Set((await listProjectSeoPages(ctx.orgId, page.meta.projectId)).filter(p => p.id !== page.id && p.meta.status !== 'rejected' && p.meta.slug).map(p => pathKey(p.meta.slug!)));
      const meta = checkPageMeta({ metaTitle: meta_title, metaDescription: meta_description, slug }, page.meta, taken);
      if (!meta.value) {
        return `Not saved: page #${page.id}'s meta does not pass — ${meta.problems.join('; ')}. Pass meta_title (at most 60 characters), meta_description (at most 155) and slug (kebab-case, unique in the project; the planned slug stands when you leave it out) with the draft.`;
      }
      const bad = await artifactArg(ctx, draft_artifact_id, page, 'draft', 'draft');
      if (bad) {
        return bad;
      }
      const ran = await modelThatRan(ctx, runtime);
      // A redraft makes any open ask about an earlier round moot.
      await withdrawPageAsks(ctx.orgId, page.id, 'The page was redrafted; the new draft gets its own sign-off.');
      const saved = await patchSeoPage(ctx.orgId, page, current => ({
        draftArtifactId: draft_artifact_id,
        draftRound: (current.draftRound ?? 0) + 1,
        status: 'in_review',
        signoff: undefined,
        signoffAsk: undefined,
        review: undefined,
        ...meta.value!,
        ...(ran ? { models: { write: ran } } : {}),
      }));
      const gate = await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      return [
        `Draft ${artifactLink(draft_artifact_id)} (round ${saved.meta.draftRound}) is on page #${page.id} "${page.meta.keyword}"${ran ? `, written on ${ran.name}${ran.source === 'configured' ? ' (the seat\'s configured model; no call logged)' : ''}` : ''}, with its meta title, description and slug /${meta.value.slug}.`,
        meta.warnings.length > 0 ? `Note: ${meta.warnings.join('; ')}.` : null,
        'Next: the editor checks it against the project\'s rules, brand, guidelines and the SERP brief (seo_save_review) before a person sees it.',
        gate ? `Gate: ${gate.line}.` : null,
      ].filter(Boolean).join(' ');
    },
    {
      name: 'seo_save_draft',
      description: 'Attach a written draft (a markdown artifact, the page body only) to an SEO page with its meta title, meta description and slug, and send it to review. Refuses a page whose keyword plan is not signed off, a page the project\'s gate has not released (past the sample or tranche, or while feedback anywhere in the project waits to be filed), a page with no brief, and meta that does not pass. Records the model that wrote it.',
      schema: z.object({
        page_id: recordIdArg('The SEO page'),
        draft_artifact_id: z.number().int().positive(),
        meta_title: z.string().max(200).optional().describe('At most 60 characters. Required on the first draft; a redraft keeps the page\'s when left out.'),
        meta_description: z.string().max(400).optional().describe('At most 155 characters.'),
        slug: z.string().max(200).optional().describe('kebab-case, e.g. trail-running-shoes; unique within the project.'),
      }),
    },
  );
}

/** Notes longer than this are kept whole as an artifact linked from the page; the page keeps the start. */
const REVIEW_NOTES_ON_PAGE = 4000;

export function seoSaveReviewTool(ctx: RuntimeContext) {
  return tool(
    async (raw, runtime?: ToolCallRuntime) => {
      const { page_id, verdict } = raw as { page_id: number | string; verdict: 'pass' | 'fix'; notes?: string; findings?: unknown };
      const elsewhere = backgroundOnly(ctx, 'recorded');
      if (elsewhere) {
        return elsewhere;
      }
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      if (!page.meta.draftArtifactId || page.meta.status !== 'in_review') {
        return `Not recorded: page #${page.id} has no draft in review (status ${page.meta.status}).`;
      }
      // The client's banned words and never-claim words, in code
      // (`services/seo/voiceCheck.ts`): a draft with one goes back whatever
      // the verdict, each finding quoting the line and where the client said it.
      const voice = await draftVoiceFindings(ctx.orgId, page);
      const voiceNote = voice.length ? `The draft breaks the client's voice block:\n${describeVoiceFindings(voice)}` : null;
      const ran = await modelThatRan(ctx, runtime);
      const at = new Date().toISOString();
      // Doorway pages, in code: a location page that is a sibling with the
      // city swapped fails, whatever verdict the editor gave.
      const dupes = await siblingDuplicates(ctx, page);
      const dupeNote = dupes.length
        ? `Too similar to ${dupes.map(d => `page #${d.pageId} "${d.keyword}" (${Math.round(d.similarity * 100)}% the same once city names are masked)`).join(', ')}; the limit is ${Math.round(LOCATION_PAGE_SIMILARITY_LIMIT * 100)}%. Rewrite it around what is true of ${page.meta.location ?? 'this place'}: the brief's local substance, local projects and reviews, service-area facts.`
        : null;
      const finalVerdict: 'pass' | 'fix' = dupeNote || voiceNote ? 'fix' : verdict;
      const voiceFindings = voice.map(f => ({ issue: f.kind === 'banned' ? `Uses "${f.phrase}", which the client never uses (${f.line.source})` : `"${f.phrase}" makes a claim the client may not make: "${f.line.text}" (${f.line.source})`, location: f.excerpt, fix: f.kind === 'banned' ? `Remove "${f.phrase}".` : 'Take the claim out.' }));
      const findings = [...voiceFindings, ...(dupeNote ? [{ issue: dupeNote.slice(0, 600), location: 'whole page' }] : []), ...normaliseFindings(coerceJson(raw.findings))];
      const notes = [voiceNote, dupeNote, (raw.notes ?? '').trim()].filter(Boolean).join('\n\n') || (findings.length ? findingsMd(findings) : 'Checked.');
      // A review is never lost to its length: past the page's share, the
      // whole review is an artifact linked from the page.
      let notesArtifactId: number | undefined;
      if (notes.length > REVIEW_NOTES_ON_PAGE || findings.length > 0) {
        const { artifact } = await createArtifact({
          orgId: ctx.orgId,
          kind: 'markdown',
          title: `Review: ${page.title} (round ${page.meta.draftRound ?? 1})`,
          spec: { md: [`# Review: ${page.title}`, `Verdict: **${finalVerdict}**`, findings.length ? `## Findings\n\n${findingsMd(findings)}` : null, `## Notes\n\n${notes}`].filter(Boolean).join('\n\n') },
          folder: 'seo/reviews',
          author: { kind: 'agent', id: `agent:${seat(ctx, ran) ?? 'seo-editor'}` },
          record: { type: 'object', id: String(page.id), role: 'review' },
        }).catch(() => ({ artifact: null }));
        notesArtifactId = artifact?.id;
      }
      const rounds = (page.meta.editorRounds ?? 0) + (finalVerdict === 'fix' ? 1 : 0);
      const exhausted = finalVerdict === 'fix' && rounds >= SEO_EDITOR_ROUNDS;
      const reviewed = await patchSeoPage(ctx.orgId, page, {
        review: {
          verdict: finalVerdict,
          notes: notes.length > REVIEW_NOTES_ON_PAGE ? `${notes.slice(0, REVIEW_NOTES_ON_PAGE - 80).trimEnd()}… (the whole review: /dashboard/artifacts/${notesArtifactId ?? ''})` : notes,
          at,
          ...(findings.length ? { findings } : {}),
          ...(notesArtifactId ? { notesArtifactId } : {}),
          ...(dupes.length ? { similarTo: dupes.map(d => ({ pageId: d.pageId, similarity: d.similarity })) } : {}),
        },
        editorRounds: rounds,
        ...(finalVerdict === 'fix' && !exhausted ? { status: 'drafting' as const } : {}),
        ...(ran ? { models: { review: ran } } : {}),
      });
      if (finalVerdict === 'fix' && !exhausted) {
        // A later review supersedes any sign-off still open for this page,
        // and the writer's revision is queued in code with the findings.
        await withdrawPageAsks(ctx.orgId, page.id, 'The editor sent this draft back to the writer.');
        const gate = await refreshSeoBatch(ctx.orgId, page.meta.batchId);
        await queueSeoWork(ctx.orgId, 'revise', { batchId: page.meta.batchId, projectId: page.meta.projectId, pageId: page.id, round: rounds, of: SEO_EDITOR_ROUNDS, findings: findingsMd(findings.length ? findings : [{ issue: notes.slice(0, 600) }]), ...(notesArtifactId ? { review: `/dashboard/artifacts/${notesArtifactId}` } : {}), line: gate?.line ?? null }, `revise:${page.id}:${page.meta.draftRound ?? 1}:${rounds}`);
        return [
          voiceNote && verdict === 'pass' ? `Not passed: ${voiceNote}\n` : voiceNote ? `${voiceNote}\n` : null,
          dupeNote && verdict === 'pass' ? `Not passed: ${dupeNote}` : dupeNote,
          `Sent back to the writer (round ${rounds} of ${SEO_EDITOR_ROUNDS}): page #${page.id} is drafting again, and the writer's revision with your findings is queued, then your review again. Nothing reached a person.`,
        ].filter(Boolean).join(' ');
      }
      // THE SIGN-OFF, filed here in code — the right ref, the draft and the
      // page as its records, bound to the words it shows. After the last
      // round it is filed anyway, with the findings still open, so the
      // person decides.
      const ask = await fileSeoSignoffAsk({ orgId: ctx.orgId, page: reviewed, agentSlug: seat(ctx, ran), notes, ...(exhausted ? { openFindings: findings.length ? findings : [{ issue: notes.slice(0, 600) }] } : {}) });
      await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      if (!ask) {
        return `Review recorded on page #${page.id}, but its sign-off could not be filed: draft #${page.meta.draftArtifactId} is gone. Save the draft again (seo_save_draft).`;
      }
      return exhausted
        ? `The editor's ${SEO_EDITOR_ROUNDS} rounds on page #${page.id} are used up, so its sign-off is filed for the person with the open findings shown (ask #${ask.askId}); they decide. Do not send it back again.`
        : `Review recorded on page #${page.id}${ran ? ` (${ran.name})` : ''}, and its sign-off is filed for a person (ask #${ask.askId}, ${ask.sourceRef}). Do not file another ask for it; the answer moves the page and the gate on its own, and the strategist picks the work up after it.`;
    },
    {
      name: 'seo_save_review',
      description: `The editor's verdict on an SEO draft, checked against the project's rules, brand, guidelines and the SERP brief: \`pass\` files the page's sign-off for a person itself; \`fix\` sends it back to the writer with your findings and queues the revision and your next review in code, at most ${SEO_EDITOR_ROUNDS} rounds, after which the sign-off is filed with the open findings for the person to decide. Give findings as a list of { issue, location, fix }; a long review is kept whole, never refused. A draft with one of the client's banned phrases or never-claim words (the voice block, checked in code) is sent back whatever the verdict, each one a finding. A location page whose draft is 70% or more the same as a sibling location page in the batch (city names masked) is sent back whatever the verdict. Records the model that reviewed it.`,
      schema: z.object({
        page_id: recordIdArg('The SEO page'),
        verdict: z.enum(['pass', 'fix']),
        findings: z.array(z.object({
          issue: z.string().describe('What is wrong, quoting the rule, guideline or SERP fact it is about.'),
          location: z.string().optional().describe('Where in the draft: the heading or the sentence.'),
          fix: z.string().optional().describe('What the writer should do.'),
        })).optional().describe('Each finding on its own; required with fix.'),
        notes: z.string().optional().describe('What was checked, in a few lines. Any length; a long review is kept whole as an artifact linked from the page.'),
      }),
    },
  );
}

/**
 * File a note on the learning step in code: a candidate a person adopts at
 * /dashboard/learnings. A client's note is scoped to its project, so once
 * adopted it mounts for that project's pages only.
 * @param ctx - The turn.
 * @param page - The page the note is about.
 * @param text - The rule as proposed.
 * @param note - The person's words.
 * @param scope - Whose it is.
 */
async function fileToLearning(ctx: RuntimeContext, page: SeoPageRecord, text: string, note: string, scope: 'client' | 'general' | undefined): Promise<SeoFeedback['filedRef'] | string> {
  const { recordProposedRule } = await import('@/services/feedback/ruleRecorder');
  const res = await recordProposedRule({
    orgId: ctx.orgId,
    ruleText: text,
    polarity: 'correct',
    stepName: SEO_LEARNING_STEP,
    ...(scope === 'client' ? { scopeKind: 'object' as const, scopeRef: `data_room/${page.meta.projectId}` } : {}),
    note,
    agentSlug: ctx.agentSlug ?? null,
    submittedBy: ctx.userId ?? null,
    sourceRef: `seo-page:${page.id}:project:${page.meta.projectId}`,
  });
  if (res.outcome === 'created') {
    return { candidateId: res.candidateId };
  }
  if (res.outcome === 'duplicate') {
    return res.matched.kind === 'candidate' ? { candidateId: Number(res.matched.id) } : { memoryKey: String(res.matched.id) };
  }
  return `the learning step ${SEO_LEARNING_STEP} could not take it (${res.reason})`;
}

export function seoRecordFeedbackTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { page_id: number | string; note: string; scope?: 'client' | 'general'; filed_to?: string; filed_text?: string; requests_changes?: boolean };
      const page = await pageArg(ctx, args.page_id);
      if (typeof page === 'string') {
        return page;
      }
      const note = args.note.trim();
      const filedTo = args.filed_to?.trim() || null;
      const filedText = args.filed_text?.trim() || '';
      const ownProject = `project:${page.meta.projectId}`;
      const learning = `learning:${SEO_LEARNING_STEP}`;
      let filedRef: SeoFeedback['filedRef'] | undefined;
      if (filedTo) {
        if (filedTo !== ownProject && filedTo !== learning) {
          return /^project:\d+$/.test(filedTo)
            ? `Not recorded: page #${page.id} belongs to project ${page.meta.projectId}${page.meta.projectName ? ` (${page.meta.projectName})` : ''}, not ${filedTo.slice('project:'.length)}. A client's note goes to the page's own project: update_project with project_id ${page.meta.projectId}.`
            : `Not recorded: filed_to is \`${ownProject}\` (this client's rules or notes, after update_project with project_id ${page.meta.projectId}) or \`${learning}\` (craft for every writer, filed here as a candidate rule).`;
        }
        if (!filedText) {
          return 'Not recorded: name filed_text, the words as filed (the rule line or the notes passage on the project, or the rule to propose), so the filing can be checked.';
        }
        if (filedTo === ownProject) {
          const project = await readSeoProject(ctx.orgId, page.meta.projectId);
          const check = await feedbackCheck(ctx.orgId, [{ ...page, meta: { ...page.meta, feedback: [{ at: '', by: null, note, filedTo, filedText }] } }]);
          if (!project || !check({ at: '', by: null, note, filedTo, filedText }, page.meta)) {
            return `Not recorded as filed: "${filedText.slice(0, 120)}" is not on project ${page.meta.projectId}'s rules or notes. File it first with update_project (project_id ${page.meta.projectId}; add_rules for a checkable rule, append_notes for anything longer), then call this again with the same filed_text.`;
          }
        } else {
          const filed = await fileToLearning(ctx, page, filedText, note, args.scope);
          if (typeof filed === 'string') {
            return `Not recorded as filed: ${filed}.`;
          }
          filedRef = filed;
        }
      }
      const by = ctx.userId ?? (ctx.agentSlug ? `agent:${ctx.agentSlug}` : null);
      const sendBack = args.requests_changes === true && page.meta.status !== 'changes_requested';
      const saved = await patchSeoPage(ctx.orgId, page, (current) => {
        const feedback: SeoFeedback[] = [...(current.feedback ?? [])];
        const same = feedback.findIndex(f => f.note.trim() === note);
        const filing = filedTo ? { filedTo, filedText, ...(filedRef ? { filedRef } : {}) } : {};
        if (same >= 0) {
          feedback[same] = { ...feedback[same]!, ...(args.scope ? { scope: args.scope } : {}), ...filing };
        } else {
          feedback.push({ at: new Date().toISOString(), by, note, ...(args.scope ? { scope: args.scope } : {}), filedTo: null, ...filing, ...(current.draftArtifactId ? { draftArtifactId: current.draftArtifactId } : {}) });
        }
        return { feedback, ...(sendBack ? { status: 'changes_requested' as const, signoff: undefined } : {}) };
      });
      if (sendBack) {
        await withdrawPageAsks(ctx.orgId, page.id, 'A person asked for changes in words.');
      }
      const gate = await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      const unfiled = (saved.meta.feedback ?? []).filter(f => !f.filedTo).length;
      return [
        `Feedback on page #${page.id} recorded${args.scope ? ` as ${args.scope}` : ''}${filedTo ? `, filed to ${filedTo}${filedRef?.candidateId ? ` (candidate #${filedRef.candidateId}, for a person to adopt at /dashboard/learnings)` : ''}` : ''}.`,
        unfiled > 0 ? `${unfiled} note${unfiled === 1 ? '' : 's'} on this page still say nowhere they were filed: a client note goes to update_project with project_id ${page.meta.projectId}, then here with filed_to ${ownProject} and filed_text; a craft note comes here with filed_to ${learning} and the rule as filed_text.` : 'Every note on this page says where it went.',
        gate ? `Gate: ${gate.line}.` : null,
      ].filter(Boolean).join(' ');
    },
    {
      name: 'seo_record_feedback',
      description: 'Record a person\'s feedback on an SEO page, its scope (client: true of this client only; general: craft for every client) and where it was filed. filed_to is `project:<the page\'s own project id>` after update_project put filed_text on that project\'s rules or notes (checked here), or `learning:seo-feedback`, which files filed_text as a candidate rule (a client\'s scoped to its project). The project\'s gate holds new drafts until every note on a sent-back page is verifiably filed. `requests_changes: true` when the person asked for changes in words rather than on the sign-off card.',
      schema: z.object({
        page_id: recordIdArg('The SEO page'),
        note: z.string().min(1).max(4000).describe('The person\'s words (for an existing note, the same text, to update its scope or filing).'),
        scope: z.enum(['client', 'general']).optional(),
        filed_to: z.string().max(200).optional(),
        filed_text: z.string().max(2000).optional().describe('The words as filed: the rule line or notes passage on the project, or the rule to propose to the learning step.'),
        requests_changes: z.boolean().optional(),
      }),
    },
  );
}

/**
 * The SEO app's tool set.
 * @param ctx - The turn.
 */
export function seoTools(ctx: RuntimeContext) {
  return [
    seoPlanBatchTool(ctx),
    seoNextPagesTool(ctx),
    seoStartWritingTool(ctx),
    seoSaveResearchTool(ctx),
    seoSaveBriefTool(ctx),
    seoSaveDraftTool(ctx),
    seoSaveReviewTool(ctx),
    seoRecordFeedbackTool(ctx),
  ];
}
