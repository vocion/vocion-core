/**
 * Data rooms — the source of record for one client engagement.
 *
 * A room is a `business_object` of type `data_room` (workspace-authored; a
 * minimal type is created on first use so the tools work before a template
 * lands). Everything else maps onto nouns that already exist:
 *
 *   - **sources** filed to the room are `object_document_link` rows to
 *     ingested knowledge documents, with their weight (⭐–⭐⭐⭐), channel and
 *     retrieval date kept in `metadata.sources`;
 *   - **decision logs** and **documents** written from the room are artifacts
 *     anchored to the record (`recordType = 'object'`), so they carry versions,
 *     the pane and the log for free;
 *   - **open items** are asks grouped under `data-room:<id>` — a work queue a
 *     person decides on Needs you, struck through when done.
 *
 * Filing is confidence-scored (`matchDataRoom`): a transcript or thread lands
 * in the room its attendee domains and title point at; a medium match is a
 * proposal for a person; no match proposes a new room. Nothing is created on
 * a guess (design principle 11: automation is earned).
 */

import type { ArtifactRow } from '@/services/ArtifactService';
import type { Ask } from '@/services/AskService';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactHref } from '@/libs/tools/artifacts/url';
import { businessObjectSchema, businessObjectTypeSchema, knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema, objectDocumentLinkSchema } from '@/models/Schema';
import { createArtifact, listArtifactsForRecord } from '@/services/ArtifactService';
import { listAskGroup, upsertAsk } from '@/services/AskService';
import { addDocumentLink, createBusinessObject, createObjectType, getBusinessObject, getObjectTypeBySlug, listBusinessObjects, updateBusinessObject } from '@/services/BusinessObjectService';

export const DATA_ROOM_TYPE = 'data_room';

export type RoomPerson = { name: string; role?: string; email?: string; side?: 'client' | 'seller' | 'partner' };
export type RoomDeliverable = { date?: string; title: string; artifactId?: number; status?: 'planned' | 'drafted' | 'sent' | 'signed' };
export type RoomSource = {
  /** `knowledge_document.id` when the source is an ingested document. */
  documentId?: number;
  /** The artifact id when the source is a filed artifact (a decision log, an attachment). */
  artifactId?: number;
  title: string;
  kind: 'transcript' | 'email' | 'attachment' | 'note' | 'decision-log';
  /** ⭐ 1–3. Three means "read this before writing anything". */
  rating: 1 | 2 | 3;
  /** Where it came from: zoom, gmail, drive, granola, pasted… */
  channel?: string;
  date?: string;
  retrievedAt: string;
  note?: string;
};

export type RoomMeta = {
  client?: string;
  codename?: string;
  status?: string;
  statusAt?: string;
  stage?: string;
  deal?: { system?: string; id?: string; url?: string; amount?: number };
  cast?: RoomPerson[];
  deliverables?: RoomDeliverable[];
  domains?: string[];
  aliases?: string[];
  sources?: RoomSource[];
};

export type DataRoom = {
  id: number;
  title: string;
  status: string | null;
  meta: RoomMeta;
  createdAt: Date;
  updatedAt: Date | null;
};

export type DataRoomDetail = DataRoom & {
  /** Artifacts anchored to the room — decision logs, documents, PDFs. */
  artifacts: ArtifactRow[];
  /** Open (and decided) items, newest first. */
  items: Ask[];
};

