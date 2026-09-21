/**
 * Data rooms — the collection around one entity.
 *
 * Core definition (Chris, 2026-09-18): a data room is **the collection of
 * ingested objects and generated artifacts related to one entity**, plus the
 * standing knowledge that keeps the collection growing on its own — a wiki
 * (`notes`), `rules` for collection and association, a dated timeline and the
 * highlights worth keeping. The entity is the room's `anchor`: a CRM deal at
 * Proposal stage today, a company, a project, a ticket tomorrow. A workspace
 * extends the room for its use case through the object type's schema, its
 * skills and its document playbooks — never through a second room noun. A
 * sales room persists into delivery: the anchor and the stage move, the
 * collection stays (Jamie, 2026-09-18).
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
import { anchorArtifact, createArtifact, listArtifactsForRecord } from '@/services/ArtifactService';
import { listAskGroup, upsertAsk } from '@/services/AskService';
import { addDocumentLink, createBusinessObject, createObjectType, getBusinessObject, getObjectTypeBySlug, listBusinessObjects, removeDocumentLink, updateBusinessObject } from '@/services/BusinessObjectService';

export const DATA_ROOM_TYPE = 'data_room';

export const MATCH_HIGH = 0.75;
export const MATCH_MEDIUM = 0.45;

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
  /**
   * Who put it here. `auto` is the collector filing on a clear match after a
   * sync; `agent` is a tool call in a conversation; `human` is a person. An
   * auto filing carries its score and evidence so it can be checked — and
   * undone with one click (design principle: done for you, with undo).
   */
  filedBy?: 'auto' | 'agent' | 'human';
  score?: number;
  evidence?: string[];
};

/**
 * The entity the room is the collection around. `type` is the workspace's
 * word for it — `deal`, `company`, `project`, `engagement`, `ticket` — and
 * `system`/`id`/`url` say where it lives. `deal` on the meta is the older
 * shape of the same thing and is read as an anchor of type `deal`.
 */
export type RoomAnchor = { type: string; system?: string; id?: string; url?: string; label?: string; amount?: number };

/** One dated line of the engagement's timeline — planned or done. */
export type RoomMilestone = { date: string; title: string; status: 'planned' | 'done'; artifactId?: number; note?: string };

/**
 * Something worth keeping from the material as it lands — a client's own
 * words, a measured result, a win, a challenge and how it was met. The case
 * study writes itself from these instead of being reconstructed at the end.
 */
export type RoomHighlight = {
  kind: 'quote' | 'metric' | 'win' | 'challenge' | 'testimonial' | 'risk';
  text: string;
  who?: string;
  date?: string;
  /** Where it came from — a source title, a transcript timestamp. */
  source?: string;
  addedAt: string;
};

/**
 * The client's own mark, held on the room so it is fetched once and reused
 * by every document written from the room.
 *
 * Kept as a data URI rather than a link on purpose: a client document is
 * self-contained HTML that prints to PDF and is opened a year later, so an
 * image it references by URL is an image that will one day be a broken box
 * on a cover. `source` is the URL it came from, so the claim "this is their
 * logo" is checkable in one move (design principle 10).
 */
export type RoomImage = {
  /** `data:image/png;base64,…` — ready to inline in a document. */
  dataUri: string;
  width: number | null;
  height: number | null;
  bytes: number;
  contentType: string;
  /** Where it was fetched from. */
  source: string;
  fetchedAt: string;
  /** The served artifact, for a surface that wants a URL rather than bytes. */
  url?: string;
};

/** The client's brand as the room knows it: the full lockup and the square mark. */
export type RoomBrand = { logo?: RoomImage; mark?: RoomImage };

export const ROOM_BRAND_SLOTS = ['logo', 'mark'] as const;
export type RoomBrandSlot = typeof ROOM_BRAND_SLOTS[number];

