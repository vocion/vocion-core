/**
 * The SEO app's tools — present while the `seo` plugin is on.
 *
 *   seo_plan_batch       a batch and its proposed pages, for one project
 *   seo_next_pages       what the volume gate lets be written now, and why the rest wait
 *   seo_save_research    the SERP brief artifact on a page; a location page's must be its own city's read
 *   seo_save_brief       the page brief artifact on a page
 *   seo_save_draft       the draft on a page; REFUSES a page the gate has not released
 *   seo_save_review      the editor's verdict on a draft, and the sign-off ask to file;
 *                        FAILS a location page that is a sibling with the city swapped
 *   seo_record_feedback  a note on a page, its scope, and where it was filed
 *
 * The gate is code (`services/seo/gate.ts`), not a prompt: these tools are the
 * only path that attaches a draft, and they read the gate before they write.
 * Each step records the model that actually ran it (`modelThatRan.ts`) on the
 * page, so the batch page can say "Written by Opus 5.5" and mean it.
 *
 * The tools take `project_id` (a Project, internally a `data_room` record)
 * and reach it through `services/seo/projects.ts`.
 */

import type { RuntimeContext } from '../types';
import type { SeoFeedback, SeoPageRecord } from '@/services/seo/records';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { SERP_BRIEF_FOLDER, serpBriefMeta, SYNTHESIS_END, SYNTHESIS_START } from '@/libs/tools/serp/brief';
import { anchorArtifact, getArtifact } from '@/services/ArtifactService';
import { LOCATION_PAGE_SIMILARITY_LIMIT, nearDuplicates, queryNamesLocation } from '@/services/seo/duplicates';
import { whyNotWritable } from '@/services/seo/gate';
import { modelThatRan } from '@/services/seo/modelThatRan';
import { readSeoProject, seoProjectHref } from '@/services/seo/projects';
import { getSeoPage, listSeoPages, patchSeoPage, planSeoBatch, readSeoGate, refreshSeoBatch, SEO_PAGE_TYPES, SeoSetupError } from '@/services/seo/records';
import { seoSignoffRef } from '@/services/seo/signoff';
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

function failed(err: unknown): string {
  return err instanceof SeoSetupError ? err.message : `Not saved: ${(err as Error).message}`;
}

type PlanArgPage = {
  keyword: string;
  title?: string;
  secondary_keywords?: string[];
  intent?: string;
  volume?: number | null;
  page_type?: (typeof SEO_PAGE_TYPES)[number];
  location?: string;
  existing_url?: string;
  slug?: string;
  refresh?: boolean;
};

