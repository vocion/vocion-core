/**
 * list_data_rooms / read_data_room / create_data_room / update_data_room /
 * file_to_data_room / add_open_item — the data room as the agent works it.
 *
 * The room is the asset: documents are only as good as the room they are
 * written from. These tools let an agent open a room for a new engagement,
 * read one before writing anything, file a transcript or thread into it with
 * a decision log and a weight, keep the status and cast current, and put an
 * open item on the queue a person works.
 *
 * Filing is where earned autonomy shows (design principle 11). With no room
 * named, `file_to_data_room` matches the material to the rooms it knows —
 * attendee domains first, then the client's name, codename or aliases in the
 * title — and acts on the confidence: a clear match files; a plausible one
 * becomes an ask for a person to confirm; none becomes an ask to open a room
 * for what looks like a new opportunity. The receipt says which, and why.
 *
 * Reading is compact: the export bundle a person downloads is the same text
 * the agent reads, so what it writes from is what a person can check.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createArtifact } from '@/services/ArtifactService';
import { upsertAsk } from '@/services/AskService';
import {
  addOpenItem,
  createDataRoom,
  exportDataRoom,
  fileToDataRoom,
  getDataRoom,
  knowledgeDocument,
  listDataRooms,
  matchDataRoom,
  roomHref,
  updateDataRoom,
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
 * The room the person is looking at, when the page is a room.
 * @param ctx
 */
function roomInView(ctx: RuntimeContext): number | undefined {
  const rec = ctx.pageContext?.record;
  if (rec?.type === 'object' && /^\d+$/.test(rec.id) && (rec.href ?? '').includes('/dashboard/rooms/')) {
    return Number(rec.id);
  }
  return undefined;
}

async function resolveRoom(ctx: RuntimeContext, id: number | undefined): Promise<{ id: number } | { error: string }> {
  const target = id ?? roomInView(ctx);
  if (target) {
    const room = await getDataRoom(ctx.orgId, target);
    return room ? { id: room.id } : { error: `No data room #${target} in this workspace.` };
  }
  const rooms = await listDataRooms(ctx.orgId);
  if (rooms.length === 1) {
    return { id: rooms[0]!.id };
  }
  return { error: rooms.length === 0 ? 'No data rooms exist yet. Open one with create_data_room.' : `Which room? ${rooms.slice(0, 8).map(r => `#${r.id} ${r.title}`).join(' · ')}. Pass room_id.` };
}

const personSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  side: z.enum(['client', 'seller', 'partner']).optional(),
});

export function listDataRoomsTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const rooms = await listDataRooms(ctx.orgId);
      if (rooms.length === 0) {
        return 'No data rooms yet.';
      }
      return JSON.stringify(rooms.map(r => ({
        id: r.id,
        title: r.title,
        client: r.meta.client ?? null,
        stage: r.meta.stage ?? null,
        status: r.meta.status ? `${r.meta.status.slice(0, 160)}${r.meta.statusAt ? ` (as of ${r.meta.statusAt.slice(0, 10)})` : ''}` : null,
        sources: r.meta.sources?.length ?? 0,
        closed: r.status === 'closed',
      })));
    },
    {
      name: 'list_data_rooms',
      description: 'List the data rooms — one per client engagement — with client, stage, status and how many sources each holds. Use it to find the room for an engagement before reading or filing.',
      schema: z.object({}),
    },
  );
}

export function readDataRoomTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveRoom(ctx, args.room_id);
      if ('error' in found) {
        return found.error;
      }
      const md = await exportDataRoom(ctx.orgId, found.id);
      return md ?? `No data room #${found.id}.`;
    },
    {
      name: 'read_data_room',
      description: 'Read a data room as one markdown bundle — status, deliverables, cast, sources by weight (⭐⭐⭐ first: read those before writing anything), open items, every decision log, and the outline of every document. This is the same bundle a person downloads as LLM context. Omit `room_id` for the room the person is looking at.',
      schema: z.object({
        room_id: z.number().int().positive().optional(),
      }),
    },
  );
}

