/**
 * list_projects / read_project / create_project / update_project /
 * file_to_project / unfile_from_project / add_open_item — the project as the
 * agent works it. A project is the record type `data_room` (its internal
 * slug); every name a model reads says "project". The tools are on in every
 * workspace: a project is a core workspace noun, not a plugin's.
 *
 * Renamed 2026-10-27 from `*_data_room(s)`. The old names still resolve for
 * one release (`PROJECT_TOOL_ALIASES`, read by `toolAliases.ts`), so a stored
 * prompt, skill or grant that names one keeps working.
 *
 * The project is the asset: documents are only as good as the project they
 * are written from. These tools let an agent open a project for a new client
 * or engagement, read one before writing anything, file a transcript or
 * thread into it with a decision log and a weight, keep the status and cast
 * current, and put an open item on the queue a person works.
 *
 * Filing is where earned autonomy shows (design principle 11). With no project
 * named, `file_to_project` matches the material to the projects it knows —
 * attendee domains first, then the client's name, codename or aliases in the
 * title — and acts on the confidence: a clear match files; a plausible one
 * becomes an ask for a person to confirm; none becomes an ask to open a project
 * for what looks like a new opportunity. The receipt says which, and why.
 *
 * Reading is compact: the export bundle a person downloads is the same text
 * the agent reads, so what it writes from is what a person can check.
 *
 * The project is the collection around one entity (its `anchor`), and it
 * carries its own standing knowledge: `rules` (its Instructions) the agent
 * reads first, `notes` (its wiki), a dated timeline and the highlights worth
 * keeping for the case study. `update_project` maintains all of them;
 * `unfile_from_project` is the undo of a filing, the collector's included.
 */

import type { RuntimeContext } from '../types';
import type { ClientVoice, DataRoom } from '@/services/DataRoomService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createArtifact } from '@/services/ArtifactService';
import {
  addOpenItem,
  createDataRoom,
  exportDataRoom,
  fileToDataRoom,
  findInSources,
  getDataRoom,
  knowledgeDocument,
  listDataRooms,
  loadSourceTexts,
  matchDataRoom,
  projectHref,
  proposeFiling,
  readRoomSource,
  roomAnchor,
  sourceKey,
  unfileFromDataRoom,
  updateDataRoom,
  withoutAppSuffix,
} from '@/services/DataRoomService';
import { authorOf } from './renderArtifacts';

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

/**
 * The old tool names, each to its new one — accepted for one release so a
 * stored prompt, skill, grant or exclusion that names one keeps working
 * (`toolAliases.ts`). Remove after the next release.
 */
export const PROJECT_TOOL_ALIASES: Readonly<Record<string, string>> = {
  list_data_rooms: 'list_projects',
  read_data_room: 'read_project',
  create_data_room: 'create_project',
  update_data_room: 'update_project',
  file_to_data_room: 'file_to_project',
  unfile_from_data_room: 'unfile_from_project',
};

/**
 * The project the person is looking at, when the page is a project (or the
 * older `/dashboard/rooms/<id>` path a stored page context still carries).
 * @param ctx
 */
function roomInView(ctx: RuntimeContext): number | undefined {
  const rec = ctx.pageContext?.record;
  if (rec?.type === 'object' && /^\d+$/.test(rec.id) && /\/dashboard\/(?:projects|rooms)\//.test(rec.href ?? '')) {
    return Number(rec.id);
  }
  return undefined;
}