export function seoPlanBatchTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { project_id: number; topic: string; destination?: string; pages: unknown };
      const pages = coerceJson(args.pages) as PlanArgPage[];
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
      try {
        const plannedBy = await modelThatRan(ctx);
        const { batch, pages: made, gate } = await planSeoBatch(ctx.orgId, ctx.userId ?? `agent:${ctx.agentSlug ?? 'unknown'}`, {
          projectId: args.project_id,
          topic: args.topic,
          destination: args.destination,
          pages: pages.map(p => ({
            keyword: p.keyword,
            title: p.title,
            secondaryKeywords: p.secondary_keywords,
            intent: p.intent,
            volume: p.volume,
            pageType: p.page_type,
            location: p.location,
            existingUrl: p.existing_url,
            slug: p.slug,
            refresh: p.refresh,
          })),
          plannedBy,
        });
        const locations = made.filter(p => p.meta.pageType === 'location').length;
        return [
          `Planned batch #${batch.id} "${batch.title}" with ${made.length} pages (${batchHref(batch.id)}).`,
          `Gate: ${gate.line}. Sizes come from the project (seoGate), never from a prompt.`,
          `Released now: ${gate.released.map(id => `#${id}`).join(', ') || 'none'}. Research and brief those first (seo_next_pages says what each needs).`,
          locations > 0 ? `${locations} location page${locations === 1 ? '' : 's'}: each is researched on its own city's results (seo_save_research refuses a brief whose query does not name its location) and must carry local substance; the editor's review fails one that is ${Math.round(LOCATION_PAGE_SIMILARITY_LIMIT * 100)}% or more the same as a sibling.` : null,
        ].filter(Boolean).join('\n');
      } catch (err) {
        return failed(err);
      }
    },
    {
      name: 'seo_plan_batch',
      description: 'Plan a batch of SEO pages for one client project: a batch record and one proposed page record per target keyword, in the order they should be written (the first ones become the sample a person reviews before anything else is drafted). Use after the SERP research for the topic (keyword_cluster first, so each page targets one cluster), with the keywords you chose and why. Refuses a keyword the project already has a page for in another open batch or live, or a URL another page lives at, unless the page is marked `refresh` with the `existing_url` it rewrites. Returns the batch link and the gate line.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client project (list_projects) the pages are for.'),
        topic: z.string().min(1).max(200).describe('What the batch covers, in a few words, e.g. "Water heater service".'),
        destination: z.string().max(120).optional().describe('The project\'s publish target id these pages ship to, when it has one.'),
        pages: z.array(z.object({
          keyword: z.string().min(1).max(200),
          title: z.string().max(200).optional().describe('A working title; defaults to the keyword.'),
          secondary_keywords: z.array(z.string().max(200)).max(20).optional().describe('The rest of the keyword\'s cluster (keyword_cluster).'),
          intent: z.string().max(60).optional().describe('informational, commercial, transactional or navigational.'),
          volume: z.number().int().nonnegative().nullable().optional().describe('Monthly search volume when keyword_metrics established it; leave out when it did not.'),
          page_type: z.enum(SEO_PAGE_TYPES).optional().describe('location (one city or service area), service, blog, landing or other.'),
          location: z.string().max(120).optional().describe('For a location page: the city or area it is for, e.g. "Fairview".'),
          existing_url: z.string().max(500).optional().describe('The live page this one rewrites, when it is a refresh.'),
          slug: z.string().max(200).optional().describe('The URL slug planned for a new page.'),
          refresh: z.boolean().optional().describe('True when this rewrites a page the client already has (give existing_url).'),
        })).min(1).max(200),
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
        const why = whyNotWritable(gate, p.id) ?? 'it may be written';
        reasons.set(why, [...(reasons.get(why) ?? []), p.id]);
      }
      return JSON.stringify({
        batch: { id: batch.id, title: batch.title, href: batchHref(batch.id), project: seoProjectHref(batch.meta.projectId) },
        gate: { stage: gate.stage, line: gate.line, released: gate.allowed, written: gate.written, approved: gate.approved, total: gate.total },
        writeNow: writable,
        waiting: [...reasons.entries()].map(([why, ids]) => ({ why, pages: ids.length, ids: ids.slice(0, 20) })),
      });
    },
    {
      name: 'seo_next_pages',
      description: 'What the volume gate lets be written in a batch right now — each page with its next step (research, brief, draft, redraft) — and, for the rest, why they wait (the sample has not been signed off, feedback has not been filed, a page is waiting on a person). Call before writing anything in a batch, and again after each sign-off.',
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
      return `SERP brief ${artifactLink(serp_artifact_id)} is on page #${page.id} "${page.meta.keyword}" (${status}). Next: the page brief (seo_save_brief).`;
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
    async ({ page_id, brief_artifact_id }) => {
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      const bad = await localSubstanceProblem(ctx, brief_artifact_id, page) ?? await artifactArg(ctx, brief_artifact_id, page, 'brief', 'page brief');
      if (bad) {
        return bad;
      }
      const ran = await modelThatRan(ctx);
      const status = page.meta.status === 'proposed' || page.meta.status === 'researched' ? 'briefed' : page.meta.status;
      await patchSeoPage(ctx.orgId, page, { briefArtifactId: brief_artifact_id, status, ...(ran ? { models: { plan: ran } } : {}) });
      const gate = await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      const why = gate ? whyNotWritable(gate, page.id) : null;
      return `Brief ${artifactLink(brief_artifact_id)} is on page #${page.id} "${page.meta.keyword}"${ran ? `, planned on ${ran.name}` : ''}. ${why ? `It cannot be drafted yet: ${why}.` : 'It may be drafted now (seo_save_draft).'}`;
    },
    {
      name: 'seo_save_brief',
      description: 'Attach the page brief (a markdown artifact: search intent, the outline, what the top results cover and miss, the client rules that apply, internal links, the meta title and description) to an SEO page. A location page\'s brief must have a "Local substance" section: what is true of that place for this client (projects, reviews, service-area facts), so the page is not a sibling with the city swapped. Records the model that planned it.',
      schema: z.object({ page_id: recordIdArg('The SEO page'), brief_artifact_id: z.number().int().positive() }),
    },
  );
}