export function createDataRoomTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      // One room per engagement. A second room with the same name or the same
      // client domains would split the record and make every later filing a
      // coin toss between the two — refuse, and point at the one that exists.
      const domains = new Set((args.domains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean));
      const existing = (await listDataRooms(ctx.orgId)).find(r => r.status !== 'closed' && (r.title.trim().toLowerCase() === args.title.trim().toLowerCase() || (r.meta.domains ?? []).some(d => domains.has(d))));
      if (existing) {
        return `Not opened — data room #${existing.id} "${existing.title}" already covers this engagement (${(existing.meta.domains ?? []).join(', ') || 'same title'}). File into it, or update it; open a second room only for a genuinely separate engagement, with a different title and domains.`;
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
      });
      ctx.emit({ type: 'record_created', record: { type: 'object', id: String(room.id), label: room.title, href: roomHref(room.id) } });
      return `Opened data room #${room.id} "${room.title}". When you tell the person, link it inline as [${room.title}](${roomHref(room.id)}) — the link is how they open it. Matching domains: ${(room.meta.domains ?? []).join(', ') || 'none yet — add the client\'s email domain so transcripts and threads can be filed to it automatically'}.`;
    },
    {
      name: 'create_data_room',
      description: 'Open a data room for a NEW engagement: the source of record for everything known about it. Give the client\'s email domain(s) and any codename or aliases, so material can be matched to the room. Do not open a room for an engagement that already has one — list_data_rooms first.',
      schema: z.object({
        title: z.string().min(1).max(200).describe('e.g. "Northwind — Hiring agents"'),
        client: z.string().max(120).optional().describe('The client\'s name as used in prose.'),
        codename: z.string().max(60).optional().describe('For an NDA\'d deal — used in filenames instead of the name.'),
        domains: z.array(z.string()).max(10).optional().describe('Email domains that identify the client\'s people, e.g. ["northwind.example"].'),
        aliases: z.array(z.string()).max(10).optional().describe('Other names the engagement goes by in calendar titles and subjects.'),
        stage: z.string().max(60).optional().describe('In the CRM\'s words: Discovery, Proposal sent, Signed, In delivery.'),
        status: z.string().max(600).optional().describe('The status paragraph, one or two sentences.'),
        cast: z.array(personSchema).max(30).optional(),
        deal: z.object({ system: z.string().optional(), id: z.string().optional(), url: z.string().optional(), amount: z.number().optional() }).optional(),
      }),
    },
  );
}

export function updateDataRoomTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveRoom(ctx, args.room_id);
      if ('error' in found) {
        return found.error;
      }
      const room = await updateDataRoom(ctx.orgId, found.id, {
        ...(args.title ? { title: args.title } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.stage !== undefined ? { stage: args.stage } : {}),
        ...(args.client !== undefined ? { client: args.client } : {}),
        ...(args.codename !== undefined ? { codename: args.codename } : {}),
        ...(args.domains ? { domains: args.domains } : {}),
        ...(args.aliases ? { aliases: args.aliases } : {}),
        ...(args.add_cast ? { addCast: coerceJson(args.add_cast) } : {}),
        ...(args.deliverable ? { deliverable: coerceJson(args.deliverable) } : {}),
        ...(args.deal ? { deal: coerceJson(args.deal) } : {}),
        ...(args.closed === undefined ? {} : { closed: args.closed }),
      });
      if (!room) {
        return `No data room #${found.id}.`;
      }
      const changed = ['status', 'stage', 'client', 'codename', 'domains', 'aliases', 'add_cast', 'deliverable', 'deal', 'closed', 'title'].filter(k => (args as Record<string, unknown>)[k] !== undefined);
      return `Updated data room #${room.id} "${room.title}": ${changed.join(', ')}.${args.status !== undefined ? ` Status is dated ${room.meta.statusAt?.slice(0, 10)}.` : ''}`;
    },
    {
      name: 'update_data_room',
      description: 'Keep a data room current: the dated status paragraph (say so when something ships), the stage, the deal link, people on the cast (added or corrected by email or name), a deliverable (planned, drafted, sent, signed), matching domains and aliases. Omit `room_id` for the room the person is looking at.',
      schema: z.object({
        room_id: z.number().int().positive().optional(),
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
        closed: z.boolean().optional(),
      }),
    },
  );
}

