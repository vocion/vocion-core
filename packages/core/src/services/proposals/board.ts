/**
 * Proposals — the GTM app over two core nouns: the data room (the source of
 * record for an engagement) and the document written from it.
 *
 * The page leads with the rooms at Proposal stage (Chris, 2026-09-18): who
 * the client is, where the engagement stands and since when, the latest
 * document and whether it render-verified, how many items are still open,
 * and one Draft action that hands the room to the Proposal Writer. Nothing
 * here is a new table — it is a read over rooms, their anchored artifacts and
 * their asks (design principle 7), and the app is a template concern: core
 * registers the surface, a workspace switches it on (principle 12).
 *
 * This module is the pure half — rooms plus what hangs off them, in; rows,
 * out — so the stage filter and the verify state are unit-tested without a
 * database. `loadProposalBoard` is the two-query loader the page calls.
 */

import type { DocumentRedTeam, DocumentVerification } from '@/libs/cards/specs';
import type { ArtifactRow } from '@/services/ArtifactService';
import type { DataRoom } from '@/services/DataRoomService';
import { redTeamChip, verificationChip } from '@/libs/documents/audit';
import { listArtifactsByIds, listArtifactsForRecords } from '@/services/ArtifactService';
import { countOpenAsksByGroup } from '@/services/AskService';
import { DATA_ROOM_TYPE, listDataRooms, roomGroupKey, roomHref } from '@/services/DataRoomService';

/** Where a proposal-stage engagement stands, read off the room's free-text stage. */
export type ProposalStage = 'drafting' | 'sent';

export type ProposalDocument = {
  id: number;
  title: string;
  href: string;
  /** `verified` · `issues` · `unverified` — the render-verify receipt's verdict. */
  verify: 'verified' | 'issues' | 'unverified';
  /** The receipt line a person reads: `7 sheets · verified`. */
  chip: string;
  /**
   * Whether a sceptical buyer has read THIS version, and what they found —
   * the same claim the export gate enforces, shown where it is read
   * (`services/documents/exportGate.ts`). `unread` means the PDF cannot go
   * out until someone or something reads it.
   */
  redTeam: 'clean' | 'findings' | 'blocking' | 'unread';
  /** The line beside the verify chip: `read as the buyer · 2 blocking`. */
  redTeamLabel: string;
  version: number;
};

export type ProposalRow = {
  id: number;
  title: string;
  client?: string;
  stage: ProposalStage;
  /** The room's own stage words, e.g. "Proposal sent". */
  stageLabel: string;
  status?: string;
  /** ISO date the status was written, when the room says. */
  statusAt?: string;
  document: ProposalDocument | null;
  openItems: number;
  href: string;
  /** The record the Draft action hands to the agent surface. */
  record: { type: 'object'; id: string; label: string; href: string };
};

/**
 * Whether a room's stage is a proposal stage, and which kind. The stage is
 * the CRM's own words (the object type says so), so this is a word test, not
 * an enum: "Proposal", "Proposal sent", "Proposal — in review" all count;
 * "Discovery", "Signed", "In delivery" do not.
 * @param stage - `meta.stage` on the room.
 */
export function proposalStage(stage: string | undefined): ProposalStage | null {
  const s = (stage ?? '').toLowerCase();
  if (!/\bproposal/.test(s)) {
    return null;
  }
  return /\b(?:sent|submitted|delivered)\b/.test(s) ? 'sent' : 'drafting';
}

/**
 * The newest document written from a room, as the row shows it.
 * @param artifacts - Every artifact anchored to the room.
 */
export function latestDocument(artifacts: readonly ArtifactRow[]): ProposalDocument | null {
  const docs = artifacts.filter(a => a.kind === 'document');
  if (docs.length === 0) {
    return null;
  }
  const a = [...docs].sort((x, y) => (y.updatedAt ?? y.createdAt).getTime() - (x.updatedAt ?? x.createdAt).getTime())[0]!;
  const spec = a.spec as { sheets?: number; verification?: DocumentVerification; redTeam?: DocumentRedTeam };
  const r = spec.redTeam;
  return {
    id: a.id,
    title: a.title,
    href: a.conversationId ? `/dashboard/chat/${a.conversationId}?artifact=${a.id}` : `/dashboard/artifacts/${a.id}`,
    verify: spec.verification ? (spec.verification.ok ? 'verified' : 'issues') : 'unverified',
    chip: verificationChip(spec.verification, spec.sheets),
    redTeam: !r ? 'unread' : r.blocks > 0 ? 'blocking' : r.fixes > 0 ? 'findings' : 'clean',
    redTeamLabel: redTeamChip(r),
    version: a.currentVersion,
  };
}

