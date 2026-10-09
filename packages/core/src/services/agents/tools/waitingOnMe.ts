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
import type { ReachedOrg } from '@/services/personal/reach';
import type { StateRow } from '@/services/state/state';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { handlesOf } from '@/libs/retrieval/facets';
import { DEFAULT_TIME_ZONE, formatDate } from '@/libs/time/zone';
import { askSchema, notificationSchema, userSchema } from '@/models/Schema';
import { listInboxForUser } from '@/services/inbox/acrossWorkspaces';
import { inboxHref } from '@/services/inbox/inboxRef';
import { needsYouItems } from '@/services/InboxService';
import { personalReach } from '@/services/personal/reach';
import { actAs } from '@/services/workspace/actAs';

/** How far back an answered-"other" ask still counts as a follow-up owed. */
export const FOLLOW_UP_WINDOW_DAYS = 14;

/** Rows named per section; the rest are a count. */
export const WAITING_TOP = 15;

type Place = Pick<WorkspaceQueue, 'id' | 'slug' | 'name' | 'accountSlug'> & { accountName?: string };

export type FollowUp = { id: number; title: string; note: string | null; at: Date; workspace: Place; href: string };
export type Mention = { id: number; title: string; body: string | null; at: Date; workspace: Place; href: string | null };
/** One saved view's read, as a section of "what is waiting on me" (`services/state/state.ts`). */
export type ViewSection = { slug: string; name: string; description: string; rows: Array<StateRow & { workspace: Place }>; total: number };

/** Rows named per view section; the full list is `query_state` with the view. */
export const VIEW_TOP = 10;

/** The view every person's read carries: the email replies they owe. */
export const OWED_REPLIES_VIEW = 'owed-replies';