const toRoom = (row: { id: number; title: string; status: string | null; metadata: unknown; createdAt: Date; updatedAt: Date | null }): DataRoom => ({
  id: row.id,
  title: row.title,
  status: row.status,
  meta: (row.metadata ?? {}) as RoomMeta,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const roomGroupKey = (id: number): string => `data-room:${id}`;
export const roomHref = (id: number): string => `/dashboard/rooms/${id}`;

/**
 * The `data_room` type, created minimally when the workspace has not authored
 * one. The template's richer type (schema, classification prompt) replaces it
 * on apply.
 * @param orgId - The project.
 */
export async function ensureDataRoomType(orgId: string): Promise<{ id: number }> {
  const existing = await getObjectTypeBySlug(orgId, DATA_ROOM_TYPE);
  if (existing) {
    return { id: existing.id };
  }
  const [created] = await createObjectType({
    slug: DATA_ROOM_TYPE,
    label: 'Data room',
    description: 'The source of record for one client engagement.',
    icon: 'folder-open',
  }, orgId);
  return { id: created!.id };
}

/**
 * Every room in the workspace, newest first.
 * @param orgId - The project.
 */
export async function listDataRooms(orgId: string): Promise<DataRoom[]> {
  const rows = await listBusinessObjects(orgId, DATA_ROOM_TYPE);
  return rows.map(toRoom);
}

/**
 * One room, or null when the id is not a data room in this workspace.
 * @param orgId - The project.
 * @param id - The room id.
 */
export async function getDataRoom(orgId: string, id: number): Promise<DataRoom | null> {
  const row = await getBusinessObject(id, orgId);
  if (!row || row.type?.slug !== DATA_ROOM_TYPE) {
    return null;
  }
  return toRoom(row);
}

/**
 * The room with what hangs off it: anchored artifacts and its items.
 * @param orgId - The project.
 * @param id - The room id.
 */
export async function getDataRoomDetail(orgId: string, id: number): Promise<DataRoomDetail | null> {
  const room = await getDataRoom(orgId, id);
  if (!room) {
    return null;
  }
  const [artifacts, items] = await Promise.all([
    listArtifactsForRecord({ orgId, record: { type: 'object', id: String(id) } }),
    listAskGroup(orgId, roomGroupKey(id)),
  ]);
  return { ...room, artifacts, items: [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) };
}

export type CreateDataRoomInput = {
  title: string;
  client?: string;
  codename?: string;
  domains?: string[];
  aliases?: string[];
  stage?: string;
  status?: string;
  deal?: RoomMeta['deal'];
  cast?: RoomPerson[];
};

const clean = (list: string[] | undefined): string[] => [...new Set((list ?? []).map(s => s.trim().toLowerCase()).filter(Boolean))];

/**
 * Open a room for an engagement.
 * @param orgId - The project.
 * @param userId - Who opened it.
 * @param input - Its shape.
 */
export async function createDataRoom(orgId: string, userId: string, input: CreateDataRoomInput): Promise<DataRoom> {
  await ensureDataRoomType(orgId);
  const now = new Date().toISOString();
  const meta: RoomMeta = {
    ...(input.client ? { client: input.client } : {}),
    ...(input.codename ? { codename: input.codename } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.status ? { status: input.status, statusAt: now } : {}),
    ...(input.deal ? { deal: input.deal } : {}),
    cast: input.cast ?? [],
    deliverables: [],
    domains: clean(input.domains),
    aliases: clean(input.aliases),
    sources: [],
  };
  const row = await createBusinessObject({ typeSlug: DATA_ROOM_TYPE, title: input.title, status: 'active', metadata: meta }, orgId, userId);
  return toRoom(row!);
}

export type UpdateDataRoomInput = Partial<Omit<CreateDataRoomInput, 'title'>> & {
  title?: string;
  /** A deliverable to add or update (matched by title). */
  deliverable?: RoomDeliverable;
  /** Cast entries to add or update (matched by email, then name). */
  addCast?: RoomPerson[];
  /** Close the room (`status: 'closed'`) or reopen it. */
  closed?: boolean;
};

/**
 * Change a room. Metadata merges; lists merge by key rather than replace, so
 * an agent updating one person never drops the rest of the cast.
 * @param orgId - The project.
 * @param id - The room id.
 * @param patch - What changes.
 */
export async function updateDataRoom(orgId: string, id: number, patch: UpdateDataRoomInput): Promise<DataRoom | null> {
  const room = await getDataRoom(orgId, id);
  if (!room) {
    return null;
  }
  const meta: RoomMeta = { ...room.meta };
  if (patch.client !== undefined) {
    meta.client = patch.client;
  }
  if (patch.codename !== undefined) {
    meta.codename = patch.codename;
  }
  if (patch.stage !== undefined) {
    meta.stage = patch.stage;
  }
  if (patch.status !== undefined) {
    meta.status = patch.status;
    meta.statusAt = new Date().toISOString();
  }
  if (patch.deal !== undefined) {
    meta.deal = { ...(meta.deal ?? {}), ...patch.deal };
  }
  if (patch.domains) {
    meta.domains = clean([...(meta.domains ?? []), ...patch.domains]);
  }
  if (patch.aliases) {
    meta.aliases = clean([...(meta.aliases ?? []), ...patch.aliases]);
  }
  if (patch.cast) {
    meta.cast = patch.cast;
  }
  if (patch.addCast?.length) {
    const cast = [...(meta.cast ?? [])];
    for (const p of patch.addCast) {
      const i = cast.findIndex(c => (p.email && c.email && c.email.toLowerCase() === p.email.toLowerCase()) || c.name.toLowerCase() === p.name.toLowerCase());
      if (i === -1) {
        cast.push(p);
      } else {
        cast[i] = { ...cast[i]!, ...p };
      }
    }
    meta.cast = cast;
  }
  if (patch.deliverable) {
    const list = [...(meta.deliverables ?? [])];
    const i = list.findIndex(d => d.title.toLowerCase() === patch.deliverable!.title.toLowerCase());
    if (i === -1) {
      list.unshift(patch.deliverable);
    } else {
      list[i] = { ...list[i]!, ...patch.deliverable };
    }
    meta.deliverables = list;
  }
  const [row] = await updateBusinessObject({
    id,
    ...(patch.title ? { title: patch.title } : {}),
    ...(patch.closed === undefined ? {} : { status: patch.closed ? 'closed' : 'active' }),
    metadata: meta as Record<string, unknown>,
  }, orgId);
  return row ? toRoom(row) : getDataRoom(orgId, id);
}

export type FileInput = {
  /** An ingested document to file… */
  documentId?: number;
  /** …or an artifact already in the store (an upload, a pasted note). */
  artifactId?: number;
  title: string;
  kind: RoomSource['kind'];
  rating: 1 | 2 | 3;
  channel?: string;
  date?: string;
  note?: string;
  /**
   * The decision log to file on top of a transcript: participants, headlines,
   * numbered decisions and corrections, open items created. Markdown. Becomes
   * a `markdown` artifact anchored to the room, rated with the source.
   */
  decisionLog?: string;
  author: { kind: 'agent' | 'human'; id: string | null };
};

/**
 * File a source into a room, with provenance. Idempotent on `documentId`:
 * filing the same document twice updates its entry rather than adding one.
 * @param orgId - The project.
 * @param id - The room id.
 * @param input - What is being filed.
 */
export async function fileToDataRoom(orgId: string, id: number, input: FileInput): Promise<{ room: DataRoom; source: RoomSource; decisionLog: ArtifactRow | null }> {
  const room = await getDataRoom(orgId, id);
  if (!room) {
    throw new Error(`data room #${id} not found`);
  }
  const retrievedAt = new Date().toISOString();
  let decisionLog: ArtifactRow | null = null;
  if (input.decisionLog?.trim()) {
    const { artifact } = await createArtifact({
      orgId,
      kind: 'markdown',
      title: `${input.date ?? retrievedAt.slice(0, 10)} · ${input.title} — decision log`,
      spec: { title: `${input.title} — decision log`, md: input.decisionLog },
      record: { type: 'object', id: String(id), role: `decision-log:${input.documentId ?? input.artifactId ?? input.title}` },
      author: input.author,
      changeSummary: 'Filed with the transcript',
    });
    decisionLog = artifact;
  }
  if (input.documentId) {
    const doc = await knowledgeDocument(orgId, input.documentId);
    if (doc) {
      await addDocumentLink({
        objectId: id,
        onyxDocumentId: String(doc.id),
        sourceType: input.channel ?? doc.sourceSlug,
        semanticIdentifier: doc.title ?? input.title,
        link: doc.uri ?? undefined,
        role: input.kind,
      }, orgId);
    }
  }
  const source: RoomSource = {
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : decisionLog ? { artifactId: decisionLog.id } : {}),
    title: input.title,
    kind: input.kind,
    rating: input.rating,
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.date ? { date: input.date } : {}),
    retrievedAt,
    ...(input.note ? { note: input.note } : {}),
  };
  const sources = [...(room.meta.sources ?? [])];
  const i = sources.findIndex(s => (input.documentId && s.documentId === input.documentId) || (input.artifactId && s.artifactId === input.artifactId));
  if (i === -1) {
    sources.unshift(source);
  } else {
    sources[i] = { ...sources[i]!, ...source };
  }
  const [updated] = await updateBusinessObject({ id, metadata: { ...room.meta, sources } as Record<string, unknown> }, orgId);
  return { room: updated ? toRoom(updated) : room, source, decisionLog };
}