export type RoomMeta = {
  client?: string;
  codename?: string;
  status?: string;
  statusAt?: string;
  stage?: string;
  /** Older shape of `anchor` for a CRM deal; read through `roomAnchor`. */
  deal?: { system?: string; id?: string; url?: string; amount?: number };
  anchor?: RoomAnchor;
  cast?: RoomPerson[];
  deliverables?: RoomDeliverable[];
  domains?: string[];
  aliases?: string[];
  sources?: RoomSource[];
  /** The room's wiki — standing knowledge in markdown: what is where, terminology, conventions. */
  notes?: string;
  /** Rules for collecting, associating and working the room, one line each. Read by the agent before anything else. */
  rules?: string[];
  milestones?: RoomMilestone[];
  highlights?: RoomHighlight[];
  /**
   * The client's brand — the seller's own is `brand.yaml` (`get_brand`), and
   * this is the other half of the lockup on a cover.
   */
  brand?: RoomBrand;
  /** `false` keeps the collector out of this room; filings then come only from tools and people. */
  autoFile?: boolean;
  /** Knowledge documents a person or agent took back out — the collector never re-files these on its own. */
  unfiled?: number[];
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
 * The room's entity, whichever shape the meta carries. `anchor` wins; a
 * legacy `deal` reads as an anchor of type `deal`.
 * @param meta - The room's metadata.
 */
export function roomAnchor(meta: RoomMeta): RoomAnchor | null {
  if (meta.anchor?.type) {
    return meta.anchor;
  }
  if (meta.deal && (meta.deal.id || meta.deal.url)) {
    return { type: 'deal', ...meta.deal };
  }
  return null;
}

/** Where a document stands. `planned` belongs to a promise, never to a file that exists. */
export type DocumentState = 'drafted' | 'sent' | 'signed';

/** One document the room produced, carrying the commitment it fulfils. */
export type RoomDocument = {
  artifact: ArtifactRow;
  /** The `deliverables` line this artifact fulfils, when the room wrote one. */
  deliverable: RoomDeliverable | null;
  /** The deliverable's word when there is one; a file that exists is at least `drafted`. */
  state: DocumentState;
  /** The date the room put on the commitment. Only ever what the room wrote. */
  date?: string;
};

export type RoomDeliverablesSplit = {
  /** Every document and file on the room, each with its commitment merged in. */
  documents: RoomDocument[];
  /** Commitments with no artifact to point at — promised, nobody has produced them. */
  promised: RoomDeliverable[];
};

/**
 * Deliverables and documents, collapsed to one truth: **the artifact**.
 *
 * Chris, 2026-09-19, on a room showing both: *"the data room has draft doc
 * (which we already have?)"*. The room listed `… proposal v2.0 (…) — drafted`
 * under DELIVERABLES and the same artifact again under DOCUMENTS, because
 * `update_data_room` writes a deliverable line AND anchors the artifact it
 * names (see `updateDataRoom`). Two surfaces stating one fact is the defect
 * principle 6 names.
 *
 * So the artifact wins: a deliverable that names one is absorbed into that
 * document's row, where it contributes the only two things the artifact does
 * not carry — the promised date and the commercial state (`sent`, `signed`).
 * What is left over is a commitment nobody has produced, and reads as exactly
 * that. Nothing is dropped from the room's data; a line whose artifact is not
 * on this room (it moved, or was deleted) stays visible under `promised`.
 * @param artifacts - Every artifact anchored to the room.
 * @param deliverables - `meta.deliverables`, newest first.
 */
export function roomDeliverables(artifacts: readonly ArtifactRow[], deliverables: readonly RoomDeliverable[] = []): RoomDeliverablesSplit {
  const docs = artifacts.filter(a => a.kind === 'document' || a.kind === 'file');
  const byArtifact = new Map<number, RoomDeliverable>();
  for (const d of deliverables) {
    // Newest first, so the first line naming an artifact is the current one;
    // an older duplicate of the same artifact is the same fact said twice.
    if (d.artifactId !== undefined && docs.some(a => a.id === d.artifactId) && !byArtifact.has(d.artifactId)) {
      byArtifact.set(d.artifactId, d);
    }
  }
  const documents = docs.map<RoomDocument>((artifact) => {
    const d = byArtifact.get(artifact.id) ?? null;
    const said = d?.status;
    return {
      artifact,
      deliverable: d,
      state: said === 'sent' || said === 'signed' ? said : 'drafted',
      ...(d?.date ? { date: d.date } : {}),
    };
  });
  // Every line naming a document on this room is absorbed, not just the one
  // that won: an older line for the same artifact is the duplicate, and
  // re-listing it as a promise would say the produced thing is unproduced.
  const produced = new Set(docs.map(a => a.id));
  return { documents, promised: deliverables.filter(d => d.artifactId === undefined || !produced.has(d.artifactId)) };
}

/**
 * Which existing deliverable a new one REPLACES, or -1 for a new line.
 *
 * The artifact identifies the deliverable, not its prose: re-rendering the
 * same document as "… v2.0 (CV model + iPad checklist, 4-month scope)" used to
 * add a second line beside "… v1.0" for the one thing, which is the duplicate
 * Chris found on 2026-09-19. A title match stays for a promise made before any
 * artifact existed — that is how "Proposal — planned" becomes the document's
 * own line the moment one is rendered under the same name.
 * @param list - The room's deliverables.
 * @param incoming - The deliverable being written.
 */
export function deliverableIndex(list: readonly RoomDeliverable[], incoming: RoomDeliverable): number {
  const sameTitle = (d: RoomDeliverable) => d.title.trim().toLowerCase() === incoming.title.trim().toLowerCase();
  if (incoming.artifactId === undefined) {
    return list.findIndex(sameTitle);
  }
  const byArtifact = list.findIndex(d => d.artifactId === incoming.artifactId);
  return byArtifact === -1 ? list.findIndex(d => d.artifactId === undefined && sameTitle(d)) : byArtifact;
}

/**
 * Whether the collector may file into this room on its own. Default yes.
 * @param room
 */
export const autoFiles = (room: DataRoom): boolean => room.status !== 'closed' && room.meta.autoFile !== false;

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
  anchor?: RoomAnchor;
  cast?: RoomPerson[];
  notes?: string;
  rules?: string[];
  autoFile?: boolean;
};

