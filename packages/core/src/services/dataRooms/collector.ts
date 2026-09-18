/**
 * The collector — how a data room grows without anyone filing.
 *
 * After every source sync, the documents that run touched are scored against
 * the open rooms (`scoreRooms`, the same rule the `file_to_data_room` tool
 * applies) and acted on by confidence, the way a person would want work done
 * for them and shown, not asked about (Chris, 2026-09-18: "the default
 * behaviour should be done for you, with visibility and the ability to undo"):
 *
 *   - **clear match** → filed into the room as an `auto` source carrying its
 *     score and evidence. The room page shows both and a Remove that undoes it;
 *     a removed document is remembered and never re-filed on its own.
 *   - **plausible match** → the same "file this into X?" ask the tool raises.
 *   - **no match** → nothing. A transcript of an internal stand-up is not a
 *     new opportunity, and a sync is no place to ask about every one.
 *
 * The entity side of the room is kept the same way: a HubSpot deal that a sync
 * shows at a Proposal stage and that no room is anchored to gets a room, with
 * the deal as its anchor, the stage in the CRM's own words, and the deal's
 * name as an alias so its calls file themselves from then on. Closing the room
 * is the undo.
 *
 * `planCollection` and `planDealRooms` are pure — documents and rooms in,
 * decisions out — so the thresholds are testable without a database.
 * `collectAfterSync` is the thin, never-throwing wrapper the sync calls.
 */

import type { DataRoom, MatchOutcome, RoomSource } from '@/services/DataRoomService';
import type { SourceSyncCompletedPayload } from '@/services/EventService';
import { and, eq, gte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeChunkSchema, knowledgeDocumentSchema } from '@/models/Schema';
import {
  autoFiles,
  createDataRoom,
  fileToDataRoom,
  listDataRooms,
  proposeFiling,
  roomAnchor,
  roomsForDocuments,
  scoreRooms,
} from '@/services/DataRoomService';

/** Connectors whose documents are engagement material a room collects. */
export const COLLECTED_CONNECTORS = new Set(['zoom', 'granola', 'gmail', 'drive', 'google-drive', 'file-import', 'local-files']);

/** How far back a run looks for material it has not filed yet. */
export const COLLECT_WINDOW_DAYS = 30;
/** Most documents scored per run — a full re-sync of 300 recordings is not 300 reads. */
export const COLLECT_MAX_DOCS = 60;
/** Most rooms opened for deals per run. */
export const DEAL_ROOMS_MAX = 10;

export type CollectableDoc = {
  id: number;
  title: string | null;
  metadata: Record<string, unknown>;
  /** Body text, when the planner needs it for matching (names in a transcript). */
  text?: string;
  lastModifiedAt?: Date | null;
};

export type CollectionDecision
  = | { doc: CollectableDoc; action: 'file'; roomId: number; score: number; evidence: string[]; kind: RoomSource['kind']; rating: RoomSource['rating']; date?: string }
    | { doc: CollectableDoc; action: 'ask'; match: MatchOutcome }
    | { doc: CollectableDoc; action: 'skip'; reason: 'filed' | 'unfiled' | 'no-match' | 'not-material' };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * What a document is, in the room's vocabulary, from the connector's metadata.
 * @param metadata - The knowledge document's metadata.
 */
export function sourceKindOf(metadata: Record<string, unknown>): RoomSource['kind'] | null {
  const kind = str(metadata.kind) ?? '';
  if (kind === 'zoom-recording' || kind === 'granola-note' || kind.includes('transcript')) {
    return 'transcript';
  }
  if (kind.startsWith('gmail')) {
    return 'email';
  }
  if (str(metadata.objectType)) {
    // A CRM record is the anchor's side of the room, not material filed to it.
    return null;
  }
  return 'attachment';
}

/**
 * The people a document says were on it — the strongest matching signal.
 * @param metadata - The knowledge document's metadata.
 */
export function emailsOf(metadata: Record<string, unknown>): string[] {
  return [...new Set([str(metadata.host), str(metadata.from), ...strs(metadata.attendees), ...strs(metadata.to)].filter((e): e is string => Boolean(e)))];
}

/**
 * Decide what to do with each document a sync touched. Pure.
 * @param docs - The documents, with body text when available.
 * @param rooms - Every room in the workspace.
 * @param filedIn - Room per document id, for documents already filed somewhere.
 */
export function planCollection(docs: readonly CollectableDoc[], rooms: readonly DataRoom[], filedIn: ReadonlyMap<number, DataRoom>): CollectionDecision[] {
  const open = rooms.filter(autoFiles);
  const dismissed = new Set(rooms.flatMap(r => r.meta.unfiled ?? []));
  const out: CollectionDecision[] = [];
  for (const doc of docs) {
    if (filedIn.has(doc.id)) {
      out.push({ doc, action: 'skip', reason: 'filed' });
      continue;
    }
    if (dismissed.has(doc.id)) {
      out.push({ doc, action: 'skip', reason: 'unfiled' });
      continue;
    }
    const kind = sourceKindOf(doc.metadata);
    if (!kind || open.length === 0) {
      out.push({ doc, action: 'skip', reason: 'not-material' });
      continue;
    }
    const match = scoreRooms(open, { title: doc.title ?? undefined, text: doc.text, emails: emailsOf(doc.metadata) });
    if (match.confidence === 'high' && match.best) {
      const start = str(doc.metadata.start) ?? doc.lastModifiedAt?.toISOString();
      out.push({ doc, action: 'file', roomId: match.best.room.id, score: match.best.score, evidence: match.best.evidence, kind, rating: kind === 'transcript' ? 2 : 1, ...(start ? { date: start.slice(0, 10) } : {}) });
    } else if (match.confidence === 'medium') {
      out.push({ doc, action: 'ask', match });
    } else {
      out.push({ doc, action: 'skip', reason: 'no-match' });
    }
  }
  return out;
}

