/**
 * WHAT IS OWED ON AN ACCOUNT — everything not yet finished on our side for one
 * client, prospect or person, read from the records that hold it.
 *
 * On 2026-10-23 a founder asked his Founder GTM lead "what do I owe on
 * <client>?". The lead read its own follow-up rows, searched, described the
 * call from the calendar and asked whether it should read the meeting notes.
 * The answer was in the Review queue all along: the post-call follow-up email
 * another agent had drafted from that call's note, with the presented deck's
 * PDF attached, approved and sitting in Gmail Drafts. No tool the lead had
 * joined an account to the work other agents raised about it.
 *
 * This read is the join. The account is resolved once, from typed facts only:
 * the email addresses and domains the person named, and the data room that
 * matches them (its declared domains, its cast's addresses, its client name,
 * codename and aliases — `scoreRooms`, the same match filing uses). Then each
 * kind of open work is read where it lives and kept when it touches the
 * account by address, domain or room id, never by a keyword in free text:
 *
 * - **Review** — pending proposals and asks from any agent (a follow-up email,
 *   a post-call follow-up card from `meeting-followup`, a CRM update), and
 *   runs that failed and wait to be pressed again.
 * - **Drafts** — follow-up emails approved as drafts (`gmail.send`, draft) that
 *   the synced thread does not yet show as sent: the person still has to send.
 * - **Follow-ups** — tracker rows still owed (`isOwedStatus`).
 * - **The room** — its open items, and its newest decks and documents.
 * - **The last call** — the latest meeting capture with them, and whether its
 *   follow-up card exists.
 *
 * Each item carries its status and the one next move ("send the Gmail draft",
 * "approve"). An attachment printed from a deck that has changed since says
 * so: the email would carry the old version.
 */

import type { MeetingCapture } from '@/services/meetings/captures';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { isOwedStatus } from '@/libs/objects/rowLifecycle';
import { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, knowledgeDocumentSchema } from '@/models/Schema';
import { DATA_ROOM_TYPE, getDataRoomDetail, listDataRooms, scoreRooms } from '@/services/DataRoomService';
import { inboxHref } from '@/services/inbox/inboxRef';
import { bareSubject, findReplyThread } from '@/services/mail/replyThread';
import { captureOf, MEETING_CAPTURE_KINDS, meetingKey } from '@/services/meetings/captures';
import { FOLLOWUP_ACTION, followupCardFor } from '@/services/meetings/followupCards';

/** How far back open work is read. Older pending work still shows in Review. */
export const OWED_WINDOW_DAYS = 120;

/** How far back an approved draft still counts as waiting to be sent. */
export const DRAFT_WINDOW_DAYS = 30;

/** How far back the last call is looked for. */
export const MEETING_WINDOW_DAYS = 60;

/** Rows named per section. */
export const OWED_TOP = 12;

const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi;

/** Personal mail hosts: an address there names a person, never a company. */
const PERSONAL_HOSTS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com']);

/** Who the account is, as typed facts. */
export type AccountIdentity = {
  /** What the person asked about, as they said it. */
  query: string;
  /** Company domains: a match on any address at one of them. */
  domains: string[];
  /** Exact addresses: a person at a personal host, or the room's cast. */
  emails: string[];
  /** The matching data room, when one matches. */
  room: { id: number; title: string; client: string | null } | null;
  /** Why the room matched, in the match's own words. */
  matchedBy: string[];
};

export type OwedItem = {
  section: 'review' | 'draft' | 'follow_up' | 'room_item' | 'meeting';
  title: string;
  status: string;
  /** The one move that finishes it. */
  next: string;
  at: Date;
  /** Where the person does it (a Vocion path or a Gmail link). */
  href: string | null;
  /** Who raised it, when an agent did. */
  by?: string | null;
  /** One more line: what it attaches, why it failed, the deck that changed. */
  detail?: string;
};

export type OwedArtifact = { id: number; kind: string; title: string; updatedAt: Date | null; href: string };

export type OwedOnAccount = {
  identity: AccountIdentity;
  items: OwedItem[];
  artifacts: OwedArtifact[];
  /** Sections that could not be read, and why. */
  unavailable: string[];
};