const clean = (list: string[] | undefined): string[] => [...new Set((list ?? []).map(s => s.trim().toLowerCase()).filter(Boolean))];
/**
 * Rules and other free lines: trimmed, deduplicated, case kept.
 * @param list
 */
const cleanLines = (list: string[] | undefined): string[] => [...new Set((list ?? []).map(s => s.trim()).filter(Boolean))];

/**
 * The rules after a change: removals apply to what was there, then additions
 * land — so replacing the whole list (remove all, add the new list) keeps a
 * rule that appears in both. Pure; exported for the test.
 * @param existing - The rules on the room.
 * @param add - Rules to add.
 * @param remove - Rules to remove, by exact text.
 */
export function mergeRules(existing: string[] | undefined, add: string[] | undefined, remove: string[] | undefined): string[] {
  const drop = new Set((remove ?? []).map(r => r.trim()));
  return cleanLines([...(existing ?? []).filter(r => !drop.has(r.trim())), ...(add ?? [])]);
}

/**
 * The brand after a fetch: one slot replaced, the other left exactly as it
 * was. Replacement rather than merge, because half of an old logo and half
 * of a new one is not a logo. Pure; exported for the test.
 * @param existing - The brand on the room.
 * @param slot - Which mark was fetched.
 * @param image - The fetched image.
 */
export function mergeBrand(existing: RoomBrand | undefined, slot: RoomBrandSlot, image: RoomImage): RoomBrand {
  return { ...(existing ?? {}), [slot]: image };
}

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
    ...(input.anchor ? { anchor: input.anchor } : input.deal ? { anchor: { type: 'deal', ...input.deal } } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.autoFile === undefined ? {} : { autoFile: input.autoFile }),
    rules: cleanLines(input.rules),
    cast: input.cast ?? [],
    deliverables: [],
    domains: clean(input.domains),
    aliases: clean(input.aliases),
    sources: [],
    milestones: [],
    highlights: [],
  };
  const row = await createBusinessObject({ typeSlug: DATA_ROOM_TYPE, title: input.title, status: 'active', metadata: meta }, orgId, userId);
  void trackRoomEvent(orgId, userId, 'room.created', { by: userId === 'collector' ? 'collector' : userId.startsWith('agent:') ? 'agent' : 'human' });
  return toRoom(row!);
}

/**
 * The adoption stream's record of a room event — the data-rooms plugin's
 * measures read these. Fire-and-forget; never fails the write.
 * @param orgId - The project.
 * @param actor - Who did it (`collector`, `agent:<slug>`, a user id).
 * @param type - The event.
 * @param meta - Its metadata.
 * @param meta.by
 * @param meta.score
 */
