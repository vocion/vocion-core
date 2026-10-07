/**
 * YOUR DAY — the personal brief (Vocion 5.0, phase 2b).
 *
 * A workspace brief says how one workspace is doing. A person in several wants
 * one page: what is waiting on them, everywhere, and what each workspace's own
 * brief led with. This composes exactly that and nothing new:
 *
 * - **Waiting on you** is the cross-workspace queue (`listInboxForUser`), the
 *   person's own rows first, each linking to the row in its workspace.
 * - **Your workspaces** is each reachable workspace's latest brief, by its
 *   headline (the brief's own one-sentence summary, else its title), dated
 *   and linked (principle 10). A workspace with no brief and nothing waiting
 *   is left out rather than listed as empty (`docs/design/reduction.md`).
 *
 * Stored as a briefing (principle 7: the noun is the brief) in the person's
 * personal workspace, the one place only they can open, so it lists on that
 * workspace's Briefings page with its history. One account at a time: a brief
 * stored in one account never carries another account's workspaces.
 */

import type { CrossWorkspaceInbox, CrossWorkspaceItem, InboxWorkspace } from '@/services/inbox/acrossWorkspaces';
import type { InboxItem } from '@/services/InboxService';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { DEFAULT_TIME_ZONE, formatDate } from '@/libs/time/zone';
import { briefingSchema } from '@/models/Schema';
import { listInboxForUser } from '@/services/inbox/acrossWorkspaces';
import { ensurePersonalProject } from '@/services/workspace/personalProject';
import { briefingHref } from './links';
import { replacesPrior } from './republish';
import { latestBriefing, parseStoredDocument } from './store';
import { briefingTitle } from './title';

/** Who publishes a personal brief: the same `job:<name>` shape every scheduled publisher uses. */
export const PERSONAL_BRIEF_PUBLISHER = 'job:personal-brief';

/** How many waiting rows the brief names. The rest are a count and a link. */
export const PERSONAL_BRIEF_TOP = 5;

/** One workspace's line in the brief. */
export type PersonalBriefWorkspace = {
  workspace: InboxWorkspace;
  /** Its latest brief, or null when it has none. */
  briefing: { id: number; title: string; headline: string; at: Date; href: string } | null;
  waiting: number;
  yours: number;
};

export type PersonalBrief = {
  title: string;
  at: Date;
  /** Open decisions across the account's workspaces, and how many are the person's own. */
  waiting: { total: number; yours: number; top: CrossWorkspaceItem[] };
  workspaces: PersonalBriefWorkspace[];
  /** Workspaces that could not be read, said in the brief rather than dropped. */
  unavailable: Array<{ workspace: InboxWorkspace; reason: string }>;
  markdown: string;
};

/**
 * What a brief leads with: its own one-sentence summary, else its title.
 * @param brief - A stored brief.
 * @param brief.title - Its title.
 * @param brief.document - Its typed document, if any.
 */
export function headlineOf(brief: { title: string; document: unknown }): string {
  const doc = parseStoredDocument(brief.document);
  return doc?.today?.summary?.trim() || brief.title;
}

/**
 * Each workspace's latest brief, in one query: the workspace rollup when there
 * is one, else its newest team brief. Personal briefs are never a workspace's
 * headline, or "your day" would quote yesterday's "your day".
 * @param workspaces - The workspaces.
 */