async function resolveRoom(ctx: RuntimeContext, id: number | undefined): Promise<{ id: number } | { error: string }> {
  const target = id ?? roomInView(ctx);
  if (target) {
    const room = await getDataRoom(ctx.orgId, target);
    return room ? { id: room.id } : { error: `No project #${target} in this workspace.` };
  }
  const rooms = await listDataRooms(ctx.orgId);
  if (rooms.length === 1) {
    return { id: rooms[0]!.id };
  }
  return { error: rooms.length === 0 ? 'No projects exist yet. Open one with create_project.' : `Which project? ${rooms.slice(0, 8).map(r => `#${r.id} ${r.title}`).join(' · ')}. Pass project_id.` };
}

const anchorSchema = z.object({
  type: z.string().min(1).max(40).describe('The workspace\'s word for the entity: deal, company, project, engagement, ticket…'),
  system: z.string().max(40).optional().describe('Where it lives: hubspot, jira, github…'),
  id: z.string().max(120).optional(),
  url: z.string().max(500).optional(),
  label: z.string().max(200).optional(),
  amount: z.number().optional(),
});

const highlightSchema = z.object({
  kind: z.enum(['quote', 'metric', 'win', 'challenge', 'testimonial', 'risk']),
  text: z.string().min(1).max(1000),
  who: z.string().max(120).optional().describe('Who said or did it.'),
  date: z.string().max(20).optional().describe('YYYY-MM-DD.'),
  source: z.string().max(200).optional().describe('The source title or transcript timestamp it came from.'),
});

const voiceLineSchema = z.object({
  text: z.string().min(1).max(300),
  source: z.string().min(1).max(500).describe('Where it was read: the page URL, or a source id from read_project ("doc:12"). A line you cannot source, leave out.'),
});

const neverClaimSchema = voiceLineSchema.extend({
  phrases: z.array(z.string().min(2).max(60)).max(10).optional().describe('Words a draft making this claim would use ("guaranteed", "#1 in") — checked in code on every review.'),
});

/**
 * The client voice block `update_project` sets: each field replaces the one
 * on the project; an empty list clears it.
 */
const voiceSchema = z.object({
  point_of_view: voiceLineSchema.optional().describe('Who speaks to whom: "we, to you".'),
  reading_level: voiceLineSchema.optional().describe('"Grade 7–8", "plain, no jargon".'),
  spelling: voiceLineSchema.extend({ text: z.enum(['US', 'UK']) }).optional(),
  tone: z.array(voiceLineSchema).max(8).optional().describe('Tone words, one per line.'),
  banned_phrases: z.array(voiceLineSchema).max(60).optional().describe('Words and phrases the client never uses, one per line, exactly as they would appear. A draft that has one is sent back in code.'),
  preferred_ctas: z.array(voiceLineSchema).max(10).optional().describe('The calls to action the client uses, word for word.'),
  never_claim: z.array(neverClaimSchema).max(30).optional().describe('Claims the client may not make, with the words that would make them.'),
});

/**
 * The voice argument in the project's own field names.
 * @param v - The parsed argument.
 */
function voicePatch(v: z.infer<typeof voiceSchema>): Partial<ClientVoice> {
  const out: Partial<ClientVoice> = {};
  const map = { point_of_view: 'pointOfView', reading_level: 'readingLevel', spelling: 'spelling', tone: 'tone', banned_phrases: 'bannedPhrases', preferred_ctas: 'preferredCtas', never_claim: 'neverClaim' } as const;
  for (const [arg, field] of Object.entries(map) as Array<[keyof typeof map, (typeof map)[keyof typeof map]]>) {
    if (arg in v) {
      (out as Record<string, unknown>)[field] = v[arg];
    }
  }
  return out;
}

const authorSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().max(160).optional().describe('Their title as the site gives it.'),
  url: z.string().max(500).optional().describe('Their author page on the client\'s site.'),
  topics: z.array(z.string().max(80)).max(12).optional().describe('What they write about, in the client\'s words.'),
  default: z.boolean().optional().describe('The byline a page gets when no one\'s topics fit. One author at most.'),
  source: z.string().max(500).optional().describe('Where it was read: the author page URL or a source id.'),
});

const personSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  side: z.enum(['client', 'seller', 'partner']).optional(),
});

export function listProjectsTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const rooms = await listDataRooms(ctx.orgId);
      if (rooms.length === 0) {
        return 'No projects yet.';
      }
      return JSON.stringify(rooms.map(r => ({
        id: r.id,
        title: r.title,
        client: r.meta.client ?? null,
        stage: r.meta.stage ?? null,
        status: r.meta.status ? `${r.meta.status.slice(0, 160)}${r.meta.statusAt ? ` (as of ${r.meta.statusAt.slice(0, 10)})` : ''}` : null,
        sources: r.meta.sources?.length ?? 0,
        anchor: roomAnchor(r.meta),
        closed: r.status === 'closed',
      })));
    },
    {
      name: 'list_projects',
      description: 'List the projects — one per client or engagement — with client, stage, status and how many sources each holds. Use it to find the project before reading or filing. (Formerly list_data_rooms.)',
      schema: z.object({}),
    },
  );
}