/**
 * Rooms → rows. Closed rooms and rooms outside a proposal stage are left out;
 * what remains is ordered by the freshest status first, so the room that
 * moved last is at the top.
 * @param rooms - Every data room in the workspace.
 * @param artifactsByRoom - Anchored artifacts, keyed by room id.
 * @param openByRoom - Open ask count, keyed by room id.
 */
export function proposalRows(
  rooms: readonly DataRoom[],
  artifactsByRoom: ReadonlyMap<number, readonly ArtifactRow[]>,
  openByRoom: ReadonlyMap<number, number>,
): ProposalRow[] {
  const rows: ProposalRow[] = [];
  for (const r of rooms) {
    const stage = proposalStage(r.meta.stage);
    if (!stage || r.status === 'closed') {
      continue;
    }
    rows.push({
      id: r.id,
      title: r.title,
      client: r.meta.client,
      stage,
      stageLabel: r.meta.stage!,
      status: r.meta.status,
      statusAt: r.meta.statusAt ?? r.updatedAt?.toISOString() ?? r.createdAt.toISOString(),
      document: latestDocument(artifactsByRoom.get(r.id) ?? []),
      openItems: openByRoom.get(r.id) ?? 0,
      href: roomHref(r.id),
      record: { type: 'object', id: String(r.id), label: r.title, href: roomHref(r.id) },
    });
  }
  return rows.sort((a, b) => (b.statusAt ?? '').localeCompare(a.statusAt ?? ''));
}

/**
 * Deliverable artifacts a room lists but does not anchor — artifact id → room
 * id. Pure; the loader fetches these and files them under the room so the
 * board reads one truth with the room page (2026-09-18: a proposal rendered in
 * chat sat in `deliverables` and the board said "no document").
 * @param rooms - Proposal-stage rooms.
 * @param byRoom - Artifacts already anchored, by room id.
 */
export function unanchoredDeliverables(rooms: DataRoom[], byRoom: Map<number, ArtifactRow[]>): Map<number, number> {
  const wanted = new Map<number, number>();
  for (const r of rooms) {
    for (const d of r.meta.deliverables ?? []) {
      if (d.artifactId && !(byRoom.get(r.id) ?? []).some(a => a.id === d.artifactId)) {
        wanted.set(d.artifactId, r.id);
      }
    }
  }
  return wanted;
}

/**
 * The board for one workspace: rooms, then their artifacts and open counts in
 * one query each.
 * @param orgId - The project.
 */
export async function loadProposalBoard(orgId: string): Promise<ProposalRow[]> {
  const rooms = (await listDataRooms(orgId)).filter(r => proposalStage(r.meta.stage) && r.status !== 'closed');
  if (rooms.length === 0) {
    return [];
  }
  const ids = rooms.map(r => r.id);
  const [artifacts, open] = await Promise.all([
    listArtifactsForRecords({ orgId, recordType: 'object', recordIds: ids.map(String) }),
    countOpenAsksByGroup(orgId, ids.map(roomGroupKey)),
  ]);
  const byRoom = new Map<number, ArtifactRow[]>();
  for (const a of artifacts) {
    const id = Number(a.recordId);
    byRoom.set(id, [...(byRoom.get(id) ?? []), a]);
  }
  // A deliverable that names an artifact the room does not anchor yet (a
  // document rendered before the room was named) counts as the room's too.
  const wanted = unanchoredDeliverables(rooms, byRoom);
  if (wanted.size > 0) {
    for (const a of await listArtifactsByIds({ orgId, ids: [...wanted.keys()] })) {
      const roomId = wanted.get(a.id)!;
      byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), a]);
    }
  }
  const openByRoom = new Map<number, number>();
  for (const id of ids) {
    openByRoom.set(id, open.get(roomGroupKey(id)) ?? 0);
  }
  return proposalRows(rooms, byRoom, openByRoom);
}

export { DATA_ROOM_TYPE };
