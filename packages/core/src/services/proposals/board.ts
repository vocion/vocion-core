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
import type { DataRoom, DocumentState, RoomDeliverable } from '@/services/DataRoomService';
import { redTeamChip, verificationChip } from '@/libs/documents/audit';
import { ageLabel } from '@/libs/timeAgo';
import { listArtifactsByIds, listArtifactsForRecords } from '@/services/ArtifactService';
import { countOpenAsksByGroup } from '@/services/AskService';
import { DATA_ROOM_TYPE, listDataRooms, roomDeliverables, roomGroupKey, roomHref } from '@/services/DataRoomService';

/** Where a proposal-stage engagement stands, read off the room's free-text stage. */
export type ProposalStage = 'drafting' | 'sent';

/**
 * How a reading should be drawn. Four, mapped to the brand semantic set, so
 * every state a row can be in is told apart by colour before it is read
 * (principle 10). The page turns these into `StatusPill` tones; nothing here
 * knows about a component.
 */
export type ReadingTone = 'pass' | 'amber' | 'fail' | 'neutral';

/** A claim about the document, with how strongly to say it. */
export type Reading = { label: string; tone: ReadingTone };

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
  /** How many sheets it renders to, when the spec says. */
  sheets?: number;
  /** Drafted, or out with the buyer — the room's `deliverables` word for THIS artifact. */
  state: DocumentState;
  /** ISO instant the document last moved, for "how long has it been sitting". */
  movedAt: string;
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

/** What the row is about. `none` is the row that most needs the Draft action. */
export type ProposalSubject = 'document' | 'none';

/**
 * The row as a person reads it. Pure, and the whole matrix — (no document ·
 * drafted · sent) × (unverified · verified · issues) × (not read · read clean
 * · blocks) — is unit-tested here rather than in a screenshot.
 */