/**
 * Addresses and company domains named in a text, lowercased. Pure.
 * @param text - What the person typed (`Kestrel`, `dana@kestrel.example`, `kestrel.example`).
 */
export function namedAddresses(text: string): { emails: string[]; domains: string[] } {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const m of text.matchAll(EMAIL)) {
    const email = m[0].toLowerCase();
    const host = m[1]!.toLowerCase();
    emails.add(email);
    if (!PERSONAL_HOSTS.has(host)) {
      domains.add(host);
    }
  }
  const withoutEmails = text.replace(EMAIL, ' ');
  for (const m of withoutEmails.matchAll(DOMAIN)) {
    const host = m[1]!.toLowerCase();
    if (!PERSONAL_HOSTS.has(host)) {
      domains.add(host);
    }
  }
  return { emails: [...emails], domains: [...domains] };
}

/**
 * Every address in a structured value (a run's input, a row's metadata),
 * lowercased. Reads the value's own fields; never a body of prose. Pure.
 * @param value - Any JSON value.
 */
export function addressesIn(value: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, key: string | null) => {
    if (typeof v === 'string') {
      // Bodies and notes are prose: an address quoted in one is not who the work is for.
      if (key && /^(?:body|text|content|html|note|notes|why|rationale|summary|description)$/i.test(key)) {
        return;
      }
      for (const m of v.matchAll(EMAIL)) {
        out.add(m[0].toLowerCase());
      }
    } else if (Array.isArray(v)) {
      for (const x of v) {
        walk(x, key);
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        walk(x, k);
      }
    }
  };
  walk(value, null);
  return [...out];
}

/**
 * Whether a structured value is about the account: an address at one of its
 * domains, one of its exact addresses, or its data room by id. Pure.
 * @param value - A run's input or a row's metadata.
 * @param identity - The account.
 */
export function touchesAccount(value: unknown, identity: Pick<AccountIdentity, 'domains' | 'emails' | 'room'>): boolean {
  const roomId = identity.room?.id ?? null;
  if (roomId !== null && value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (Number(v.roomId) === roomId || Number(v.dataRoomId) === roomId) {
      return true;
    }
  }
  const domains = new Set(identity.domains);
  const emails = new Set(identity.emails);
  return addressesIn(value).some(a => emails.has(a) || domains.has(a.split('@')[1] ?? ''));
}

/**
 * Resolve what the person asked about to typed facts: the addresses and
 * domains they named, widened by the data room those (or the name) match.
 * @param orgId - The workspace.
 * @param about - What they asked about, as they said it.
 */
export async function resolveAccount(orgId: string, about: string): Promise<AccountIdentity> {
  const named = namedAddresses(about);
  const rooms = await listDataRooms(orgId).catch(() => []);
  // The room match reads the name against each room's DECLARED client,
  // codename and aliases, and the addresses against its domains and cast.
  const outcome = scoreRooms(rooms, { title: about, emails: named.emails.length > 0 ? named.emails : named.domains.map(d => `someone@${d}`) });
  const best = outcome.confidence === 'none' && !(outcome.best && outcome.best.score >= 0.5) ? null : outcome.best;
  const domains = new Set(named.domains);
  const emails = new Set(named.emails);
  if (best) {
    for (const d of best.room.meta.domains ?? []) {
      domains.add(d.toLowerCase());
    }
    for (const p of best.room.meta.cast ?? []) {
      if (p.email) {
        emails.add(p.email.toLowerCase());
      }
    }
  }
  return {
    query: about,
    domains: [...domains],
    emails: [...emails],
    room: best ? { id: best.room.id, title: best.room.title, client: best.room.meta.client ?? null } : null,
    matchedBy: best?.evidence ?? [],
  };
}

/**
 * A run's next move, by its action and status. Pure.
 * @param run
 * @param run.actionId
 * @param run.status
 * @param run.input
 */