export function readProjectTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveRoom(ctx, args.project_id);
      if ('error' in found) {
        return found.error;
      }
      if (args.source || args.find) {
        const room = await getDataRoom(ctx.orgId, found.id);
        if (!room) {
          return `No project #${found.id}.`;
        }
        return args.source ? readOneSource(ctx, room, args.source, args.offset ?? 0) : findInRoom(ctx, room, args.find!);
      }
      const md = await exportDataRoom(ctx.orgId, found.id);
      return md ?? `No project #${found.id}.`;
    },
    {
      name: 'read_project',
      description: 'Read a project as one markdown bundle — the client voice and its INSTRUCTIONS first (they govern everything you do in it), status, where it publishes, its wiki, the entity it is anchored to, sources by weight with the TEXT of every ⭐⭐⭐ source (brand and guidelines: read before writing anything), the timeline, highlights, open items, every decision log, the records that belong to it (Work) and the outline of every document. This is the same bundle a person downloads as LLM context. With `source` (an id the bundle lists, e.g. "doc:12") it reads that one source whole, a page at a time from `offset`; with `find` it returns the passages of THIS project\'s sources that carry those words — the search to use for a client\'s guidelines, never a workspace-wide one. Omit `project_id` for the project the person is looking at. (Formerly read_data_room.)',
      schema: z.object({
        project_id: z.number().int().positive().optional(),
        source: z.string().max(40).optional().describe('A source id from the bundle ("doc:12", "artifact:34"): read that source whole.'),
        offset: z.number().int().min(0).optional().describe('With `source`: the character to start from, as a cut in the bundle names it.'),
        find: z.string().min(3).max(200).optional().describe('Words to find in this project\'s sources (any weight). Returns the passages, each with its source id and offset.'),
      }),
    },
  );
}

/** Characters of one source a `read_project { source }` call returns. */
const SOURCE_PAGE_CHARS = 12_000;

/**
 * One source of a project, whole, a page at a time.
 * @param ctx - The turn.
 * @param room - The project.
 * @param key - The source id.
 * @param offset - Where to start.
 */
async function readOneSource(ctx: RuntimeContext, room: DataRoom, key: string, offset: number): Promise<string> {
  const read = await readRoomSource(ctx.orgId, room, key);
  if (!read) {
    const ids = (room.meta.sources ?? []).map(sourceKey).filter(Boolean);
    return `Project #${room.id} has no source "${key}". Its sources: ${ids.join(', ') || 'none'}.`;
  }
  const { source, text } = read;
  if (!text.trim()) {
    return `"${source.title}" (${key}) has no readable text (a scan, an image, or the document is gone). Say so rather than guessing what it says.`;
  }
  const page = text.slice(offset, offset + SOURCE_PAGE_CHARS);
  const end = offset + page.length;
  return [
    `"${source.title}" (${key}, ${'⭐'.repeat(source.rating)}, filed ${source.retrievedAt.slice(0, 10)}) — characters ${offset.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')}.`,
    '',
    page,
    '',
    end < text.length ? `More follows: read_project { project_id: ${room.id}, source: "${key}", offset: ${end} }.` : 'End of the source.',
  ].join('\n');
}

/**
 * Passages in a project's own sources: the scoped search a writer uses for
 * a client's guidelines instead of the workspace-wide one.
 * @param ctx - The turn.
 * @param room - The project.
 * @param query - The words.
 */
async function findInRoom(ctx: RuntimeContext, room: DataRoom, query: string): Promise<string> {
  const sources = [...(room.meta.sources ?? [])].sort((a, b) => b.rating - a.rating);
  const texts = await loadSourceTexts(ctx.orgId, sources, 1);
  const passages = findInSources(sources, texts, query);
  if (passages.length === 0) {
    return `Nothing in project #${room.id}'s ${sources.length} sources carries "${query}". If the client's material does not say it, say you could not establish it; do not take it from another client's material.`;
  }
  return [
    `${passages.length} passages in project #${room.id}'s sources for "${query}":`,
    ...passages.map(p => `\n— "${p.title}" (${p.key}, at ${p.offset}):\n${p.text}`),
  ].join('\n');
}

/**
 * The app and plugin ids and names this install ships, for taking an app's
 * name off a project title (`withoutAppSuffix`). The core app is left out:
 * its name is the workspace's, not an app a client is worked in.
 */
async function appWords(): Promise<string[]> {
  try {
    const [{ safeListApps }, { listPluginSlugs }] = await Promise.all([import('@/libs/workspace/apps'), import('@/libs/workspace/plugins')]);
    return [...safeListApps().filter(a => !a.core).flatMap(a => [a.id, a.name]), ...listPluginSlugs()];
  } catch {
    return [];
  }
}