export function fileToDataRoomTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const author = authorOf(ctx);
      const doc = args.document_id ? await knowledgeDocument(ctx.orgId, args.document_id) : null;
      if (args.document_id && !doc) {
        return `No knowledge document #${args.document_id} in this workspace.`;
      }
      const title = args.title ?? doc?.title ?? 'Untitled source';
      const channel = args.channel ?? (doc ? doc.sourceSlug : undefined);
      const date = args.date ?? (typeof doc?.metadata.start === 'string' ? doc.metadata.start.slice(0, 10) : undefined);

      let roomId = args.room_id ?? roomInView(ctx);
      let how = roomId ? 'named' : '';
      if (!roomId) {
        const emails = [...(args.emails ?? []), ...(typeof doc?.metadata.host === 'string' ? [doc.metadata.host] : []), ...(typeof doc?.metadata.from === 'string' ? [doc.metadata.from] : [])];
        const match = await matchDataRoom(ctx.orgId, { title, text: doc?.text ?? args.text ?? '', emails });
        const describe = (n = 3) => match.candidates.slice(0, n).map(c => `#${c.room.id} ${c.room.title} (${Math.round(c.score * 100)}%: ${c.evidence.join(', ')})`).join('; ');
        if (match.confidence === 'high' && match.best) {
          roomId = match.best.room.id;
          how = `matched at ${Math.round(match.best.score * 100)}% (${match.best.evidence.join(', ')})`;
        } else if (match.confidence === 'medium' && match.best) {
          const { ask } = await upsertAsk({
            orgId: ctx.orgId,
            createdBy: author.id,
            ask: {
              kind: 'recommendation',
              title: `File "${title}" into ${match.best.room.title}?`,
              body: `It looks like it belongs there (${match.best.evidence.join(', ')}), but not clearly enough to file on its own.\n\nCandidates: ${describe()}`,
              options: match.candidates.slice(0, 3).map((c, i) => ({ id: `room-${c.room.id}`, label: c.room.title, recommended: i === 0, confidence: c.score })).concat([{ id: 'new-room', label: 'A new room', recommended: false, confidence: 0 }]),
              contextUrl: roomHref(match.best.room.id),
              sourceRef: args.document_id ? `data-room:file:${args.document_id}` : null,
              risk: 'low',
              agentSlug: ctx.agentSlug ?? null,
            },
          });
          return `Not filed — the match is plausible but not clear (${describe()}). Asked a person to confirm (ask #${ask.id}). When they choose, file it with room_id.`;
        } else {
          const { ask } = await upsertAsk({
            orgId: ctx.orgId,
            createdBy: author.id,
            ask: {
              kind: 'recommendation',
              title: `New opportunity? "${title}" matches no data room`,
              body: `Nothing filed yet. Open a room for it if this is a new engagement${match.candidates.length ? `; nearest rooms: ${describe()}` : ''}.`,
              options: [{ id: 'open-room', label: 'Open a data room', recommended: true, confidence: 0.5 }, { id: 'ignore', label: 'Not an engagement', recommended: false }],
              sourceRef: args.document_id ? `data-room:new:${args.document_id}` : null,
              risk: 'low',
              agentSlug: ctx.agentSlug ?? null,
            },
          });
          return `Not filed — no data room matches "${title}"${match.candidates.length ? ` (nearest: ${describe()})` : ''}. Asked a person whether this is a new opportunity (ask #${ask.id}). Do not open a room on a guess; if they say yes, create_data_room then file with room_id.`;
        }
      }
      // Pasted material with no document behind it is kept as a note
      // artifact on the room, so the source is a thing a person can open.
      let artifactId = args.artifact_id;
      if (!args.document_id && !artifactId && args.text?.trim()) {
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
        ? ` Open items filed on the room: ${filedItems.join('; ')}.`
        : ' No open items filed — if the call created any, pass them in open_items; they are not filed from the decision log text.';
      return `Filed "${source.title}" (${source.kind}, ${stars}${channel ? `, via ${channel}` : ''}) into data room #${room.id} "${room.title}" — ${how}.${decisionLog ? ` Decision log filed as artifact #${decisionLog.id}.` : ' No decision log filed — a transcript without one is storage, not a source; add decision_log when you have read it.'}${itemsLine} ${room.meta.sources?.length ?? 0} sources on the room.`;
    },
    {
      name: 'file_to_data_room',
      description: 'File a transcript, email thread, note or attachment into a data room with provenance (channel, date), a weight (⭐1–3; 3 = read before writing anything) and, for a call, its DECISION LOG plus the OPEN ITEMS it created (pass them in open_items — they are filed in this call; nothing is filed from the log text alone). Omit `room_id` to match the material to a room by attendee domains and title: a clear match files, a plausible one asks a person, no match asks whether it is a new opportunity. Never opens a room on its own.',
      schema: z.object({
        room_id: z.number().int().positive().optional().describe('The room. Omit to match automatically.'),
        document_id: z.number().int().positive().optional().describe('The ingested knowledge document (a Zoom recording, a Gmail thread) — from search_knowledge or get_zoom_transcript.'),
        artifact_id: z.number().int().positive().optional().describe('An artifact already in the store (an upload, a pasted note).'),
        title: z.string().max(200).optional().describe('Defaults to the document title.'),
        kind: z.enum(['transcript', 'email', 'attachment', 'note']),
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
        })).max(20).optional().describe('The open items the call created, filed on the room in this same call (each becomes an ask a person marks done). Listing them in decision_log alone files nothing.'),
        text: z.string().max(200_000).optional().describe('Pasted material with no document id — used for matching and kept as a note artifact.'),
        emails: z.array(z.string()).max(30).optional().describe('Attendee or sender emails, when known — the strongest matching signal.'),
      }),
    },
  );
}