export function seoSaveDraftTool(ctx: RuntimeContext) {
  return tool(
    async ({ page_id, draft_artifact_id }) => {
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      // THE GATE, in code. A page past the sample, or any page while feedback
      // waits to be filed, is refused here whatever the prompt said.
      const read = await readSeoGate(ctx.orgId, page.meta.batchId);
      if (!read) {
        return `Not saved: page #${page.id} belongs to no batch.`;
      }
      const why = whyNotWritable(read.gate, page.id);
      if (why) {
        return `Not saved: page #${page.id} "${page.meta.keyword}" is not released — ${why}. Gate: ${read.gate.line}.`;
      }
      if (!page.meta.briefArtifactId) {
        return `Not saved: page #${page.id} has no brief. Write the brief first (seo_save_brief); the draft is written from it.`;
      }
      const bad = await artifactArg(ctx, draft_artifact_id, page, 'draft', 'draft');
      if (bad) {
        return bad;
      }
      const ran = await modelThatRan(ctx);
      const round = (page.meta.draftRound ?? 0) + 1;
      await patchSeoPage(ctx.orgId, page, {
        draftArtifactId: draft_artifact_id,
        draftRound: round,
        status: 'in_review',
        signoff: undefined,
        review: undefined,
        ...(ran ? { models: { write: ran } } : {}),
      });
      const gate = await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      return [
        `Draft ${artifactLink(draft_artifact_id)} (round ${round}) is on page #${page.id} "${page.meta.keyword}"${ran ? `, written on ${ran.name}${ran.source === 'configured' ? ' (the seat\'s configured model; no call filed yet)' : ''}` : ''}.`,
        'Next: the editor checks it against the project\'s rules, brand, guidelines and the SERP brief (seo_save_review) before a person sees it.',
        gate ? `Gate: ${gate.line}.` : null,
      ].filter(Boolean).join(' ');
    },
    {
      name: 'seo_save_draft',
      description: 'Attach a written draft (a markdown artifact) to an SEO page and send it to review. Refuses a page the volume gate has not released (past the sample or tranche, or while feedback on another page waits to be filed) and a page with no brief. Records the model that wrote it.',
      schema: z.object({ page_id: recordIdArg('The SEO page'), draft_artifact_id: z.number().int().positive() }),
    },
  );
}

export function seoSaveReviewTool(ctx: RuntimeContext) {
  return tool(
    async ({ page_id, verdict, notes }) => {
      const page = await pageArg(ctx, page_id);
      if (typeof page === 'string') {
        return page;
      }
      if (!page.meta.draftArtifactId || page.meta.status !== 'in_review') {
        return `Not recorded: page #${page.id} has no draft in review (status ${page.meta.status}).`;
      }
      const ran = await modelThatRan(ctx);
      const at = new Date().toISOString();
      // Doorway pages, in code: a location page that is a sibling with the
      // city swapped fails, whatever verdict the editor gave.
      const dupes = await siblingDuplicates(ctx, page);
      const dupeNote = dupes.length
        ? `Too similar to ${dupes.map(d => `page #${d.pageId} "${d.keyword}" (${Math.round(d.similarity * 100)}% the same once city names are masked)`).join(', ')}; the limit is ${Math.round(LOCATION_PAGE_SIMILARITY_LIMIT * 100)}%. Rewrite it around what is true of ${page.meta.location ?? 'this place'}: the brief's local substance, local projects and reviews, service-area facts.`
        : null;
      const finalVerdict: 'pass' | 'fix' = dupeNote ? 'fix' : verdict;
      const finalNotes = dupeNote ? `${dupeNote}\n\n${notes}`.slice(0, 4000) : notes;
      await patchSeoPage(ctx.orgId, page, {
        review: { verdict: finalVerdict, notes: finalNotes, at, ...(dupes.length ? { similarTo: dupes.map(d => ({ pageId: d.pageId, similarity: d.similarity })) } : {}) },
        ...(finalVerdict === 'fix' ? { status: 'drafting' as const } : {}),
        ...(ran ? { models: { review: ran } } : {}),
      });
      await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      if (finalVerdict === 'fix') {
        return [
          dupeNote && verdict === 'pass' ? `Not passed: ${dupeNote}` : dupeNote,
          `Sent back to the writer: page #${page.id} is drafting again. The writer saves the fixed draft with seo_save_draft; nothing reached a person.`,
        ].filter(Boolean).join(' ');
      }
      const draft = page.meta.draftArtifactId;
      const round = page.meta.draftRound ?? 1;
      return [
        `Review recorded on page #${page.id}${ran ? ` (${ran.name})` : ''}. Now ask a person to sign off — call file_ask exactly like this:`,
        JSON.stringify({
          kind: 'signoff',
          title: `Sign off: ${page.title}`,
          body: `Draft for "${page.meta.keyword}". Approve it, revise with a note, or discard it. ${notes.slice(0, 300)}`,
          object_refs: [{ type: 'artifact', id: draft }, { type: 'object', id: page.id }],
          group_key: `seo-batch:${page.meta.batchId}`,
          group_title: page.meta.batchTitle ?? `SEO batch #${page.meta.batchId}`,
          source_ref: seoSignoffRef(page.id, draft, round),
          context_url: pageHref(page.id),
        }),
        'The answer moves the page and the gate on its own; do not change the page\'s status yourself.',
      ].join('\n');
    },
    {
      name: 'seo_save_review',
      description: 'The editor\'s verdict on an SEO draft, checked against the project\'s rules, brand, guidelines and the SERP brief: `pass` (returns the exact sign-off ask to file for a person) or `fix` (back to the writer, no person bothered). A location page whose draft is 70% or more the same as a sibling location page in the batch (city names masked) is sent back whatever the verdict, with the sibling and the score. Records the model that reviewed it.',
      schema: z.object({
        page_id: recordIdArg('The SEO page'),
        verdict: z.enum(['pass', 'fix']),
        notes: z.string().min(1).max(4000).describe('What was checked and what was found, each finding tied to the rule, guideline or SERP fact it is about.'),
      }),
    },
  );
}