function trackRoomEvent(orgId: string, actor: string, type: 'room.created' | 'room.source_filed', meta: { by: 'collector' | 'agent' | 'human'; score?: 'high' | 'medium' }): void {
  void import('@/services/adoption/track')
    .then(({ track }) => track({ orgId, userId: actor }, type, { agentSlug: actor.startsWith('agent:') ? actor.slice(6) : undefined, meta }))
    .catch(() => {});
}

export type UpdateDataRoomInput = Partial<Omit<CreateDataRoomInput, 'title'>> & {
  title?: string;
  /** A deliverable to add or update (matched by title). */
  deliverable?: RoomDeliverable;
  /** Cast entries to add or update (matched by email, then name). */
  addCast?: RoomPerson[];
  /** Close the room (`status: 'closed'`) or reopen it. */
  closed?: boolean;
  /** Replace the notes (the wiki) wholesale… */
  notes?: string;
  /** …or add a dated section to the end of them. */
  appendNotes?: string;
  /** Rules to add (deduplicated by text). */
  addRules?: string[];
  /** Rules to remove, by exact text. */
  removeRules?: string[];
  /** A milestone to add or update (matched by date + title). */
  milestone?: RoomMilestone;
  /** Highlights to add. Duplicates by text are dropped. */
  highlights?: Array<Omit<RoomHighlight, 'addedAt'>>;
  /** The client's logo or mark, fetched and verified — replaces whatever that slot held. */
  brandImage?: { slot: RoomBrandSlot; image: RoomImage };
  autoFile?: boolean;
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
    if (!meta.anchor || meta.anchor.type === 'deal') {
      meta.anchor = { type: 'deal', ...(meta.anchor ?? {}), ...patch.deal };
    }
  }
  if (patch.anchor !== undefined) {
    meta.anchor = { ...(meta.anchor ?? {}), ...patch.anchor };
    if (meta.anchor.type === 'deal') {
      const { type: _t, label: _l, ...deal } = meta.anchor;
      meta.deal = { ...(meta.deal ?? {}), ...deal };
    }
  }
  if (patch.notes !== undefined) {
    meta.notes = patch.notes;
  }
  if (patch.appendNotes?.trim()) {
    const stamp = new Date().toISOString().slice(0, 10);
    meta.notes = [meta.notes?.trimEnd(), `\n### ${stamp}\n\n${patch.appendNotes.trim()}`].filter(Boolean).join('\n').trim();
  }
  if (patch.addRules?.length || patch.removeRules?.length) {
    meta.rules = mergeRules(meta.rules, patch.addRules, patch.removeRules);
  }
  if (patch.milestone) {
    const list = [...(meta.milestones ?? [])];
    const key = (m: RoomMilestone) => `${m.date}|${m.title.toLowerCase()}`;
    const i = list.findIndex(m => key(m) === key(patch.milestone!));
    if (i === -1) {
      list.push(patch.milestone);
    } else {
      list[i] = { ...list[i]!, ...patch.milestone };
    }
    meta.milestones = list.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (patch.highlights?.length) {
    const have = new Set((meta.highlights ?? []).map(h => h.text.trim().toLowerCase()));
    const addedAt = new Date().toISOString();
    const fresh = patch.highlights.filter(h => h.text.trim() && !have.has(h.text.trim().toLowerCase())).map(h => ({ ...h, text: h.text.trim(), addedAt }));
    meta.highlights = [...(meta.highlights ?? []), ...fresh];
  }
  if (patch.brandImage) {
    meta.brand = mergeBrand(meta.brand, patch.brandImage.slot, patch.brandImage.image);
  }
  if (patch.autoFile !== undefined) {
    meta.autoFile = patch.autoFile;
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
    // A deliverable that names an artifact anchors it to the room, so the
    // Proposals board and the room page read one truth (2026-09-18: a proposal
    // rendered in chat was listed here and shown as "no document").
    if (patch.deliverable.artifactId) {
      await anchorArtifact({ orgId, id: patch.deliverable.artifactId, record: { type: 'object', id: String(id), role: 'document' } });
    }
    const list = [...(meta.deliverables ?? [])];
    const i = deliverableIndex(list, patch.deliverable);
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
  /** `auto` when the collector files on a match; defaults to the author's kind. */
  filedBy?: RoomSource['filedBy'];
  score?: number;
  evidence?: string[];
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
    filedBy: input.filedBy ?? input.author.kind,
    ...(input.score === undefined ? {} : { score: input.score }),
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
  };
  const sources = [...(room.meta.sources ?? [])];
  const i = sources.findIndex(s => (input.documentId && s.documentId === input.documentId) || (input.artifactId && s.artifactId === input.artifactId));
  if (i === -1) {
    sources.unshift(source);
  } else {
    sources[i] = { ...sources[i]!, ...source };
  }
  // A person or agent filing a document deliberately outranks an earlier
  // "take it out": the dismissal is lifted so the collector may keep it current.
  const unfiled = input.documentId && input.filedBy !== 'auto' ? (room.meta.unfiled ?? []).filter(d => d !== input.documentId) : room.meta.unfiled;
  const [updated] = await updateBusinessObject({ id, metadata: { ...room.meta, sources, ...(unfiled ? { unfiled } : {}) } as Record<string, unknown> }, orgId);
  const actor = input.author.id ?? (input.filedBy === 'auto' ? 'collector' : input.author.kind);
  void trackRoomEvent(orgId, actor, 'room.source_filed', {
    by: input.filedBy === 'auto' ? 'collector' : input.author.kind === 'agent' ? 'agent' : 'human',
    ...(input.score === undefined ? {} : { score: input.score >= MATCH_HIGH ? 'high' : 'medium' }),
  });
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
      // The decision contract, so the row says what is being decided without
      // being opened (`services/inbox/decisionContract.ts`).
      decision: `Decide whether "${item.title}" is done or should be dropped.`,
      recommendationWhyNot: 'This is the room\'s own open item; only the person who owns it knows where it stands.',
      impactOfDelay: item.urgent ? 'It is marked due now: the room shows it outstanding until someone says otherwise.' : 'Nothing runs on it; the room keeps showing it open.',
    },
  });
  return ask;
}