/**
 * Add an open item — an ask a person decides on Needs you, grouped under the
 * room so the room page lists it and Needs you shows it as one sheet.
 * @param orgId - The project.
 * @param id - The room id.
 * @param item - The item.
 * @param item.title - One line, the thing to do or decide.
 * @param item.body - A few lines of why, markdown.
 * @param item.urgent - 🔴 — due now.
 * @param item.owner - Who it waits on, when known.
 * @param item.sourceRef - Idempotency key; re-filing updates rather than duplicates.
 * @param createdBy - Who filed it.
 */
export async function addOpenItem(orgId: string, id: number, item: { title: string; body?: string; urgent?: boolean; owner?: string; sourceRef?: string }, createdBy: string | null): Promise<Ask> {
  const room = await getDataRoom(orgId, id);
  if (!room) {
    throw new Error(`data room #${id} not found`);
  }
  const { ask } = await upsertAsk({
    orgId,
    createdBy,
    ask: {
      kind: 'input',
      title: item.title,
      body: [item.body, item.owner ? `Owner: ${item.owner}` : null].filter(Boolean).join('\n\n') || null,
      risk: item.urgent ? 'high' : 'low',
      groupKey: roomGroupKey(id),
      groupTitle: room.title,
      contextUrl: roomHref(id),
      sourceRef: item.sourceRef ?? null,
      options: [
        { id: 'done', label: 'Done', recommended: false },
        { id: 'drop', label: 'Drop it', recommended: false },
      ],
    },
  });
  return ask;
}