export function addOpenItemTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveRoom(ctx, args.room_id);
      if ('error' in found) {
        return found.error;
      }
      const ask = await addOpenItem(ctx.orgId, found.id, { title: args.title, body: args.body, urgent: args.urgent, owner: args.owner, sourceRef: args.source_ref }, authorOf(ctx).id);
      return `Open item #${ask.id} on data room #${found.id}: "${ask.title}"${args.urgent ? ' 🔴' : ''}. It is on Needs you until a person marks it done.`;
    },
    {
      name: 'add_open_item',
      description: 'Put an open item on a data room — a thing to do or decide that must not fall through: an unverified number a document needs, a demo promised on a call, an input the client owes. Urgent items are 🔴. A person marks it done; the room lists it struck through.',
      schema: z.object({
        room_id: z.number().int().positive().optional(),
        title: z.string().min(1).max(200),
        body: z.string().max(2000).optional().describe('A few lines of why, markdown.'),
        urgent: z.boolean().optional(),
        owner: z.string().max(120).optional(),
        source_ref: z.string().max(200).optional().describe('Idempotency key, e.g. "call:2026-09-16:item-3" — re-filing updates rather than duplicates.'),
      }),
    },
  );
}

export function dataRoomTools(ctx: RuntimeContext) {
  return [listDataRoomsTool(ctx), readDataRoomTool(ctx), createDataRoomTool(ctx), updateDataRoomTool(ctx), fileToDataRoomTool(ctx), addOpenItemTool(ctx)];
}
