/**
 * waiting_on_me — what is waiting on the person asking, read from the records
 * that hold it, never searched for.
 *
 * On 2026-10-08 a founder's assistant asked each of his workspaces "what is
 * waiting on me today". One workspace's agent ran a knowledge search for
 * "open asks approvals waiting on <name>" and found nothing, which was wrong:
 * asks, proposals and follow-ups are rows with a status and an owner, and a
 * semantic search over documents cannot see a row. The answer exists exactly
 * once, in the typed tables, so this tool reads them:
 *
 * - **Decisions** — the workspace's open review queue after its admission bar
 *   (`needsYouItems`): asks, approvals and proposed actions. Each is tagged
 *   the person's own when it is assigned to them, raised by their turn, or
 *   sits in their personal workspace (`yoursBecause`), and the person's own
 *   come first, longest-waiting first — the same order the review queue reads.
 * - **Follow-ups** — asks the person raised that came back answered "other",
 *   so the asker owes a read and maybe a second ask (`ask.follow_up`).
 * - **Mentions** — the person's unread notifications in the workspace.
 *
 * Scope follows the workspace: in a shared workspace, that workspace; in the
 * person's personal workspace, every workspace they can switch to on that
 * account (`listInboxForUser`), so the assistant answers "across my
 * workspaces" with one read instead of one conversation per workspace.
 *
 * Identity is the turn's person (`ctx.userId`, from the signed claim over the
 * container), checked against the workspace on every call (`actAs`). No
 * person, no tool: a scheduled run has nobody for anything to be waiting on.
 */
import type { RuntimeContext } from '../types';
import type { CrossWorkspaceInbox, CrossWorkspaceItem, WorkspaceQueue } from '@/services/inbox/acrossWorkspaces';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { DEFAULT_TIME_ZONE, formatDate } from '@/libs/time/zone';
import { askSchema, notificationSchema } from '@/models/Schema';
import { listInboxForUser } from '@/services/inbox/acrossWorkspaces';
import { inboxHref } from '@/services/inbox/inboxRef';
import { needsYouItems } from '@/services/InboxService';
import { actAs } from '@/services/workspace/actAs';

/** How far back an answered-"other" ask still counts as a follow-up owed. */
export const FOLLOW_UP_WINDOW_DAYS = 14;

/** Rows named per section; the rest are a count. */
export const WAITING_TOP = 15;

type Place = Pick<WorkspaceQueue, 'id' | 'slug' | 'name' | 'accountSlug'>;

export type FollowUp = { id: number; title: string; note: string | null; at: Date; workspace: Place; href: string };
export type Mention = { id: number; title: string; body: string | null; at: Date; workspace: Place; href: string | null };

export type WaitingOnMe = {
  scope: 'workspace' | 'all';
  decisions: CrossWorkspaceItem[];
  /** Open decisions in reach, before the person's own were picked out. */
  totalOpen: number;
  followUps: FollowUp[];
  mentions: Mention[];
  unavailable: Array<{ workspace: { name: string }; reason: string }>;
};

/**
 * Read everything waiting on `userId`, in one workspace or across the account.
 * @param input - Who, where, and how wide.
 * @param input.userId - The person.
 * @param input.accountId - The account the workspace belongs to.
 * @param input.orgId - The workspace the turn runs in.
 * @param input.across - Every workspace on the account, not just this one.
 * @param input.now - The clock.
 * @param input.inbox - The cross-workspace queue, when the caller already read it (across only).
 */
export async function readWaitingOnMe(input: { userId: string; accountId: string; orgId: string; across: boolean; now?: Date; inbox?: CrossWorkspaceInbox }): Promise<WaitingOnMe> {
  const { userId, accountId, orgId, across } = input;
  const now = input.now ?? new Date();
  // One reader for both scopes: the cross-workspace queue already tags rows as
  // the person's, orders them and builds their links. In one workspace, only
  // that workspace's queue is read.
  const inbox = across && input.inbox
    ? input.inbox
    : await listInboxForUser(userId, {
        accountId,
        ...(across ? {} : { workspaceId: orgId, read: (id: string) => (id === orgId ? needsYouItems(id) : Promise.resolve([])) }),
      });
  const places: Place[] = inbox.workspaces.filter(w => across || w.id === orgId);
  const byId = new Map(places.map(p => [p.id, p]));
  const ids = [...byId.keys()];
  const decisions = inbox.items.filter(i => across || i.workspace.id === orgId);
  const totalOpen = across ? inbox.total : (inbox.workspaces.find(w => w.id === orgId)?.count ?? decisions.length);

  if (ids.length === 0) {
    return { scope: across ? 'all' : 'workspace', decisions, totalOpen, followUps: [], mentions: [], unavailable: inbox.unavailable };
  }

  const since = new Date(now.getTime() - FOLLOW_UP_WINDOW_DAYS * 86_400_000);
  const [askRows, noteRows] = await Promise.all([
    db
      .select({ id: askSchema.id, orgId: askSchema.orgId, title: askSchema.title, note: askSchema.decisionNote, decidedAt: askSchema.decidedAt, createdAt: askSchema.createdAt })
      .from(askSchema)
      .where(and(
        inArray(askSchema.orgId, ids),
        eq(askSchema.createdBy, userId),
        eq(askSchema.followUp, true),
        ne(askSchema.status, 'open'),
        gte(askSchema.decidedAt, since),
      ))
      .orderBy(desc(askSchema.decidedAt))
      .limit(WAITING_TOP),
    db
      .select({ id: notificationSchema.id, orgId: notificationSchema.orgId, title: notificationSchema.title, body: notificationSchema.body, link: notificationSchema.link, createdAt: notificationSchema.createdAt })
      .from(notificationSchema)
      .where(and(inArray(notificationSchema.orgId, ids), eq(notificationSchema.userId, userId), isNull(notificationSchema.readAt)))
      .orderBy(desc(notificationSchema.createdAt))
      .limit(WAITING_TOP),
  ]);

  const followUps: FollowUp[] = askRows.map((r) => {
    const w = byId.get(r.orgId)!;
    return { id: r.id, title: r.title, note: r.note, at: r.decidedAt ?? r.createdAt, workspace: w, href: workspaceUrl(w.slug, inboxHref('ask', r.id), w.accountSlug ? { accountSlug: w.accountSlug } : {}) };
  });
  const mentions: Mention[] = noteRows.map((r) => {
    const w = byId.get(r.orgId)!;
    return { id: r.id, title: r.title, body: r.body, at: r.createdAt, workspace: w, href: r.link };
  });
  return { scope: across ? 'all' : 'workspace', decisions, totalOpen, followUps, mentions, unavailable: inbox.unavailable };
}