/* ------------------------------------------------------------------ */
/* Matching                                                             */
/* ------------------------------------------------------------------ */

export type MatchSignals = {
  title?: string;
  /** Body text — a transcript, a thread. Scanned for emails and names. */
  text?: string;
  /** Attendee or sender emails when the connector knows them. */
  emails?: string[];
};

export type RoomMatch = { room: DataRoom; score: number; evidence: string[] };
export type MatchOutcome = {
  candidates: RoomMatch[];
  best: RoomMatch | null;
  /** `high` files; `medium` proposes the filing; `none` proposes a new room. */
  confidence: 'high' | 'medium' | 'none';
};

export const MATCH_HIGH = 0.75;
export const MATCH_MEDIUM = 0.45;

const EMAIL = /[\w.%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi;

/**
 * Distinct email domains in a text, lowercased, without the common personal ones.
 * @param text
 */
export function domainsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(EMAIL)) {
    const d = m[1]!.toLowerCase();
    if (!/^(?:gmail|yahoo|hotmail|outlook|icloud|me|live)\.com$/.test(d)) {
      out.add(d);
    }
  }
  return [...out];
}

/**
 * Score every room against what is known about a piece of material. Pure
 * given the rooms; exported so the thresholds are testable.
 * @param rooms - The rooms to score.
 * @param signals - What the material says about itself.
 */