/**
 * Take a source back out of a room — the undo of a filing. The entry leaves
 * `metadata.sources`, the document link goes, and a decision log filed with
 * it stays (it is an artifact with its own history; a person deletes it
 * deliberately). Returns the entry removed, or null when nothing matched.
 * @param orgId - The project.
 * @param id - The room id.
 * @param ref - Which source: by knowledge document or by artifact.
 * @param ref.documentId
 * @param ref.artifactId
 */
export async function unfileFromDataRoom(orgId: string, id: number, ref: { documentId?: number; artifactId?: number }): Promise<{ room: DataRoom; removed: RoomSource } | null> {
  const room = await getDataRoom(orgId, id);
  if (!room) {
    return null;
  }
  const sources = [...(room.meta.sources ?? [])];
  const i = sources.findIndex(s => (ref.documentId && s.documentId === ref.documentId) || (ref.artifactId && s.artifactId === ref.artifactId));
  if (i === -1) {
    return null;
  }
  const [removed] = sources.splice(i, 1);
  if (removed!.documentId) {
    const links = await db
      .select({ id: objectDocumentLinkSchema.id })
      .from(objectDocumentLinkSchema)
      .where(and(eq(objectDocumentLinkSchema.objectId, id), eq(objectDocumentLinkSchema.onyxDocumentId, String(removed!.documentId))));
    for (const l of links) {
      await removeDocumentLink(l.id, orgId);
    }
  }
  const unfiled = removed!.documentId ? [...new Set([...(room.meta.unfiled ?? []), removed!.documentId])] : room.meta.unfiled;
  const [updated] = await updateBusinessObject({ id, metadata: { ...room.meta, sources, ...(unfiled ? { unfiled } : {}) } as Record<string, unknown> }, orgId);
  return { room: updated ? toRoom(updated) : room, removed: removed! };
}

/**
 * The two asks a filing that is not clear becomes: "file this into X?" for a
 * plausible match, "new opportunity?" for none. Shared by the tool and the
 * collector so a person sees the same card whoever hesitated.
 * @param orgId - The project.
 * @param createdBy - Who is asking.
 * @param agentSlug - The agent, when one is.
 * @param material - What is being filed.
 * @param material.title
 * @param material.documentId
 * @param match - The match outcome for it.
 */