export type DealDoc = { id: number; title: string | null; metadata: Record<string, unknown>; lastModifiedAt?: Date | null };
export type DealRoomDecision = { deal: DealDoc; title: string; stage: string; anchor: { type: 'deal'; system: string; id: string; label: string; amount?: number } };

/**
 * Which deals a sync showed at a Proposal stage with no room yet. Pure. The
 * stage test is a word test on the CRM's own label, like the Proposals app's.
 * @param deals - HubSpot deal documents the run touched.
 * @param rooms - Every room in the workspace.
 */
export function planDealRooms(deals: readonly DealDoc[], rooms: readonly DataRoom[]): DealRoomDecision[] {
  const anchored = new Set(rooms.map(r => roomAnchor(r.meta)).filter((a): a is NonNullable<typeof a> => Boolean(a)).map(a => `${a.type}:${a.id}`));
  const out: DealRoomDecision[] = [];
  for (const deal of deals) {
    const id = str(deal.metadata.hubspotId);
    const stage = str(deal.metadata.dealStageLabel);
    if (!id || !stage || !/\bproposal/i.test(stage) || anchored.has(`deal:${id}`) || deal.metadata.dealClosed === true) {
      continue;
    }
    const title = deal.title?.trim() || `Deal ${id}`;
    const amount = typeof deal.metadata.amount === 'number' ? deal.metadata.amount : undefined;
    out.push({ deal, title, stage, anchor: { type: 'deal', system: 'hubspot', id, label: title, ...(amount === undefined ? {} : { amount }) } });
    if (out.length >= DEAL_ROOMS_MAX) {
      break;
    }
  }
  return out;
}

export type CollectReport = { filed: number; asked: number; roomsOpened: number; scanned: number };

/**
 * Run the collector for one completed sync. Never throws — the sync is done
 * and its checkpoint written; a collector failure is logged by the caller.
 * @param orgId - The org that owns the source.
 * @param payload - The completed run.
 */
export async function collectAfterSync(orgId: string, payload: SourceSyncCompletedPayload): Promise<CollectReport> {
  const report: CollectReport = { filed: 0, asked: 0, roomsOpened: 0, scanned: 0 };
  const rooms = await listDataRooms(orgId);
  const since = new Date(Date.now() - COLLECT_WINDOW_DAYS * 86_400_000);
  const cutoff = new Date(payload.completedAt);
  const touched = await db
    .select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata, lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      eq(knowledgeDocumentSchema.sourceId, payload.sourceId),
      gte(knowledgeDocumentSchema.lastSeenAt, new Date(cutoff.getTime() - 60_000)),
      gte(knowledgeDocumentSchema.ingestedAt, since),
    ))
    .limit(COLLECT_MAX_DOCS * 4);
  report.scanned = touched.length;

  if (payload.connector === 'hubspot') {
    const deals = touched.filter(d => str(d.metadata?.objectType) === 'deals').map(d => ({ ...d, metadata: d.metadata ?? {} }));
    for (const plan of planDealRooms(deals, rooms)) {
      const room = await createDataRoom(orgId, 'collector', {
        title: plan.title,
        client: plan.title,
        stage: plan.stage,
        anchor: plan.anchor,
        aliases: [plan.title],
        status: `Opened automatically when the deal reached "${plan.stage}" in HubSpot. Add the client's email domain so calls and threads file here on their own.`,
        rules: ['Opened by the collector from the CRM; a person closes it if this is not an engagement.'],
      });
      rooms.push(room);
      report.roomsOpened++;
    }
    return report;
  }

  if (!COLLECTED_CONNECTORS.has(payload.connector) || !rooms.some(autoFiles)) {
    return report;
  }
  const filedIn = await roomsForDocuments(orgId, touched.map(d => d.id));
  const candidates = touched.filter(d => !filedIn.has(d.id)).slice(0, COLLECT_MAX_DOCS);
  // Body text only for what is still a candidate — a name in a transcript is
  // worth 0.3, so the read is worth making, but not for what is already filed.
  const docs: CollectableDoc[] = [];
  for (const d of candidates) {
    const chunks = await db
      .select({ content: knowledgeChunkSchema.content })
      .from(knowledgeChunkSchema)
      .where(and(eq(knowledgeChunkSchema.orgId, orgId), eq(knowledgeChunkSchema.documentId, d.id)))
      .orderBy(knowledgeChunkSchema.chunkIdx)
      .limit(12);
    docs.push({ id: d.id, title: d.title, metadata: d.metadata ?? {}, lastModifiedAt: d.lastModifiedAt, text: chunks.map(c => c.content).join('\n').slice(0, 20_000) });
  }
  for (const decision of planCollection(docs, rooms, filedIn)) {
    if (decision.action === 'file') {
      await fileToDataRoom(orgId, decision.roomId, {
        documentId: decision.doc.id,
        title: decision.doc.title ?? 'Untitled source',
        kind: decision.kind,
        rating: decision.rating,
        channel: payload.connector,
        date: decision.date,
        author: { kind: 'agent', id: 'collector' },
        filedBy: 'auto',
        score: decision.score,
        evidence: decision.evidence,
      });
      report.filed++;
    } else if (decision.action === 'ask') {
      await proposeFiling(orgId, null, null, { title: decision.doc.title ?? 'Untitled source', documentId: decision.doc.id }, decision.match);
      report.asked++;
    }
  }
  return report;
}