/**
 * What the model reads: every section, each row with where it is, how long it
 * has waited and its link, in the order to take it. Pure.
 * @param w - The read.
 * @param tz - The person's zone, for the dates.
 */
export function renderWaitingOnMe(w: WaitingOnMe, tz: string = DEFAULT_TIME_ZONE): string {
  const yours = w.decisions.filter(d => d.yours);
  const others = w.decisions.filter(d => !d.yours);
  const where = (name: string) => (w.scope === 'all' ? ` — ${name}` : '');
  const out: string[] = [
    `Read from the review queue, asks and notifications just now${w.scope === 'all' ? ', across every workspace you can reach' : ', in this workspace'}. This is the complete list: do not search for more, and say "nothing" for an empty section rather than guessing.`,
  ];

  out.push('', yours.length > 0 ? `DECISIONS ON YOU (${yours.length}) — oldest first; take them in this order:` : 'DECISIONS ON YOU: none.');
  for (const d of yours.slice(0, WAITING_TOP)) {
    const why = d.yoursBecause === 'assigned' ? 'assigned to you' : d.yoursBecause === 'raised' ? 'your turn raised it' : 'in your workspace';
    out.push(`- [${d.title}](${d.link})${where(d.workspace.name)} · ${d.kind}${d.risk ? `, ${d.risk} risk` : ''} · ${why} · waiting since ${formatDate(d.at, tz)}`);
  }
  if (yours.length > WAITING_TOP) {
    out.push(`- and ${yours.length - WAITING_TOP} more in the review queue`);
  }

  out.push('', w.followUps.length > 0 ? `FOLLOW-UPS YOU OWE (${w.followUps.length}) — your asks that came back with a note to read:` : 'FOLLOW-UPS YOU OWE: none.');
  for (const f of w.followUps) {
    out.push(`- [${f.title}](${f.href})${where(f.workspace.name)} · answered ${formatDate(f.at, tz)}${f.note ? ` · “${f.note.replace(/\s+/g, ' ').slice(0, 140)}”` : ''}`);
  }

  out.push('', w.mentions.length > 0 ? `UNREAD MENTIONS AND NOTICES (${w.mentions.length}) — newest first:` : 'UNREAD MENTIONS AND NOTICES: none.');
  for (const m of w.mentions) {
    out.push(`- ${m.href ? `[${m.title}](${m.href})` : m.title}${where(m.workspace.name)} · ${formatDate(m.at, tz)}${m.body ? ` · ${m.body.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`);
  }

  if (others.length > 0) {
    out.push('', `ALSO OPEN, NOT ON YOU BY NAME (${w.totalOpen - yours.length}) — anyone in the workspace can take these:`);
    for (const d of others.slice(0, 5)) {
      out.push(`- [${d.title}](${d.link})${where(d.workspace.name)} · ${d.kind} · waiting since ${formatDate(d.at, tz)}`);
    }
  }
  if (w.unavailable.length > 0) {
    out.push('', `Could not read: ${w.unavailable.map(u => u.workspace.name).join(', ')}. Say so; what is above leaves them out.`);
  }
  return out.join('\n');
}

/**
 * The tool, present whenever a person is in the turn.
 * @param ctx - The turn.
 */
export function waitingOnMeTools(ctx: RuntimeContext) {
  if (!ctx.userId) {
    return [];
  }
  const userId = ctx.userId;
  const waitingOnMe = tool(
    async () => {
      const identity = await actAs(userId, ctx.orgId);
      if (!identity) {
        return 'Could not confirm who is asking in this workspace, so nothing was read. Say that plainly.';
      }
      const read = await readWaitingOnMe({ userId, accountId: identity.accountId, orgId: ctx.orgId, across: ctx.workspaceKind === 'personal' });
      return renderWaitingOnMe(read, ctx.timeZone ?? DEFAULT_TIME_ZONE);
    },
    {
      name: 'waiting_on_me',
      description: [
        'What is waiting on the person you are talking to, read from the records: decisions on them in the review queue (asks, approvals, proposed actions), follow-ups they owe on asks they raised, and their unread mentions and notices — each with a link and how long it has waited, in the order to take it.',
        'Call it for "what is waiting on me", "what do I need to do", "my approvals", "my asks", "anything for me" and the like. Never answer those from a knowledge search: these are records, and search cannot see them.',
        'In a personal workspace it covers every workspace the person can reach, in one call; there is no need to ask each workspace.',
      ].join(' '),
      schema: z.object({}),
    },
  );
  return [waitingOnMe];
}