export function createProjectTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      // A project is the client, worked from every app: "Northwind — SEO" is
      // opened as "Northwind", and the SEO-ness lives in the SEO app's records.
      const title = withoutAppSuffix(raw.title, await appWords());
      const renamed = title !== raw.title.trim();
      const args = { ...raw, title };
      // One project per engagement. A second one with the same name or the
      // same client domains would split the record and make every later
      // filing a coin toss between the two — refuse, and point at the one
      // that exists.
      const domains = new Set((args.domains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean));
      const existing = (await listDataRooms(ctx.orgId)).find(r => r.status !== 'closed' && (r.title.trim().toLowerCase() === args.title.trim().toLowerCase() || (r.meta.domains ?? []).some(d => domains.has(d))));
      if (existing) {
        return `Not opened — project #${existing.id} "${existing.title}" already covers this engagement (${(existing.meta.domains ?? []).join(', ') || 'same title'}). File into it, or update it; open a second project only for a genuinely separate engagement, with a different title and domains.`;
      }
      const room = await createDataRoom(ctx.orgId, ctx.userId ?? 'agent', {
        title: args.title,
        client: args.client,
        codename: args.codename,
        domains: args.domains,
        aliases: args.aliases,
        stage: args.stage,
        status: args.status,
        cast: coerceJson(args.cast),
        ...(args.deal ? { deal: coerceJson(args.deal) } : {}),
        ...(args.anchor ? { anchor: coerceJson(args.anchor) } : {}),
        ...(args.notes ? { notes: args.notes } : {}),
        ...(args.rules ? { rules: coerceJson(args.rules) } : {}),
      });
      ctx.emit({ type: 'record_created', record: { type: 'object', id: String(room.id), label: room.title, href: projectHref(room.id) } });
      return `Opened project #${room.id} "${room.title}".${renamed ? ` Named after the client, not "${raw.title.trim()}": a project is the client in every app, and the app's own records say what it is doing for them.` : ''} When you tell the person, link it inline as [${room.title}](${projectHref(room.id)}) — the link is how they open it. Matching domains: ${(room.meta.domains ?? []).join(', ') || 'none yet — add the client\'s email domain so transcripts and threads can be filed to it automatically'}.`;
    },
    {
      name: 'create_project',
      description: 'Open a project for a NEW client, engagement or deal — the collection of everything ingested and everything written about it. Name the anchor (the CRM deal, the tracker project) when there is one, give the client\'s email domain(s) and any codename or aliases so material is matched to the project on its own, and seed its instructions (rules) and wiki (notes) if the person stated any. Do not open a project for an entity that already has one — list_projects first. (Formerly create_data_room.)',
      schema: z.object({
        title: z.string().min(1).max(200).describe('The client\'s name ("Northwind Home Services"), or the engagement for a deal ("Northwind — Hiring agents"). Never an app\'s name: a project is worked from every app.'),
        client: z.string().max(120).optional().describe('The client\'s name as used in prose.'),
        codename: z.string().max(60).optional().describe('For an NDA\'d deal — used in filenames instead of the name.'),
        domains: z.array(z.string()).max(10).optional().describe('Email domains that identify the client\'s people, e.g. ["northwind.example"].'),
        aliases: z.array(z.string()).max(10).optional().describe('Other names the engagement goes by in calendar titles and subjects.'),
        stage: z.string().max(60).optional().describe('In the CRM\'s words: Discovery, Proposal sent, Signed, In delivery.'),
        status: z.string().max(600).optional().describe('The status paragraph, one or two sentences.'),
        cast: z.array(personSchema).max(30).optional(),
        deal: z.object({ system: z.string().optional(), id: z.string().optional(), url: z.string().optional(), amount: z.number().optional() }).optional().describe('Shorthand for an anchor of type deal.'),
        anchor: anchorSchema.optional().describe('The entity the project is the collection around.'),
        notes: z.string().max(20_000).optional().describe('Opening notes for the project\'s wiki, markdown.'),
        rules: z.array(z.string().max(300)).max(30).optional().describe('The project\'s instructions, one line each: terminology, voice, what files here, what never leaves it.'),
      }),
    },
  );
}

/**
 * Whether this agent works records that each name their own client project
 * (the SEO seats: every page carries `projectId`). Such an agent names the
 * project on every write, because "the project on screen" may be another
 * client's.
 * @param ctx - The turn.
 */
function writesForRecordProject(ctx: RuntimeContext): boolean {
  return (ctx.enabledPlugins ?? []).includes('seo') && (ctx.objectTypeSlugs ?? []).includes('seo_page');
}

/**
 * Lines in a voice block, for the receipt.
 * @param v - The voice.
 */
function voiceLineCount(v: ClientVoice | undefined): number {
  if (!v) {
    return 0;
  }
  return [v.pointOfView, v.readingLevel, v.spelling].filter(Boolean).length + (v.tone?.length ?? 0) + (v.bannedPhrases?.length ?? 0) + (v.preferredCtas?.length ?? 0) + (v.neverClaim?.length ?? 0);
}

export function updateProjectTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      if (args.project_id === undefined && writesForRecordProject(ctx)) {
        return 'Not updated: name project_id — the project of the page the note is about (its projectId), never the project on screen.';
      }
      const found = await resolveRoom(ctx, args.project_id);
      if ('error' in found) {
        return found.error;
      }
      const room = await updateDataRoom(ctx.orgId, found.id, {
        ...(args.title ? { title: withoutAppSuffix(args.title, await appWords()) } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.stage !== undefined ? { stage: args.stage } : {}),
        ...(args.client !== undefined ? { client: args.client } : {}),
        ...(args.codename !== undefined ? { codename: args.codename } : {}),
        ...(args.domains ? { domains: args.domains } : {}),
        ...(args.aliases ? { aliases: args.aliases } : {}),
        ...(args.add_cast ? { addCast: coerceJson(args.add_cast) } : {}),
        ...(args.deliverable ? { deliverable: coerceJson(args.deliverable) } : {}),
        ...(args.deal ? { deal: coerceJson(args.deal) } : {}),
        ...(args.anchor ? { anchor: coerceJson(args.anchor) } : {}),
        ...(args.closed === undefined ? {} : { closed: args.closed }),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        ...(args.append_notes ? { appendNotes: args.append_notes } : {}),
        ...(args.add_rules ? { addRules: coerceJson(args.add_rules) } : {}),
        ...(args.rules_source ? { rulesSource: args.rules_source } : {}),
        ...(args.voice ? { voice: voicePatch(coerceJson(args.voice)) } : {}),
        ...(args.authors ? { authors: coerceJson(args.authors) } : {}),
        ...(args.remove_rules ? { removeRules: coerceJson(args.remove_rules) } : {}),
        ...(args.milestone ? { milestone: coerceJson(args.milestone) } : {}),
        ...(args.highlights ? { highlights: coerceJson(args.highlights) } : {}),
        ...(args.auto_file === undefined ? {} : { autoFile: args.auto_file }),
      });
      if (!room) {
        return `No project #${found.id}.`;
      }
      const changed = ['status', 'stage', 'client', 'codename', 'domains', 'aliases', 'add_cast', 'deliverable', 'deal', 'anchor', 'closed', 'title', 'notes', 'append_notes', 'add_rules', 'remove_rules', 'voice', 'authors', 'milestone', 'highlights', 'auto_file'].filter(k => (args as Record<string, unknown>)[k] !== undefined);
      const counts = [
        args.highlights ? `${room.meta.highlights?.length ?? 0} highlights on the project` : null,
        args.add_rules || args.remove_rules ? `${room.meta.rules?.length ?? 0} instructions` : null,
        args.voice ? `a voice block of ${voiceLineCount(room.meta.voice)} lines` : null,
        args.authors ? `${room.meta.authors?.length ?? 0} authors${room.meta.authors?.some(a => a.default) ? ` (default ${room.meta.authors.find(a => a.default)!.name})` : ''}` : null,
        args.milestone ? `${room.meta.milestones?.length ?? 0} milestones` : null,
      ].filter(Boolean);
      return `Updated project #${room.id} "${room.title}": ${changed.join(', ')}.${args.status !== undefined ? ` Status is dated ${room.meta.statusAt?.slice(0, 10)}.` : ''}${counts.length ? ` Now ${counts.join(', ')}.` : ''}`;
    },
    {
      name: 'update_project',
      description: 'Keep a project current: the dated status paragraph (say so when something ships), the stage, the anchor (the deal or tracker project it is about), people on the cast, a deliverable, matching domains and aliases — and the project\'s own knowledge: its WIKI (notes; replace with notes or add a dated section with append_notes), its INSTRUCTIONS (add_rules / remove_rules — terminology, voice, what files here, conventions the person stated; rules_source cites where they came from), the client VOICE block (voice — point of view, reading level, spelling, tone, banned phrases, calls to action, never-claim, each line sourced), the AUTHORS who sign its pages (authors), a MILESTONE on the timeline (planned or done), and HIGHLIGHTS worth keeping as they appear in material (a client\'s own words, a measured result, a win, a challenge met). When a person corrects you or states how things are called, add it as an instruction so it holds next time. Omit `project_id` for the project the person is looking at. (Formerly update_data_room.)',
      schema: z.object({
        project_id: z.number().int().positive().optional(),
        title: z.string().max(200).optional(),
        status: z.string().max(600).optional().describe('The new status paragraph. Dated automatically.'),
        stage: z.string().max(60).optional(),
        client: z.string().max(120).optional(),
        codename: z.string().max(60).optional(),
        domains: z.array(z.string()).max(10).optional().describe('Added to the existing domains.'),
        aliases: z.array(z.string()).max(10).optional().describe('Added to the existing aliases.'),
        add_cast: z.array(personSchema).max(30).optional().describe('People to add or correct.'),
        deliverable: z.object({ title: z.string(), date: z.string().optional(), artifactId: z.number().int().optional(), status: z.enum(['planned', 'drafted', 'sent', 'signed']).optional() }).optional(),
        deal: z.object({ system: z.string().optional(), id: z.string().optional(), url: z.string().optional(), amount: z.number().optional() }).optional(),
        anchor: anchorSchema.optional(),
        closed: z.boolean().optional(),
        notes: z.string().max(20_000).optional().describe('Replace the project\'s wiki (markdown).'),
        append_notes: z.string().max(10_000).optional().describe('Add a dated section to the notes instead of replacing them.'),
        add_rules: z.array(z.string().max(300)).max(30).optional().describe('Instructions to add, one line each.'),
        rules_source: z.string().max(500).optional().describe('Where add_rules came from: a source id from read_project ("doc:12") or a page URL. Each rule is stored citing it — turn a client guide\'s do and don\'t lines into rules this way.'),
        voice: voiceSchema.optional().describe('The client voice block, every line sourced. Printed at the top of read_project; banned phrases and never-claim words are checked in code on review.'),
        authors: z.array(authorSchema).max(30).optional().describe('Who signs the client\'s pages, read off their author pages: name, title, author page, topics, and which one is the default byline. Replaces the list held.'),
        remove_rules: z.array(z.string().max(300)).max(30).optional().describe('Exact instruction text to remove.'),
        milestone: z.object({ date: z.string().max(20), title: z.string().min(1).max(200), status: z.enum(['planned', 'done']), artifactId: z.number().int().optional(), note: z.string().max(300).optional() }).optional(),
        highlights: z.array(highlightSchema).max(20).optional(),
        auto_file: z.boolean().optional().describe('false stops the collector filing into this project on its own.'),
      }),
    },
  );
}