export type ProposalRowView = {
  /** What the row LEADS with: the document, or the engagement when there is none. */
  title: string;
  subject: ProposalSubject;
  /**
   * The line under the title, `·`-joined, each segment toned.
   *
   * The two readings a person is actually scanning for — did it render
   * cleanly, has a sceptical buyer read it — LEAD this line rather than
   * sitting in columns, and they are coloured. Columns were the first cut and
   * they do not fit: with the conversation rail open a row is ~620px, four
   * `Column`s take 384 of it, and the title — the document, the whole point of
   * the change — collapsed to nothing. A subline starts at the same x on every
   * row, so the verdicts still line up down the list; they just line up on the
   * left (measured in a browser, 2026-09-19).
   */
  subline: Reading[];
  /** The row's own state chip: Sent · Drafted · Nothing drafted. */
  state: Reading;
  /** Did it render cleanly. `null` only when there is no document to verify. */
  verify: Reading | null;
  /** Has a sceptical buyer read this version. `null` only when there is no document. */
  redTeam: Reading | null;
  /** How long it has been sitting: "4 days ago", "Sep 3, 2026". */
  age: string;
  /** Open items on the room. */
  openItems: number;
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
 * The newest document written from a room, as the row shows it. The room's
 * `deliverables` supply the one thing the artifact cannot carry — whether the
 * thing has gone out — and nothing else: the artifact is the truth
 * (`roomDeliverables`).
 * @param artifacts - Every artifact anchored to the room.
 * @param deliverables - `meta.deliverables`, for the state of THIS artifact.
 */
export function latestDocument(artifacts: readonly ArtifactRow[], deliverables: readonly RoomDeliverable[] = []): ProposalDocument | null {
  const docs = artifacts.filter(a => a.kind === 'document');
  if (docs.length === 0) {
    return null;
  }
  const a = [...docs].sort((x, y) => (y.updatedAt ?? y.createdAt).getTime() - (x.updatedAt ?? x.createdAt).getTime())[0]!;
  const spec = a.spec as { sheets?: number; verification?: DocumentVerification; redTeam?: DocumentRedTeam };
  const r = spec.redTeam;
  const merged = roomDeliverables([a], deliverables).documents[0]!;
  const sheets = spec.verification?.sheets.length ?? spec.sheets;
  return {
    id: a.id,
    title: a.title,
    href: a.conversationId ? `/dashboard/chat/${a.conversationId}?artifact=${a.id}` : `/dashboard/artifacts/${a.id}`,
    verify: spec.verification ? (spec.verification.ok ? 'verified' : 'issues') : 'unverified',
    chip: verificationChip(spec.verification, spec.sheets),
    redTeam: !r ? 'unread' : r.blocks > 0 ? 'blocking' : r.fixes > 0 ? 'findings' : 'clean',
    redTeamLabel: redTeamChip(r),
    version: a.currentVersion,
    ...(sheets === undefined ? {} : { sheets }),
    state: merged.state,
    movedAt: (a.updatedAt ?? a.createdAt).toISOString(),
  };
}

const VERIFY: Record<ProposalDocument['verify'], ReadingTone> = { verified: 'pass', issues: 'amber', unverified: 'neutral' };
const RED_TEAM: Record<ProposalDocument['redTeam'], ReadingTone> = { clean: 'pass', findings: 'amber', blocking: 'fail', unread: 'neutral' };

/**
 * The buyer read, said in as few words as a row has room for. A list row is
 * ~190px of line with the conversation rail open, and `read as the buyer ·
 * 2 blocking` — the long form the room page and the export gate use — spent
 * all of it on the preamble and truncated the count, which is the only part
 * that decides anything. Each still names its class, so a colour is never the
 * whole claim; the long form is one click away on the room.
 */
const RED_TEAM_LABEL: Record<ProposalDocument['redTeam'], (chip: string) => string> = {
  unread: () => 'Unread',
  clean: () => 'Read clean',
  findings: chip => chip.replace('read as the buyer · ', ''),
  blocking: chip => chip.replace('read as the buyer · ', ''),
};

/**
 * The row, read. The DOCUMENT is the subject — its title leads, its version,
 * its verify verdict and its red-team state are the columns, and the room
 * drops into the subline as context.
 *
 * Chris, 2026-09-19, on the Proposals list: *"this guy has a proposal, but
 * it's not clear from the proposal list"*. It led with the room name and a
 * status sentence that truncated; the document's own state was a small column
 * reading `7 sheets · verified · not read as the buyer`.
 *
 * A row with nothing drafted keeps the engagement as its title — there is no
 * document to name — and says so in amber, with every column empty. That is
 * the row the Draft action exists for.
 * @param row - One board row.
 * @param now - The clock, injected so the age is testable.
 */
export function proposalRowView(row: ProposalRow, now: number): ProposalRowView {
  const d = row.document;
  const sat = row.statusAt?.slice(0, 10);
  const facts = (...parts: Array<string | undefined>): Reading[] => parts.filter((x): x is string => Boolean(x)).map(label => ({ label, tone: 'neutral' as const }));
  if (!d) {
    return {
      title: row.title,
      subject: 'none',
      subline: [
        { label: 'Nothing written yet', tone: 'amber' },
        ...facts(row.client, row.stageLabel, sat ? `at this stage since ${sat}` : undefined),
      ],
      state: { label: 'Nothing drafted', tone: 'amber' },
      verify: null,
      redTeam: null,
      age: row.statusAt ? ageLabel(new Date(row.statusAt), now) : '',
      openItems: row.openItems,
    };
  }
  // The room's stage can only ever say MORE than the deliverable, never less:
  // a document with no deliverable line in a room at "Proposal sent" is sent.
  const state: DocumentState = d.state === 'drafted' && row.stage === 'sent' ? 'sent' : d.state;
  const verify: Reading = {
    label: d.verify === 'verified' ? 'Verified' : d.verify === 'issues' ? verificationIssues(d.chip) : 'Not verified',
    tone: VERIFY[d.verify],
  };
  const redTeam: Reading = { label: RED_TEAM_LABEL[d.redTeam](d.redTeamLabel), tone: RED_TEAM[d.redTeam] };
  return {
    title: d.title,
    subject: 'document',
    subline: [
      verify,
      redTeam,
      ...facts(
        `v${d.version}`,
        d.sheets === undefined ? undefined : `${d.sheets} ${d.sheets === 1 ? 'sheet' : 'sheets'}`,
        row.client,
        row.title,
        sat ? `status ${sat}` : undefined,
      ),
    ],
    state: {
      label: state === 'sent' ? 'Sent' : state === 'signed' ? 'Signed' : 'Drafted',
      tone: state === 'drafted' ? 'neutral' : 'pass',
    },
    verify,
    redTeam,
    age: ageLabel(new Date(d.movedAt), now),
    openItems: row.openItems,
  };
}

/**
 * "7 sheets · 2 issues" → "2 issues". The receipt says the count; the column
 * has room for the count and not the sheets, which are in the subline.
 * @param chip - `verificationChip`'s line.
 */
function verificationIssues(chip: string): string {
  const tail = chip.split(' · ').pop();
  return tail ?? chip;
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
      document: latestDocument(artifactsByRoom.get(r.id) ?? [], r.meta.deliverables),
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