async function latestBriefs(workspaces: readonly Pick<InboxWorkspace, 'id'>[]): Promise<Map<string, { id: number; title: string; document: unknown; createdAt: Date }>> {
  if (workspaces.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([briefingSchema.orgId], { orgId: briefingSchema.orgId, id: briefingSchema.id, title: briefingSchema.title, document: briefingSchema.document, createdAt: briefingSchema.createdAt })
    .from(briefingSchema)
    .where(and(
      inArray(briefingSchema.orgId, workspaces.map(w => w.id)),
      sql`${briefingSchema.publishedBy} is distinct from ${PERSONAL_BRIEF_PUBLISHER}`,
    ))
    .orderBy(briefingSchema.orgId, sql`(${briefingSchema.teamSlug} is null) desc`, desc(briefingSchema.createdAt));
  return new Map(rows.map(r => [r.orgId, r]));
}

/**
 * The brief's words. Pure.
 * @param input - What it says.
 * @param input.waiting - The queue summary.
 * @param input.workspaces - Each workspace's line.
 * @param input.unavailable - What could not be read.
 * @param input.timeZone - For the dates.
 */
export function renderPersonalBrief(input: Pick<PersonalBrief, 'waiting' | 'workspaces' | 'unavailable'> & { timeZone: string }): string {
  const { waiting, timeZone } = input;
  const out: string[] = [];
  const places = new Set(waiting.top.map(i => i.workspace.id)).size;
  if (waiting.total === 0) {
    out.push('Nothing is waiting on you.');
  } else {
    out.push('## Waiting on you', '');
    const where = input.workspaces.filter(w => w.waiting > 0).length || places;
    out.push(`${waiting.yours > 0 ? `${waiting.yours} ${waiting.yours === 1 ? 'is' : 'are'} yours, ` : ''}${waiting.total} ${waiting.total === 1 ? 'decision' : 'decisions'} in all, across ${where} ${where === 1 ? 'workspace' : 'workspaces'}.`, '');
    for (const item of waiting.top) {
      out.push(`- [${item.title}](${item.href}) — ${item.workspace.name}${item.yours ? ', yours' : ''}, waiting since ${formatDate(item.at, timeZone)}`);
    }
    const rest = waiting.total - waiting.top.length;
    if (rest > 0) {
      out.push(`- and ${rest} more in the review queue`);
    }
  }
  const lines = input.workspaces.filter(w => w.briefing || w.waiting > 0);
  if (lines.length > 0) {
    out.push('', '## Your workspaces', '');
    for (const w of lines) {
      const brief = w.briefing
        ? `“${w.briefing.headline}” ([brief of ${formatDate(w.briefing.at, timeZone)}](${w.briefing.href}))`
        : 'no brief yet';
      out.push(`- **${w.workspace.name}** — ${brief}${w.waiting > 0 ? ` · ${w.waiting} waiting` : ''}`);
    }
  }
  if (input.unavailable.length > 0) {
    out.push('', `Could not read ${input.unavailable.map(u => `${u.workspace.name} (${u.reason})`).join(', ')}; what is above leaves them out.`);
  }
  return out.join('\n');
}

/**
 * Compose the person's brief for one account. Reads only.
 * @param userId - The person.
 * @param accountId - The account.
 * @param opts - Clock, zone and the inbox read (a seam for tests).
 * @param opts.now - The clock.
 * @param opts.timeZone - For the dates.
 * @param opts.read - One workspace's open rows.
 */
export async function composePersonalBrief(
  userId: string,
  accountId: string,
  opts: { now?: Date; timeZone?: string; read?: (orgId: string) => Promise<InboxItem[]> } = {},
): Promise<PersonalBrief> {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const inbox: CrossWorkspaceInbox = await listInboxForUser(userId, { accountId, ...(opts.read ? { read: opts.read } : {}) });
  const briefs = await latestBriefs(inbox.workspaces);
  const workspaces: PersonalBriefWorkspace[] = inbox.workspaces.map((w) => {
    const b = briefs.get(w.id);
    return {
      workspace: { id: w.id, slug: w.slug, name: w.name, kind: w.kind },
      briefing: b
        ? { id: b.id, title: b.title, headline: headlineOf(b), at: b.createdAt, href: workspaceUrl(w.slug, briefingHref(b.id), w.accountSlug ? { accountSlug: w.accountSlug } : {}) }
        : null,
      waiting: w.count,
      yours: w.yours,
    };
  });
  const waiting = { total: inbox.total, yours: inbox.yours, top: inbox.items.slice(0, PERSONAL_BRIEF_TOP) };
  return {
    title: briefingTitle('Your day', now, timeZone),
    at: now,
    waiting,
    workspaces,
    unavailable: inbox.unavailable,
    markdown: renderPersonalBrief({ waiting, workspaces, unavailable: inbox.unavailable, timeZone }),
  };
}

/**
 * Compose the brief and keep it in the person's personal workspace. A second
 * publish inside the republish window replaces the first rather than sitting
 * beside it (`republish.ts`), so asking twice is one brief.
 * @param userId - The person.
 * @param accountId - The account whose personal workspace keeps it.
 * @param opts - As {@link composePersonalBrief}.
 * @param opts.now - The clock.
 * @param opts.timeZone - For the dates.
 * @param opts.read - One workspace's open rows.
 * @returns The stored brief's id, where it lives, and what it says.
 */
export async function publishPersonalBrief(
  userId: string,
  accountId: string,
  opts: { now?: Date; timeZone?: string; read?: (orgId: string) => Promise<InboxItem[]> } = {},
): Promise<{ id: number; orgId: string; href: string; replaced: boolean; brief: PersonalBrief }> {
  const now = opts.now ?? new Date();
  const [personal, brief] = await Promise.all([
    ensurePersonalProject(userId, accountId),
    composePersonalBrief(userId, accountId, { ...opts, now }),
  ]);
  const values = { title: brief.title.slice(0, 200), content: brief.markdown, publishedBy: PERSONAL_BRIEF_PUBLISHER, agentSlug: null, teamSlug: null, document: null };
  const latest = await latestBriefing(personal.id, null);
  const href = (id: number) => workspaceUrl(personal.slug, briefingHref(id));
  if (latest && replacesPrior({ createdAt: latest.createdAt, publishedBy: latest.publishedBy }, PERSONAL_BRIEF_PUBLISHER, now)) {
    await db.update(briefingSchema).set({ ...values, createdAt: now }).where(and(eq(briefingSchema.orgId, personal.id), eq(briefingSchema.id, latest.id)));
    return { id: latest.id, orgId: personal.id, href: href(latest.id), replaced: true, brief };
  }
  const [row] = await db.insert(briefingSchema).values({ orgId: personal.id, ...values, createdAt: now }).returning({ id: briefingSchema.id });
  return { id: row!.id, orgId: personal.id, href: href(row!.id), replaced: false, brief };
}