export function fileToProjectTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const author = authorOf(ctx);
      const doc = args.document_id ? await knowledgeDocument(ctx.orgId, args.document_id) : null;
      if (args.document_id && !doc) {
        return `No knowledge document #${args.document_id} in this workspace.`;
      }
      // A page of a website: read now (or as given in `text`), kept as a
      // markdown artifact with its URL, so the writer can open it later.
      let page: { title: string; text: string } | null = null;
      if (args.url && !args.document_id && !args.artifact_id) {
        if (!args.project_id && !roomInView(ctx)) {
          return 'Pass project_id to file a page: a page is filed to the project it is about.';
        }
        const read = args.text?.trim() ? { title: args.title ?? args.url, text: args.text } : await readPage(ctx, args.url);
        if (typeof read === 'string') {
          return read;
        }
        page = read;
      }
      const title = args.title ?? page?.title ?? doc?.title ?? 'Untitled source';
      const channel = args.channel ?? (doc ? doc.sourceSlug : page ? 'web' : undefined);
      const date = args.date ?? (typeof doc?.metadata.start === 'string' ? doc.metadata.start.slice(0, 10) : undefined);

      let roomId = args.project_id ?? roomInView(ctx);
      let how = roomId ? 'named' : '';
      if (!roomId) {
        const emails = [...(args.emails ?? []), ...(typeof doc?.metadata.host === 'string' ? [doc.metadata.host] : []), ...(typeof doc?.metadata.from === 'string' ? [doc.metadata.from] : [])];
        const match = await matchDataRoom(ctx.orgId, { title, text: doc?.text ?? args.text ?? '', emails });
        const describe = (n = 3) => match.candidates.slice(0, n).map(c => `#${c.room.id} ${c.room.title} (${Math.round(c.score * 100)}%: ${c.evidence.join(', ')})`).join('; ');
        if (match.confidence === 'high' && match.best) {
          roomId = match.best.room.id;
          how = `matched at ${Math.round(match.best.score * 100)}% (${match.best.evidence.join(', ')})`;
        } else {
          const { ask, kind } = await proposeFiling(ctx.orgId, author.id, ctx.agentSlug ?? null, { title, documentId: args.document_id }, match);
          return kind === 'confirm'
            ? `Not filed — the match is plausible but not clear (${describe()}). Asked a person to confirm (ask #${ask.id}). When they choose, file it with project_id.`
            : `Not filed — no project matches "${title}"${match.candidates.length ? ` (nearest: ${describe()})` : ''}. Asked a person whether this is a new opportunity (ask #${ask.id}). Do not open a project on a guess; if they say yes, create_project then file with project_id.`;
        }
      }
      // Pasted material with no document behind it is kept as a note
      // artifact on the project, so the source is a thing a person can open.
      let artifactId = args.artifact_id;
      if (page && args.url) {
        artifactId = await keepPage(ctx, roomId, args.url, title, page.text);
      } else if (!args.document_id && !artifactId && args.text?.trim()) {
        const { artifact } = await createArtifact({
          orgId: ctx.orgId,
          kind: 'markdown',
          title,
          spec: { title, md: args.text },
          record: { type: 'object', id: String(roomId), role: `source:${title}` },
          author,
          changeSummary: 'Filed',
        });
        artifactId = artifact.id;
      }
      const { room, source, decisionLog } = await fileToDataRoom(ctx.orgId, roomId, {
        documentId: args.document_id,
        artifactId,
        title,
        kind: args.kind,
        rating: args.rating,
        channel,
        date,
        note: args.note,
        ...(page && args.url ? { url: args.url } : {}),
        decisionLog: args.decision_log,
        author,
      });
      // The decision log's "open items created by this call" are filed in the
      // same call. Red team, 2026-09-18 on production: the agent wrote "I
      // flagged two open items on the room" and had called nothing — the
      // claim was in its reply, the tool_call log was empty, the room read
      // "Nothing open". One call that files both leaves no step to narrate.
      const filedItems: string[] = [];
      for (const item of coerceJson(args.open_items) ?? []) {
        const ask = await addOpenItem(ctx.orgId, roomId, {
          title: item.title,
          body: item.body,
          urgent: item.urgent,
          owner: item.owner,
          sourceRef: `data-room:${roomId}:${(args.date ?? 'undated')}:${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
        }, author.id);
        filedItems.push(`#${ask.id} ${ask.title}${item.urgent ? ' 🔴' : ''}`);
      }
      const stars = '⭐'.repeat(source.rating);
      const itemsLine = filedItems.length
        ? ` Open items filed on the project: ${filedItems.join('; ')}.`
        : ' No open items filed — if the call created any, pass them in open_items; they are not filed from the decision log text.';
      return `Filed "${source.title}" (${source.kind}, ${stars}${channel ? `, via ${channel}` : ''}) into project #${room.id} "${room.title}" — ${how}.${decisionLog ? ` Decision log filed as artifact #${decisionLog.id}.` : ' No decision log filed — a transcript without one is storage, not a source; add decision_log when you have read it.'}${itemsLine} ${room.meta.sources?.length ?? 0} sources on the project.`;
    },
    {
      name: 'file_to_project',
      description: 'File a transcript, email thread, note, attachment, guideline document or a page of the client\'s website (`url`, kind page) into a project with provenance (channel, date), a weight (⭐1–3; 3 = read before writing anything — brand and guideline documents go in at 3) and, for a call, its DECISION LOG plus the OPEN ITEMS it created (pass them in open_items — they are filed in this call; nothing is filed from the log text alone). Omit `project_id` to match the material to a project by attendee domains and title: a clear match files, a plausible one asks a person, no match asks whether it is a new opportunity. Never opens a project on its own. (Formerly file_to_data_room.)',
      schema: z.object({
        project_id: z.number().int().positive().optional().describe('The project. Omit to match automatically.'),
        document_id: z.number().int().positive().optional().describe('The ingested knowledge document (a Zoom recording, a Gmail thread) — from search_knowledge or get_zoom_transcript.'),
        artifact_id: z.number().int().positive().optional().describe('An artifact already in the store (an uploaded PDF or document, a pasted note). It is kept on the project, and at ⭐⭐⭐ its text is printed in read_project.'),
        title: z.string().max(200).optional().describe('Defaults to the document title.'),
        kind: z.enum(['transcript', 'email', 'attachment', 'note', 'page']).describe('`page` for a page of a website, with `url`.'),
        url: z.string().url().max(1000).optional().describe('A page of a website to file (kind page): read now and kept with its URL and the date it was read. Filing the same URL again keeps one source and reads it afresh as a new version.'),
        rating: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe('1–3 stars.'),
        channel: z.string().max(40).optional().describe('zoom, gmail, drive, granola, pasted…'),
        date: z.string().max(20).optional().describe('YYYY-MM-DD of the call or message.'),
        note: z.string().max(300).optional(),
        decision_log: z.string().max(60_000).optional().describe('Markdown: participants · headlines · numbered decisions and corrections · open items created by this call.'),
        open_items: z.array(z.object({
          title: z.string().min(1).max(200),
          body: z.string().max(2000).optional(),
          urgent: z.boolean().optional(),
          owner: z.string().max(120).optional(),
        })).max(20).optional().describe('The open items the call created, filed on the project in this same call (each becomes an ask a person marks done). Listing them in decision_log alone files nothing.'),
        text: z.string().max(200_000).optional().describe('Pasted material with no document id — used for matching and kept as a note artifact.'),
        emails: z.array(z.string()).max(30).optional().describe('Attendee or sender emails, when known — the strongest matching signal.'),
      }),
    },
  );
}