export function scoreRooms(rooms: DataRoom[], signals: MatchSignals): MatchOutcome {
  const title = (signals.title ?? '').toLowerCase();
  const text = (signals.text ?? '').toLowerCase();
  const domains = new Set([...(signals.emails ?? []).map(e => e.split('@')[1]?.toLowerCase() ?? '').filter(Boolean), ...domainsIn(`${signals.title ?? ''}\n${signals.text ?? ''}`)]);
  const candidates: RoomMatch[] = [];
  for (const room of rooms) {
    if (room.status === 'closed') {
      continue;
    }
    let score = 0;
    const evidence: string[] = [];
    const roomDomains = room.meta.domains ?? [];
    const hits = roomDomains.filter(d => domains.has(d));
    if (hits.length > 0) {
      score += Math.min(0.8, 0.6 + 0.1 * (hits.length - 1));
      evidence.push(`domain ${hits.join(', ')}`);
    }
    const names = [room.meta.client, room.meta.codename, ...(room.meta.aliases ?? [])].filter((s): s is string => Boolean(s)).map(s => s.toLowerCase());
    const inTitle = names.filter(n => title.includes(n));
    if (inTitle.length > 0) {
      score += 0.5;
      evidence.push(`"${inTitle[0]}" in the title`);
    } else {
      const inText = names.filter(n => n.length >= 4 && text.includes(n));
      if (inText.length > 0) {
        score += 0.3;
        evidence.push(`"${inText[0]}" in the text`);
      }
    }
    const castEmails = (room.meta.cast ?? []).map(p => p.email?.toLowerCase()).filter((e): e is string => Boolean(e));
    const castHit = castEmails.filter(e => text.includes(e) || (signals.emails ?? []).map(x => x.toLowerCase()).includes(e));
    if (castHit.length > 0) {
      score += 0.3;
      evidence.push(`${castHit[0]} is on the cast`);
    }
    if (score > 0) {
      candidates.push({ room, score: Math.min(1, Math.round(score * 100) / 100), evidence });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;
  const runnerUp = candidates[1];
  // A clear winner: high enough, and not neck and neck with the next room.
  const clear = best && (!runnerUp || best.score - runnerUp.score >= 0.2);
  const confidence: MatchOutcome['confidence'] = best && best.score >= MATCH_HIGH && clear ? 'high' : best && best.score >= MATCH_MEDIUM ? 'medium' : 'none';
  return { candidates, best, confidence };
}

/**
 * Which room a piece of material belongs to.
 * @param orgId - The project.
 * @param signals - What the material says about itself.
 */
export async function matchDataRoom(orgId: string, signals: MatchSignals): Promise<MatchOutcome> {
  return scoreRooms(await listDataRooms(orgId), signals);
}

/* ------------------------------------------------------------------ */
/* Documents and export                                                 */
/* ------------------------------------------------------------------ */

export type KnowledgeDoc = { id: number; title: string | null; uri: string | null; sourceSlug: string; metadata: Record<string, unknown>; text: string };

/**
 * One ingested document with its text reassembled from its chunks.
 * @param orgId - The project.
 * @param id - The knowledge document id.
 */
export async function knowledgeDocument(orgId: string, id: number): Promise<KnowledgeDoc | null> {
  const [row] = await db
    .select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title, uri: knowledgeDocumentSchema.uri, metadata: knowledgeDocumentSchema.metadata, sourceSlug: knowledgeSourceSchema.slug })
    .from(knowledgeDocumentSchema)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeSourceSchema.id, knowledgeDocumentSchema.sourceId))
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), eq(knowledgeDocumentSchema.id, id)))
    .limit(1);
  if (!row) {
    return null;
  }
  const chunks = await db
    .select({ content: knowledgeChunkSchema.content, idx: knowledgeChunkSchema.chunkIdx })
    .from(knowledgeChunkSchema)
    .where(and(eq(knowledgeChunkSchema.orgId, orgId), eq(knowledgeChunkSchema.documentId, id)))
    .orderBy(knowledgeChunkSchema.chunkIdx);
  return { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown>, text: chunks.map(c => c.content).join('\n') };
}

/**
 * The whole room as one markdown file — the "download context for an LLM"
 * bundle: the README first (status, deliverables, cast, sources by weight,
 * open items), then every decision log, then the outline of every document.
 * @param orgId - The project.
 * @param id - The room id.
 */