export async function proposeFiling(orgId: string, createdBy: string | null, agentSlug: string | null, material: { title: string; documentId?: number }, match: MatchOutcome): Promise<{ ask: Ask; kind: 'confirm' | 'new-room' }> {
  const describe = (n = 3) => match.candidates.slice(0, n).map(c => `#${c.room.id} ${c.room.title} (${Math.round(c.score * 100)}%: ${c.evidence.join(', ')})`).join('; ');
  if (match.confidence === 'medium' && match.best) {
    const { ask } = await upsertAsk({
      orgId,
      createdBy,
      ask: {
        kind: 'recommendation',
        title: `File "${material.title}" into ${match.best.room.title}?`,
        body: `It looks like it belongs there (${match.best.evidence.join(', ')}), but not clearly enough to file on its own.\n\nCandidates: ${describe()}`,
        options: match.candidates.slice(0, 3).map((c, i) => ({ id: `room-${c.room.id}`, label: c.room.title, recommended: i === 0, confidence: c.score })).concat([{ id: 'new-room', label: 'A new room', recommended: false, confidence: 0 }]),
        contextUrl: roomHref(match.best.room.id),
        decision: `Decide which room "${material.title}" is filed into.`,
        recommendation: `File it into ${match.best.room.title}.`,
        why: [`It matches on ${match.best.evidence.join(', ')}.`, 'The match is strong enough to name a room but not to file on its own.'],
        impactOfDelay: 'The document stays unfiled, so nobody searching that room finds it.',
        sourceRef: material.documentId ? `data-room:file:${material.documentId}` : null,
        risk: 'low',
        agentSlug,
      },
    });
    return { ask, kind: 'confirm' };
  }
  const { ask } = await upsertAsk({
    orgId,
    createdBy,
    ask: {
      kind: 'recommendation',
      title: `New opportunity? "${material.title}" matches no data room`,
      body: `Nothing filed yet. Open a room for it if this is a new engagement${match.candidates.length ? `; nearest rooms: ${describe()}` : ''}.`,
      options: [{ id: 'open-room', label: 'Open a data room', recommended: true, confidence: 0.5 }, { id: 'ignore', label: 'Not an engagement', recommended: false }],
      decision: `Decide whether "${material.title}" is a new engagement worth a room of its own.`,
      recommendation: 'Open a data room for it.',
      why: [match.candidates.length > 0 ? `It matches no existing room; the nearest are ${describe(2)}.` : 'It matches no existing room.'],
      impactOfDelay: 'The document stays unfiled and nothing gathers around it.',
      sourceRef: material.documentId ? `data-room:new:${material.documentId}` : null,
      risk: 'low',
      agentSlug,
    },
  });
  return { ask, kind: 'new-room' };
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
 * bundle, and exactly what `read_data_room` hands the agent. Order is the
 * order to read in: the rules first (they govern everything below), the
 * status, the notes (the wiki), the entity and stage, then the material by
 * weight, the timeline, the highlights, the open items, every decision log,
 * and the outline of every document. Pure: the detail in, markdown out.
 * @param room - The room with its artifacts and items.
 */
export function renderDataRoom(room: DataRoomDetail): string {
  const m = room.meta;
  const stars = (n: number) => '⭐'.repeat(Math.max(1, Math.min(3, n)));
  const anchor = roomAnchor(m);
  const lines: string[] = [`# ${room.title} — data room`, ''];
  if (m.client || m.codename || m.stage) {
    lines.push([m.client ? `Client: ${m.client}` : null, m.codename ? `Codename: ${m.codename}` : null, m.stage ? `Stage: ${m.stage}` : null].filter(Boolean).join(' · '), '');
  }
  if (anchor) {
    lines.push(`Anchor: ${anchor.type}${anchor.label ? ` "${anchor.label}"` : ''}${anchor.system ? ` in ${anchor.system}` : ''}${anchor.id ? ` (${anchor.id})` : ''}${anchor.url ? ` — ${anchor.url}` : ''}${anchor.amount ? ` · $${anchor.amount.toLocaleString('en-US')}` : ''}`, '');
  }
  if (m.rules?.length) {
    lines.push('## Rules for this room', '');
    for (const r of m.rules) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }
  if (m.status) {
    lines.push(`> **Status${m.statusAt ? ` as of ${m.statusAt.slice(0, 10)}` : ''}.** ${m.status}`, '');
  }
  if (m.notes?.trim()) {
    lines.push('## Notes', '', m.notes.trim(), '');
  }
  const split = roomDeliverables(room.artifacts, m.deliverables);
  if (split.promised.length) {
    lines.push('## Promised', '', 'Committed to, nothing produced yet. What exists is under Documents.', '');
    for (const d of split.promised) {
      lines.push(`- ${d.date ? `**${d.date}** · ` : ''}${d.title}${d.status ? ` — ${d.status}` : ''}${d.artifactId ? ` (artifact #${d.artifactId})` : ''}`);
    }
    lines.push('');
  }
  if (m.brand?.logo || m.brand?.mark) {
    // The data URI is here in full, because the consumer of this bundle is
    // the thing writing the document, and a logo it has to fetch again is a
    // logo it will fabricate instead.
    lines.push('## Client brand', '', 'Inline these exactly, as they are. Do not redraw the mark as text.', '');
    for (const slot of ROOM_BRAND_SLOTS) {
      const img = m.brand?.[slot];
      if (img) {
        lines.push(`- **${slot}** — ${img.width && img.height ? `${img.width}×${img.height}, ` : ''}${Math.round(img.bytes / 1024)} KB, from ${img.source} on ${img.fetchedAt.slice(0, 10)}`, '', `  \`${img.dataUri}\``, '');
      }
    }
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
      const how = s.filedBy === 'auto' ? `, filed automatically${s.score === undefined ? '' : ` at ${Math.round(s.score * 100)}%`}${s.evidence?.length ? ` (${s.evidence.join(', ')})` : ''}` : '';
      lines.push(`- ${stars(s.rating)} ${s.date ? `**${s.date}** · ` : ''}${s.title} — ${s.kind}${s.channel ? ` via ${s.channel}` : ''}, filed ${s.retrievedAt.slice(0, 10)}${how}${s.note ? `. ${s.note}` : ''}`);
    }
    lines.push('');
  }
  if (m.milestones?.length) {
    lines.push('## Timeline', '', '| Date | Milestone | Status |', '|---|---|---|');
    for (const ms of [...m.milestones].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push(`| ${ms.date} | ${ms.title}${ms.note ? ` — ${ms.note}` : ''}${ms.artifactId ? ` (artifact #${ms.artifactId})` : ''} | ${ms.status} |`);
    }
    lines.push('');
  }
  if (m.highlights?.length) {
    lines.push('## Highlights', '');
    for (const h of m.highlights) {
      const attribution = [h.who, h.date, h.source].filter(Boolean).join(', ');
      lines.push(`- **${h.kind}** · ${h.kind === 'quote' ? `"${h.text}"` : h.text}${attribution ? ` — ${attribution}` : ''}`);
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
  const logs = room.artifacts.filter(a => a.kind === 'markdown' && (a.recordRole ?? '').startsWith('decision-log'));
  for (const a of logs) {
    lines.push(`## ${a.title}`, '', String((a.spec as { md?: string }).md ?? ''), '');
  }
  const docs = split.documents.map(d => d.artifact);
  if (split.documents.length) {
    lines.push('## Documents', '');
    for (const { artifact: a, state, date } of split.documents) {
      const spec = a.spec as { sheets?: number; verification?: { ok?: boolean } };
      lines.push(`- ${a.title} · v${a.currentVersion} · ${state}${date ? ` ${date}` : ''}${a.kind === 'document' ? ` · ${spec.sheets ?? '?'} sheets${spec.verification ? (spec.verification.ok ? ' · verified' : ' · has issues') : ''}` : ''}${a.url ? ` — ${artifactHref(a.url)}` : ''}`);
    }
    lines.push('');
  }
  const working = room.artifacts.filter(a => !docs.includes(a) && !logs.includes(a) && !(a.recordRole ?? '').startsWith('source:'));
  if (working.length) {
    lines.push('## Working files', '');
    for (const a of working) {
      lines.push(`- ${a.title} · ${a.kind} · v${a.currentVersion}${a.recordRole ? ` · ${a.recordRole}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The room's bundle, read from the database. Null when the id is not a room.
 * @param orgId - The project.
 * @param id - The room id.
 */
export async function exportDataRoom(orgId: string, id: number): Promise<string | null> {
  const room = await getDataRoomDetail(orgId, id);
  return room ? renderDataRoom(room) : null;
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