export function nextMoveFor(run: { actionId: string; status: string; input: Record<string, unknown> }): string {
  if (run.status === 'failed') {
    return 'press it again from its page (fix what the failure names first)';
  }
  if (run.actionId === FOLLOWUP_ACTION) {
    return 'approve to draft the call\'s follow-up';
  }
  if (run.actionId === 'gmail.send') {
    return run.input.draft === true ? 'approve to put the draft in Gmail' : 'approve to send';
  }
  return 'approve or decline';
}

type Attachment = { artifactId: number; title: string; stale: string | null };

/**
 * The artifacts a run attaches, each with a note when it is a PDF printed
 * from a deck or document that has changed since (`spec.exportedFrom`).
 * @param orgId - The workspace.
 * @param input - The run's input.
 */
async function attachmentsOf(orgId: string, input: Record<string, unknown>): Promise<Attachment[]> {
  const ids = (Array.isArray(input.attachments) ? input.attachments : [])
    .map(a => Number((a as { artifactId?: unknown })?.artifactId))
    .filter(n => Number.isInteger(n) && n > 0);
  for (const key of ['deckArtifactId', 'documentArtifactId']) {
    const n = Number(input[key]);
    if (Number.isInteger(n) && n > 0) {
      ids.push(n);
    }
  }
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: artifactSchema.id, title: artifactSchema.title, kind: artifactSchema.kind, spec: artifactSchema.spec, currentVersion: artifactSchema.currentVersion })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, [...new Set(ids)])));
  const sources = rows
    .map(r => (r.spec as { exportedFrom?: { artifactId?: unknown; version?: unknown } }).exportedFrom)
    .map(e => Number(e?.artifactId))
    .filter(n => Number.isInteger(n) && n > 0);
  const sourceRows = sources.length === 0
    ? []
    : await db
        .select({ id: artifactSchema.id, title: artifactSchema.title, currentVersion: artifactSchema.currentVersion })
        .from(artifactSchema)
        .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, sources)));
  const byId = new Map(sourceRows.map(s => [s.id, s]));
  return rows.map((r) => {
    const from = (r.spec as { exportedFrom?: { artifactId?: unknown; version?: unknown } }).exportedFrom;
    const src = byId.get(Number(from?.artifactId));
    const printed = Number(from?.version);
    const stale = src && Number.isInteger(printed) && src.currentVersion > printed
      ? `printed from "${src.title}" v${printed}; it is at v${src.currentVersion} now, so this attachment is the older version (artifact #${src.id})`
      : null;
    return { artifactId: r.id, title: r.title, stale };
  });
}

/**
 * "Deck.pdf (#12)", with the stale note when there is one. Pure.
 * @param list
 */