export async function exportDataRoom(orgId: string, id: number): Promise<string | null> {
  const room = await getDataRoomDetail(orgId, id);
  if (!room) {
    return null;
  }
  const m = room.meta;
  const stars = (n: number) => '⭐'.repeat(Math.max(1, Math.min(3, n)));
  const lines: string[] = [`# ${room.title} — data room`, ''];
  if (m.client || m.codename || m.stage) {
    lines.push([m.client ? `Client: ${m.client}` : null, m.codename ? `Codename: ${m.codename}` : null, m.stage ? `Stage: ${m.stage}` : null].filter(Boolean).join(' · '), '');
  }
  if (m.status) {
    lines.push(`> **Status${m.statusAt ? ` as of ${m.statusAt.slice(0, 10)}` : ''}.** ${m.status}`, '');
  }
  if (m.deal?.id || m.deal?.url) {
    lines.push(`Deal: ${m.deal.system ?? 'CRM'} ${m.deal.id ?? ''}${m.deal.url ? ` — ${m.deal.url}` : ''}${m.deal.amount ? ` · $${m.deal.amount.toLocaleString('en-US')}` : ''}`, '');
  }
  if (m.deliverables?.length) {
    lines.push('## Deliverables', '');
    for (const d of m.deliverables) {
      lines.push(`- ${d.date ? `**${d.date}** · ` : ''}${d.title}${d.status ? ` — ${d.status}` : ''}${d.artifactId ? ` (artifact #${d.artifactId})` : ''}`);
    }
    lines.push('');
  }
  if (m.cast?.length) {
    lines.push('## Cast', '', '| Name | Role | Email | Side |', '|---|---|---|---|');
    for (const p of m.cast) {
      lines.push(`| ${p.name} | ${p.role ?? ''} | ${p.email ?? ''} | ${p.side ?? ''} |`);
    }
    lines.push('');
  }
  const sources = [...(m.sources ?? [])].sort((a, b) => b.rating - a.rating || (b.date ?? '').localeCompare(a.date ?? ''));
  if (sources.length) {
    lines.push('## Sources', '');
    for (const s of sources) {
      lines.push(`- ${stars(s.rating)} ${s.date ? `**${s.date}** · ` : ''}${s.title} — ${s.kind}${s.channel ? ` via ${s.channel}` : ''}, filed ${s.retrievedAt.slice(0, 10)}${s.note ? `. ${s.note}` : ''}`);
    }
    lines.push('');
  }
  const open = room.items.filter(i => i.status === 'open');
  const done = room.items.filter(i => i.status !== 'open');
  if (open.length || done.length) {
    lines.push('## Open items', '');
    open.forEach((i, n) => lines.push(`${n + 1}. ${i.risk === 'high' ? '🔴 ' : ''}${i.title}${i.body ? ` — ${i.body.split('\n')[0]}` : ''}`));
    done.forEach(i => lines.push(`- ~~${i.title}~~ (${i.status}${i.decisionNote ? `: ${i.decisionNote}` : ''})`));
    lines.push('');
  }
  const logs = room.artifacts.filter(a => a.kind === 'markdown');
  for (const a of logs) {
    lines.push(`## ${a.title}`, '', String((a.spec as { md?: string }).md ?? ''), '');
  }
  const docs = room.artifacts.filter(a => a.kind === 'document' || a.kind === 'file');
  if (docs.length) {
    lines.push('## Documents', '');
    for (const a of docs) {
      const spec = a.spec as { sheets?: number; verification?: { ok?: boolean } };
      lines.push(`- ${a.title} · v${a.currentVersion}${a.kind === 'document' ? ` · ${spec.sheets ?? '?'} sheets${spec.verification ? (spec.verification.ok ? ' · verified' : ' · has issues') : ''}` : ''}${a.url ? ` — ${artifactHref(a.url)}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The rooms a set of knowledge documents are filed in — for a list page that
 * wants to show where a search hit lives.
 * @param orgId - The project.
 * @param documentIds - Knowledge document ids.
 */
export async function roomsForDocuments(orgId: string, documentIds: number[]): Promise<Map<number, DataRoom>> {
  const out = new Map<number, DataRoom>();
  if (documentIds.length === 0) {
    return out;
  }
  const type = await getObjectTypeBySlug(orgId, DATA_ROOM_TYPE);
  if (!type) {
    return out;
  }
  const rows = await db
    .select({ documentId: objectDocumentLinkSchema.onyxDocumentId, obj: businessObjectSchema })
    .from(objectDocumentLinkSchema)
    .innerJoin(businessObjectSchema, eq(businessObjectSchema.id, objectDocumentLinkSchema.objectId))
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, DATA_ROOM_TYPE), inArray(objectDocumentLinkSchema.onyxDocumentId, documentIds.map(String))));
  for (const r of rows) {
    out.set(Number(r.documentId), toRoom(r.obj));
  }
  return out;
}