/**
 * A page of a website, read now through the browse provider. A string when
 * it could not be read, said so the agent can pass it on.
 * @param ctx - The turn.
 * @param url - The page.
 */
async function readPage(ctx: RuntimeContext, url: string): Promise<{ title: string; text: string } | string> {
  try {
    const { getBrowseProvider } = await import('@/libs/tools/browse/registry');
    const got = await getBrowseProvider().fetchPage(url, { orgId: ctx.orgId });
    return got?.content.trim() ? { title: got.title || url, text: got.content } : `Not filed: ${url} has no readable text.`;
  } catch (err) {
    return `Not filed: ${url} could not be read (${(err as Error).message ?? 'unknown error'}). Say so; do not file it from memory.`;
  }
}

/**
 * Keep a page's text as a markdown artifact on the project: the one already
 * kept for this URL as a new version, else a new one.
 * @param ctx - The turn.
 * @param roomId - The project.
 * @param url - The page.
 * @param title - Its title.
 * @param text - What it says.
 * @returns The artifact id.
 */
async function keepPage(ctx: RuntimeContext, roomId: number, url: string, title: string, text: string): Promise<number> {
  const md = `Read from ${url} on ${new Date().toISOString().slice(0, 10)}.\n\n${text.trim()}`;
  const held = (await getDataRoom(ctx.orgId, roomId))?.meta.sources?.find(s => s.url === url && s.artifactId);
  if (held?.artifactId) {
    const { updateArtifact } = await import('@/services/ArtifactService');
    const updated = await updateArtifact({ orgId: ctx.orgId, id: held.artifactId, contentMarkdown: md, author: authorOf(ctx), changeSummary: 'Read again' }).catch(() => null);
    if (updated) {
      return held.artifactId;
    }
  }
  const { artifact } = await createArtifact({
    orgId: ctx.orgId,
    kind: 'markdown',
    title,
    spec: { title, md, sourceUrl: url },
    record: { type: 'object', id: String(roomId), role: `source:${url}` },
    author: authorOf(ctx),
    changeSummary: 'Read from the site',
  });
  return artifact.id;
}