export function seoRecordFeedbackTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { page_id: number | string; note: string; scope?: 'client' | 'general'; filed_to?: string; requests_changes?: boolean };
      const page = await pageArg(ctx, args.page_id);
      if (typeof page === 'string') {
        return page;
      }
      const filedTo = args.filed_to?.trim() || null;
      if (filedTo) {
        const m = /^(project|wiki):(.+)$/.exec(filedTo);
        if (!m) {
          return 'Not recorded: filed_to is `project:<id>` (the client\'s rules or notes, via update_project) or `wiki:<slug>` (the workspace wiki, via write_wiki_page).';
        }
        if (m[1] === 'project' && !(await readSeoProject(ctx.orgId, Number(m[2])))) {
          return `Not recorded: there is no project #${m[2]}.`;
        }
      }
      const note = args.note.trim();
      const feedback: SeoFeedback[] = [...(page.meta.feedback ?? [])];
      const same = feedback.findIndex(f => f.note.trim() === note);
      const at = new Date().toISOString();
      if (same >= 0) {
        feedback[same] = { ...feedback[same]!, ...(args.scope ? { scope: args.scope } : {}), ...(filedTo ? { filedTo } : {}) };
      } else {
        feedback.push({ at, by: ctx.userId ?? (ctx.agentSlug ? `agent:${ctx.agentSlug}` : null), note, ...(args.scope ? { scope: args.scope } : {}), filedTo, ...(page.meta.draftArtifactId ? { draftArtifactId: page.meta.draftArtifactId } : {}) });
      }
      const sendBack = args.requests_changes === true && page.meta.status !== 'changes_requested';
      await patchSeoPage(ctx.orgId, page, { feedback, ...(sendBack ? { status: 'changes_requested' as const, signoff: undefined } : {}) });
      const gate = await refreshSeoBatch(ctx.orgId, page.meta.batchId);
      const unfiled = feedback.filter(f => !f.filedTo).length;
      return [
        `Feedback on page #${page.id} recorded${args.scope ? ` as ${args.scope}` : ''}${filedTo ? `, filed to ${filedTo}` : ''}.`,
        unfiled > 0 ? `${unfiled} note${unfiled === 1 ? '' : 's'} on this page still say nowhere they were filed: propose where each belongs (client → update_project rules or notes; craft → write_wiki_page, "SEO playbook" or a topical page), file it, then call this again with filed_to.` : 'Every note on this page says where it went.',
        gate ? `Gate: ${gate.line}.` : null,
      ].filter(Boolean).join(' ');
    },
    {
      name: 'seo_record_feedback',
      description: 'Record a person\'s feedback on an SEO page, its scope (client: true of this client only; general: craft for every client) and where it was filed (`project:<id>` after update_project, `wiki:<slug>` after write_wiki_page). Call it once when the note arrives and again with filed_to once it is filed — the gate holds new drafts until every note on a sent-back page says where it went. `requests_changes: true` when the person asked for changes in words rather than on the sign-off card.',
      schema: z.object({
        page_id: recordIdArg('The SEO page'),
        note: z.string().min(1).max(4000).describe('The person\'s words (for an existing note, the same text, to update its scope or filed_to).'),
        scope: z.enum(['client', 'general']).optional(),
        filed_to: z.string().max(200).optional(),
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
    seoSaveResearchTool(ctx),
    seoSaveBriefTool(ctx),
    seoSaveDraftTool(ctx),
    seoSaveReviewTool(ctx),
    seoRecordFeedbackTool(ctx),
  ];
}