export type WaitingOnMe = {
  scope: 'workspace' | 'all';
  decisions: CrossWorkspaceItem[];
  /** Open decisions in reach, before the person's own were picked out. */
  totalOpen: number;
  followUps: FollowUp[];
  mentions: Mention[];
  /**
   * Saved views read for the person: the email replies they owe (the core
   * `owed-replies` view, their own mailbox only), then every view they put in
   * their brief.
   */
  views: ViewSection[];
  unavailable: Array<{ workspace: { name: string }; reason: string }>;
  /** From a Personal: Orgs that keep their items out of it, as counts with a link (`services/personal/reach.ts`). */
  withheld?: CrossWorkspaceInbox['withheld'];
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
 * @param input.reach
 */
export async function readWaitingOnMe(input: { userId: string; accountId: string; orgId: string; across: boolean; now?: Date; inbox?: CrossWorkspaceInbox; reach?: readonly ReachedOrg[] }): Promise<WaitingOnMe> {
  const { userId, accountId, orgId, across } = input;
  const now = input.now ?? new Date();
  // One reader for both scopes: the cross-workspace queue already tags rows as
  // the person's, orders them and builds their links. In one workspace, only
  // that workspace's queue is read.
  // Across, from a Personal: every Org the person's Personal reaches, in
  // place, with their own access in each (`services/personal/reach.ts`). In
  // one workspace, only that workspace's queue is read.
  const inbox = across && input.inbox
    ? input.inbox
    : across
      ? await listInboxForUser(userId, { reach: input.reach ?? await personalReach(userId) })
      : await listInboxForUser(userId, { accountId, workspaceId: orgId, read: (id: string) => (id === orgId ? needsYouItems(id) : Promise.resolve([])) });
  const places: Place[] = inbox.workspaces.filter(w => across || w.id === orgId);
  const byId = new Map(places.map(p => [p.id, p]));
  const ids = [...byId.keys()];
  const decisions = inbox.items.filter(i => across || i.workspace.id === orgId);
  const totalOpen = across ? inbox.total : (inbox.workspaces.find(w => w.id === orgId)?.count ?? decisions.length);

  if (ids.length === 0) {
    return { scope: across ? 'all' : 'workspace', decisions, totalOpen, followUps: [], mentions: [], views: [], unavailable: inbox.unavailable, withheld: inbox.withheld };
  }

  const since = new Date(now.getTime() - FOLLOW_UP_WINDOW_DAYS * 86_400_000);
  const [askRows, noteRows, owed] = await Promise.all([
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
    readViews(userId, places, inbox.workspaces.find(w => w.id === orgId)?.accountId ?? accountId, now),
  ]);

  const followUps: FollowUp[] = askRows.map((r) => {
    const w = byId.get(r.orgId)!;
    return { id: r.id, title: r.title, note: r.note, at: r.decidedAt ?? r.createdAt, workspace: w, href: workspaceUrl(w.slug, inboxHref('ask', r.id), w.accountSlug ? { accountSlug: w.accountSlug } : {}) };
  });
  const mentions: Mention[] = noteRows.map((r) => {
    const w = byId.get(r.orgId)!;
    return { id: r.id, title: r.title, body: r.body, at: r.createdAt, workspace: w, href: r.link };
  });
  return { scope: across ? 'all' : 'workspace', decisions, totalOpen, followUps, mentions, views: owed, unavailable: inbox.unavailable, withheld: inbox.withheld };
}

/**
 * The views read for the person, in every place in reach: the core
 * `owed-replies` view (its filter is the person's own mailbox — a shared
 * workspace's mail source may be someone else's inbox, and their owed replies
 * are not this person's), then the views they marked for their brief. Never
 * throws; views are one section of the read.
 * @param userId - The person.
 * @param places - The workspaces in reach.
 * @param accountId - Their Org.
 * @param now - The clock.
 */
async function readViews(userId: string, places: Place[], accountId: string, now: Date): Promise<ViewSection[]> {
  try {
    const [{ runStateQuery }, { briefViews, viewBySlug }] = await Promise.all([import('@/services/state/state'), import('@/services/state/state')]);
    const [person] = await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
    const me = person ? handlesOf(person) : [];
    const owed = places.length > 0 ? await viewBySlug(OWED_REPLIES_VIEW, { orgId: places[0]!.id, accountId, userId }) : undefined;
    const own = await briefViews(userId, places.map(p => p.id));
    const wanted = [...(owed ? [{ view: owed, orgIds: places.map(p => p.id) }] : []), ...own.filter(v => v.slug !== OWED_REPLIES_VIEW).map(v => ({ view: v, orgIds: [v.orgId] }))];
    const sections: ViewSection[] = [];
    for (const { view, orgIds } of wanted) {
      const reads = await Promise.all(orgIds.map(async (id) => {
        const p = places.find(x => x.id === id)!;
        return { p, read: await runStateQuery({ ...view.query, limit: VIEW_TOP }, { orgIds: [id], userId, me, now }) };
      }));
      sections.push({
        slug: view.slug,
        name: view.name,
        description: view.description,
        rows: reads.flatMap(({ p, read }) => read.rows.map(r => ({ ...r, workspace: p }))).slice(0, VIEW_TOP),
        total: reads.reduce((n, r) => n + r.read.total, 0),
      });
    }
    return sections;
  } catch {
    return [];
  }
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
  // Every item says where it lives; with more than one Org, which Org too.
  const orgs = new Set(w.decisions.map(d => d.workspace.accountName).filter(Boolean));
  const orgOf = new Map(w.decisions.map(d => [d.workspace.name, d.workspace.accountName]));
  const where = (name: string, org?: string) => {
    if (w.scope !== 'all') {
      return '';
    }
    const o = org ?? orgOf.get(name);
    return orgs.size > 1 && o && o !== name ? ` — ${name} · ${o}` : ` — ${name}`;
  };
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
    out.push(`- [${f.title}](${f.href})${where(f.workspace.name, f.workspace.accountName)} · answered ${formatDate(f.at, tz)}${f.note ? ` · “${f.note.replace(/\s+/g, ' ').slice(0, 140)}”` : ''}`);
  }

  out.push('', w.mentions.length > 0 ? `UNREAD MENTIONS AND NOTICES (${w.mentions.length}) — newest first:` : 'UNREAD MENTIONS AND NOTICES: none.');
  for (const m of w.mentions) {
    out.push(`- ${m.href ? `[${m.title}](${m.href})` : m.title}${where(m.workspace.name, m.workspace.accountName)} · ${formatDate(m.at, tz)}${m.body ? ` · ${m.body.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`);
  }

  for (const v of w.views) {
    const label = v.slug === OWED_REPLIES_VIEW ? 'EMAIL REPLIES YOU OWE' : v.name.toUpperCase();
    out.push('', v.rows.length > 0 ? `${label} (${v.total}) — ${v.description}` : `${label}: none.`);
    for (const r of v.rows) {
      const who = typeof r.facets.counterpart === 'string' ? ` — ${r.facets.counterpart}` : '';
      const ask = typeof r.facets.ask === 'string' && r.facets.ask ? ` · ${r.facets.ask}` : '';
      out.push(`- ${r.link ? `[${r.title}](${r.link})` : r.title}${who}${where(r.workspace.name, r.workspace.accountName)}${r.at ? ` · ${formatDate(r.at, tz)}` : ''}${ask}`);
    }
    if (v.total > v.rows.length) {
      out.push(`- and ${v.total - v.rows.length} more: query_state with view "${v.slug}" lists them all`);
    }
  }

  if (others.length > 0) {
    out.push('', `ALSO OPEN, NOT ON YOU BY NAME (${w.totalOpen - yours.length}) — anyone in the workspace can take these:`);
    for (const d of others.slice(0, 5)) {
      out.push(`- [${d.title}](${d.link})${where(d.workspace.name)} · ${d.kind} · waiting since ${formatDate(d.at, tz)}`);
    }
  }
  if (w.withheld && w.withheld.length > 0) {
    out.push('', 'IN ORGS THAT KEEP THEIR ITEMS OUT OF PERSONAL — counts only; say the number and give the link, never guess what they are:');
    for (const h of w.withheld) {
      out.push(`- ${h.accountName} › ${h.workspace.name}: ${h.count} waiting${h.yours ? ` (${h.yours} on you)` : ''} · [open there](${h.link})`);
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
      // A read that does not change within a turn: a repeat is answered from the first (`runtimeContext.ts`, turn evidence).
      metadata: { turnMemo: true },
      description: [
        'What is waiting on the person you are talking to, read from the records: decisions on them in the review queue (asks, approvals, proposed actions), follow-ups they owe on asks they raised, email replies they owe from their own mailbox, and their unread mentions and notices — each with a link and how long it has waited, in the order to take it.',
        'Call it for "what is waiting on me", "what do I need to do", "my approvals", "my asks", "anything for me" and the like. Never answer those from a knowledge search: these are records, and search cannot see them.',
        'In a personal workspace it covers every workspace the person can reach, in one call; there is no need to ask each workspace.',
      ].join(' '),
      schema: z.object({}),
    },
  );
  return [waitingOnMe];
}