export function addOpenItemTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveRoom(ctx, args.project_id);
      if ('error' in found) {
        return found.error;
      }
      const ask = await addOpenItem(ctx.orgId, found.id, { title: args.title, body: args.body, urgent: args.urgent, owner: args.owner, sourceRef: args.source_ref }, authorOf(ctx).id);
      return `Open item #${ask.id} on project #${found.id}: "${ask.title}"${args.urgent ? ' 🔴' : ''}. It is on Needs you until a person marks it done.`;
    },
    {
      name: 'add_open_item',
      description: 'Put an open item on a project — a thing to do or decide that must not fall through: an unverified number a document needs, a demo promised on a call, an input the client owes. Urgent items are 🔴. A person marks it done; the project lists it struck through.',
      schema: z.object({
        project_id: z.number().int().positive().optional(),
        title: z.string().min(1).max(200),
        body: z.string().max(2000).optional().describe('A few lines of why, markdown.'),
        urgent: z.boolean().optional(),
        owner: z.string().max(120).optional(),
        source_ref: z.string().max(200).optional().describe('Idempotency key, e.g. "call:2026-09-16:item-3" — re-filing updates rather than duplicates.'),
      }),
    },
  );
}

export function unfileFromProjectTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveRoom(ctx, args.project_id);
      if ('error' in found) {
        return found.error;
      }
      if (!args.document_id && !args.artifact_id) {
        return 'Say which source: document_id or artifact_id (read_project lists them).';
      }
      const out = await unfileFromDataRoom(ctx.orgId, found.id, { documentId: args.document_id, artifactId: args.artifact_id });
      if (!out) {
        return `Nothing to take out — project #${found.id} has no source with that id.`;
      }
      return `Took "${out.removed.title}" out of project #${out.room.id} "${out.room.title}"${out.removed.filedBy === 'auto' ? ' (it had been filed automatically)' : ''}. ${out.removed.documentId ? 'The collector will not file it there again on its own; file_to_project with project_id puts it back deliberately.' : ''}${out.room.meta.sources?.length ?? 0} sources remain.`;
    },
    {
      name: 'unfile_from_project',
      description: 'Take a source back out of a project — the undo of a filing, including one the collector made automatically. The document stays in the knowledge base; only the project\'s link to it goes, and the project remembers not to auto-file it again. A decision log filed with it stays as an artifact. (Formerly unfile_from_data_room.)',
      schema: z.object({
        project_id: z.number().int().positive().optional(),
        document_id: z.number().int().positive().optional(),
        artifact_id: z.number().int().positive().optional(),
      }),
    },
  );
}

export function projectTools(ctx: RuntimeContext) {
  return [listProjectsTool(ctx), readProjectTool(ctx), createProjectTool(ctx), updateProjectTool(ctx), fileToProjectTool(ctx), unfileFromProjectTool(ctx), addOpenItemTool(ctx)];
}