export function attachmentLine(list: readonly Attachment[]): string | undefined {
  if (list.length === 0) {
    return undefined;
  }
  return `Attaches ${list.map(a => `${a.title} (#${a.artifactId})${a.stale ? ` — ${a.stale}` : ''}`).join('; ')}`;
}

/**
 * Whether the synced thread shows the draft was sent: a message from the
 * mailbox after the draft was made. Null when no thread is synced for it.
 * @param orgId - The workspace.
 * @param run - The draft's run.
 * @param run.input - Its input.
 * @param run.at - When the draft was made.
 */
async function draftWasSent(orgId: string, run: { input: Record<string, unknown>; at: Date }): Promise<boolean | null> {
  const to = typeof run.input.to === 'string' ? run.input.to : '';
  const subject = typeof run.input.subject === 'string' ? run.input.subject : '';
  const threadId = typeof run.input.threadId === 'string' ? run.input.threadId : undefined;
  const thread = await findReplyThread(orgId, { ...(threadId ? { threadId } : {}), to, subject }).catch(() => null);
  if (!thread || (subject && bareSubject(thread.subject) !== bareSubject(subject) && thread.matchedBy !== 'id')) {
    return null;
  }
  const mailbox = (thread.mailbox ?? '').toLowerCase();
  return thread.messages.some(m => mailbox !== '' && m.from.toLowerCase().includes(mailbox) && new Date(m.at).getTime() > run.at.getTime());
}

/**
 * The latest meeting capture with the account.
 * @param orgId - The workspace.
 * @param identity - The account.
 * @param since - How far back.
 */
async function lastCall(orgId: string, identity: AccountIdentity, since: Date): Promise<MeetingCapture | null> {
  const rows = await db
    .select({ id: knowledgeDocumentSchema.id, externalId: knowledgeDocumentSchema.externalId, title: knowledgeDocumentSchema.title, metadata: knowledgeDocumentSchema.metadata, lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      inArray(sql<string>`${knowledgeDocumentSchema.metadata}->>'kind'`, Object.keys(MEETING_CAPTURE_KINDS)),
      gte(knowledgeDocumentSchema.lastModifiedAt, since),
    ))
    .orderBy(desc(knowledgeDocumentSchema.lastModifiedAt))
    .limit(200);
  const domains = new Set(identity.domains);
  const emails = new Set(identity.emails);
  const calls = rows
    .map(r => captureOf({ ...r, metadata: (r.metadata ?? {}) as Record<string, unknown> }))
    .filter((c): c is MeetingCapture => c !== null)
    .filter(c => c.attendees.some(a => emails.has(a) || domains.has(a.split('@')[1] ?? '')));
  calls.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  return calls[0] ?? null;
}

/**
 * Read everything owed on one account.
 * @param input - Where and what.
 * @param input.orgId - The workspace.
 * @param input.about - The account, as the person named it.
 * @param input.now - The clock.
 */
export async function readOwedOnAccount(input: { orgId: string; about: string; now?: Date }): Promise<OwedOnAccount> {
  const { orgId } = input;
  const now = input.now ?? new Date();
  const identity = await resolveAccount(orgId, input.about);
  const unavailable: string[] = [];
  const items: OwedItem[] = [];
  const artifacts: OwedArtifact[] = [];
  if (identity.domains.length === 0 && identity.emails.length === 0 && !identity.room) {
    return { identity, items, artifacts, unavailable: [`Nothing ties "${input.about}" to an address, a domain or a data room. Name the company's email domain or a contact's address.`] };
  }

  const since = new Date(now.getTime() - OWED_WINDOW_DAYS * 86_400_000);
  const draftSince = new Date(now.getTime() - DRAFT_WINDOW_DAYS * 86_400_000);

  // REVIEW and DRAFTS: action runs, any agent's.
  try {
    const runs = await db
      .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, status: actionRunSchema.status, input: actionRunSchema.input, result: actionRunSchema.result, error: actionRunSchema.error, invokedBy: actionRunSchema.invokedBy, proposal: actionRunSchema.proposal, createdAt: actionRunSchema.createdAt, executedAt: actionRunSchema.executedAt, decidedAt: actionRunSchema.decidedAt })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, orgId),
        inArray(actionRunSchema.status, ['pending', 'approved', 'failed', 'done']),
        gte(actionRunSchema.createdAt, since),
      ))
      .orderBy(desc(actionRunSchema.createdAt))
      .limit(2000);
    for (const r of runs) {
      const runInput = (r.input ?? {}) as Record<string, unknown>;
      if (!touchesAccount(runInput, identity)) {
        continue;
      }
      const by = (r.proposal as { agentSlug?: string } | null)?.agentSlug ?? (r.invokedBy?.startsWith('agent:') ? r.invokedBy.slice(6) : null);
      const title = typeof runInput.subject === 'string' && runInput.subject ? `${r.actionId}: ${runInput.subject}` : typeof runInput.title === 'string' && runInput.title ? `${r.actionId}: ${runInput.title}` : `${r.actionId} #${r.id}`;
      const at = r.executedAt ?? r.decidedAt ?? r.createdAt;
      if (r.status === 'done') {
        // Only an approved DRAFT is still owed: the person sends it.
        if (r.actionId !== 'gmail.send' || runInput.draft !== true || at < draftSince) {
          continue;
        }
        const sent = await draftWasSent(orgId, { input: runInput, at });
        if (sent === true) {
          continue;
        }
        const result = (r.result ?? {}) as Record<string, unknown>;
        const attached = await attachmentsOf(orgId, runInput).catch(() => []);
        items.push({
          section: 'draft',
          title,
          status: sent === null ? 'draft in Gmail (no synced thread shows it sent)' : 'draft in Gmail, not sent',
          next: 'send the Gmail draft',
          at,
          href: typeof result.link === 'string' ? result.link : 'https://mail.google.com/mail/#drafts',
          by,
          ...(attachmentLine(attached) ? { detail: attachmentLine(attached) } : {}),
        });
        continue;
      }
      const attached = await attachmentsOf(orgId, runInput).catch(() => []);
      const detail = [r.status === 'failed' && r.error ? `Failed: ${r.error.split('\n')[0]!.slice(0, 160)}` : null, attachmentLine(attached) ?? null].filter(Boolean).join(' · ');
      items.push({
        section: 'review',
        title,
        status: r.status,
        next: nextMoveFor({ actionId: r.actionId, status: r.status, input: runInput }),
        at,
        href: inboxHref('proposal', r.id),
        by,
        ...(detail ? { detail } : {}),
      });
    }
  } catch {
    unavailable.push('Review and drafts could not be read.');
  }

  // FOLLOW-UPS: tracker rows still owed, of any type but the room itself.
  try {
    const rows = await db
      .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata, createdAt: businessObjectSchema.createdAt })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), ne(businessObjectTypeSchema.slug, DATA_ROOM_TYPE), gte(businessObjectSchema.createdAt, since)))
      .orderBy(desc(businessObjectSchema.createdAt))
      .limit(2000);
    for (const r of rows) {
      if (!isOwedStatus(r.status) || !touchesAccount(r.metadata ?? {}, identity)) {
        continue;
      }
      items.push({ section: 'follow_up', title: r.title, status: r.status ?? 'open', next: 'do it, or mark it done', at: r.createdAt, href: `/dashboard/objects/${r.id}` });
    }
  } catch {
    unavailable.push('Follow-up rows could not be read.');
  }

  // THE ROOM: its open items, and its newest decks and documents.
  if (identity.room) {
    try {
      const detail = await getDataRoomDetail(orgId, identity.room.id);
      for (const a of detail?.items ?? []) {
        if (a.status !== 'open') {
          continue;
        }
        items.push({ section: 'room_item', title: a.title, status: 'open', next: 'answer it', at: a.createdAt, href: inboxHref('ask', a.id) });
      }
      for (const a of (detail?.artifacts ?? []).filter(x => x.kind === 'deck' || x.kind === 'document' || x.kind === 'file').slice(0, 6)) {
        artifacts.push({ id: a.id, kind: a.kind, title: a.title, updatedAt: a.updatedAt ?? a.createdAt, href: `/dashboard/artifacts/${a.id}` });
      }
    } catch {
      unavailable.push('The data room could not be read.');
    }
  }

  // THE LAST CALL, and whether its follow-up card exists.
  try {
    const call = await lastCall(orgId, identity, new Date(now.getTime() - MEETING_WINDOW_DAYS * 86_400_000));
    if (call) {
      const card = await followupCardFor(orgId, meetingKey(call)).catch(() => null);
      items.push({
        section: 'meeting',
        title: `Last call: ${call.title ?? 'meeting'}${call.start ? ` (${call.start.slice(0, 10)})` : ''}`,
        status: card ? `follow-up card ${card.status}` : 'no follow-up card',
        next: card ? (card.status === 'pending' ? 'approve the follow-up card' : 'see the follow-up it drafted (above)') : 'read the note (read_meeting_record once released) for its agreed next steps',
        at: call.changedAt ?? now,
        href: card ? inboxHref('proposal', card.id) : null,
        detail: `Document #${call.documentId} (${call.connector})`,
      });
    }
  } catch {
    unavailable.push('Meeting captures could not be read.');
  }

  // Drafts first (the person's own move), then Review, then the rest; oldest first in each.
  const order: Record<OwedItem['section'], number> = { draft: 0, review: 1, follow_up: 2, room_item: 3, meeting: 4 };
  items.sort((a, b) => order[a.section] - order[b.section] || a.at.getTime() - b.at.getTime());
  return { identity, items, artifacts, unavailable };
}
