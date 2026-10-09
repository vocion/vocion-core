/**
 * What a personal brief (the morning "your day" or the evening wrap) is made
 * of, read from the records and the person's own connections — never
 * searched for, never made up (docs/guides/morning-brief.md). The composer
 * (`personal.ts`) renders these; nothing else does.
 *
 * Every read here is one the person could make themselves: their own
 * calendar and mail through their personal connections (`personalCredential`
 * refuses anyone else's), the workspaces they can switch to through the
 * cross-workspace queue (`readWaitingOnMe`), and those same workspaces'
 * records for what the team did and what a meeting is about. A read that
 * fails is said in the brief ("Calendar could not be read") rather than
 * dropped, so the brief never claims an empty day it did not check.
 */

import type { RhythmKind } from '@/libs/personal/rhythm';
import type { WaitingOnMe } from '@/services/agents/tools/waitingOnMe';
import type { CrossWorkspaceInbox } from '@/services/inbox/acrossWorkspaces';
import type { InboxItem } from '@/services/InboxService';
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { logger } from '@/libs/Logger';
import { calendarEvents, mailSearch } from '@/libs/personal/google';
import { dayKey, dayPlus, startOfDay } from '@/libs/time/zone';
import { askSchema, briefingSchema, missionRunSchema, userSchema } from '@/models/Schema';
import { readWaitingOnMe } from '@/services/agents/tools/waitingOnMe';
import { briefingHref } from '@/services/briefings/links';
import { listInboxForUser } from '@/services/inbox/acrossWorkspaces';
import { placeLabel } from '@/services/personal/acrossOrgs';
import { personalCredential } from '@/services/personal/connections';
import { personalReach } from '@/services/personal/reach';

/** One piece of evidence about a meeting, with where it came from. */
export type MeetingEvidence = { from: 'mail' | 'workspace'; text: string; where: string; href?: string | null };

export type Meeting = {
  id: string;
  title: string;
  start: Date | null;
  allDay: boolean;
  attendees: string[];
  evidence: MeetingEvidence[];
};

/** A day's meetings, or why they could not be read. */
export type MeetingsRead
  = | { status: 'read'; items: Meeting[] }
    | { status: 'unavailable'; why: string };

/** What one shared workspace did since the person last looked. */
export type TeamLine = {
  workspace: { id: string; name: string; slug: string };
  decided: number;
  runs: string[];
  briefs: Array<{ title: string; href: string }>;
};

export type PersonalFacts = {
  kind: RhythmKind;
  userId: string;
  accountId: string;
  personalOrgId: string;
  name: string | null;
  now: Date;
  timeZone: string;
  /** Today's meetings (brief), or tomorrow's first (wrap). */
  meetings: MeetingsRead;
  waiting: WaitingOnMe;
  /** Brief: what the team did since `since`. */
  team: TeamLine[];
  since: Date;
  /** Wrap: what the person decided today, across their workspaces. */
  doneToday: Array<{ title: string; href: string; workspace: string }>;
  /** Wrap: runs that finished today in their workspaces. */
  finishedToday: Array<{ title: string; workspace: string }>;
  /** The shared workspaces they reach, for meeting evidence. */
  workspaces: Array<{ id: string; name: string; slug: string }>;
  /** The cross-workspace queue, read once: the brief's "Your workspaces" lines come from it too. */
  inbox: CrossWorkspaceInbox;
};

/**
 * Whether a brief or wrap has anything to say: no meetings (or none read),
 * nothing waiting, nothing the team did and nothing done today means no
 * model call and no message.
 * @param f - The facts, without evidence.
 */
export function hasNothingToSay(f: PersonalFacts): boolean {
  const meetings = f.meetings.status === 'read' ? f.meetings.items.length : 0;
  const waiting = f.waiting.decisions.filter(d => d.yours).length + f.waiting.followUps.length + (f.waiting.views ?? []).reduce((n, v) => n + v.total, 0);
  return meetings === 0 && waiting === 0 && f.team.length === 0 && f.doneToday.length === 0 && f.finishedToday.length === 0;
}

/** How many meetings get evidence gathered; the rest are listed bare. */
const EVIDENCE_MEETINGS = 6;

/**
 * Meetings in a window, from the person's own calendar. One API call; the
 * evidence under each is gathered separately ({@link withMeetingEvidence}),
 * and only once the brief is known to be worth writing.
 * @param input - Who, where, and when.
 * @param input.userId - The person.
 * @param input.personalOrgId - Their Personal workspace.
 * @param input.from - Window start.
 * @param input.to - Window end.
 */
async function readMeetings(input: { userId: string; personalOrgId: string; from: Date; to: Date }): Promise<MeetingsRead> {
  const cal = await personalCredential({ orgId: input.personalOrgId, userId: input.userId, connector: 'google-calendar' });
  if (!cal.ok) {
    return { status: 'unavailable', why: cal.why };
  }
  let events: Awaited<ReturnType<typeof calendarEvents>>;
  try {
    events = await calendarEvents({ orgId: cal.orgId, values: cal.values }, input.from.toISOString(), input.to.toISOString());
  } catch (error) {
    logger.warn('personal brief: calendar read failed', { orgId: input.personalOrgId, errorName: error instanceof Error ? error.name : 'unknown' });
    const { isBrokenConnection } = await import('@/libs/personal/broken');
    if (isBrokenConnection(error)) {
      const { reportBrokenConnection } = await import('@/services/personal/urgent');
      await reportBrokenConnection({ orgId: input.personalOrgId, userId: input.userId, connector: 'google-calendar' });
      return { status: 'unavailable', why: 'Your Google Calendar connection stopped working. Connect it again from [Personal connectors](/dashboard/connectors).' };
    }
    return { status: 'unavailable', why: 'Your calendar could not be read just now.' };
  }
  const meetings: Meeting[] = events
    .filter(e => e.status !== 'cancelled')
    .map(e => ({
      id: e.id ?? `${e.summary}-${e.start?.dateTime ?? e.start?.date}`,
      title: e.summary ?? '(no title)',
      start: e.start?.dateTime ? new Date(e.start.dateTime) : null,
      allDay: !e.start?.dateTime,
      attendees: (e.attendees ?? []).map(a => a.email ?? '').filter(Boolean),
      evidence: [],
    }));
  return { status: 'read', items: meetings };
}

/**
 * Add a few pieces of evidence under each of today's meetings: the person's
 * recent mail with the people outside the Org in it, read through their own
 * Gmail, and what their workspaces' records say about its subject (a keyword
 * search, within their own source access). The costly half of the facts, so
 * it runs only for a brief that will be written.
 * @param f - The facts; their meetings gain evidence in place.
 */
export async function withMeetingEvidence(f: PersonalFacts): Promise<PersonalFacts> {
  if (f.meetings.status !== 'read' || f.meetings.items.length === 0) {
    return f;
  }
  const meetings = f.meetings.items;
  const mail = await personalCredential({ orgId: f.personalOrgId, userId: f.userId, connector: 'gmail' });
  const self = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, f.userId)).limit(1);
  const ownDomain = self[0]?.email?.split('@')[1]?.toLowerCase() ?? null;
  await Promise.all(meetings.filter(m => !m.allDay).slice(0, EVIDENCE_MEETINGS).map(async (m) => {
    // The people outside the Org say most about a meeting; inside, it is a standup.
    const outside = m.attendees.filter(a => a.split('@')[1]?.toLowerCase() !== ownDomain).slice(0, 3);
    if (mail.ok && outside.length > 0) {
      try {
        const hits = await mailSearch({ orgId: mail.orgId, values: mail.values }, `{${outside.map(a => `from:${a} to:${a}`).join(' ')}} newer_than:30d`, 2);
        for (const h of hits) {
          m.evidence.push({ from: 'mail', text: `${h.subject} — ${h.snippet}`.slice(0, 300), where: `mail from ${h.from}, ${h.date}` });
        }
      } catch {
        // Mail is one source of context among several; the meeting still lists.
      }
    }
    const domains = [...new Set(outside.map(a => a.split('@')[1]!.split('.')[0]!))];
    const query = [m.title, ...domains].join(' ');
    const { search } = await import('@/services/RetrievalService');
    const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
    for (const w of f.workspaces.slice(0, 5)) {
      try {
        const allowed = await allowedSourceSlugsForUser(w.id, f.userId);
        const [hit] = await search(query, { orgId: w.id, mode: 'keyword', k: 1, allowedSourceSlugs: allowed });
        if (hit) {
          m.evidence.push({ from: 'workspace', text: `${hit.title ?? ''} — ${hit.content}`.slice(0, 300), where: `${w.name} · ${hit.sourceSlug}`, href: hit.uri });
        }
      } catch {
        // A workspace that cannot be searched adds no evidence.
      }
    }
  }));
  return f;
}

/**
 * What each shared workspace did since `since`: decisions others took, runs
 * that finished, briefs published. Workspaces where nothing moved are left
 * out (reduction: less happened, a shorter brief).
 * @param userId - The person: their own decisions are not "the team's".
 * @param workspaces - The shared workspaces they reach.
 * @param since - When they last looked.
 */
async function readTeam(userId: string, workspaces: Array<{ id: string; name: string; slug: string; accountSlug?: string }>, since: Date): Promise<TeamLine[]> {
  if (workspaces.length === 0) {
    return [];
  }
  const ids = workspaces.map(w => w.id);
  const [decided, runs, briefs] = await Promise.all([
    db.select({ orgId: askSchema.orgId, n: sql<number>`count(*)::int` }).from(askSchema).where(and(inArray(askSchema.orgId, ids), gte(askSchema.decidedAt, since), isNotNull(askSchema.decidedBy), ne(askSchema.decidedBy, userId))).groupBy(askSchema.orgId),
    db.select({ orgId: missionRunSchema.orgId, title: missionRunSchema.title }).from(missionRunSchema).where(and(inArray(missionRunSchema.orgId, ids), eq(missionRunSchema.status, 'completed'), gte(missionRunSchema.completedAt, since))).orderBy(desc(missionRunSchema.completedAt)).limit(30),
    db.select({ orgId: briefingSchema.orgId, id: briefingSchema.id, title: briefingSchema.title }).from(briefingSchema).where(and(inArray(briefingSchema.orgId, ids), gte(briefingSchema.createdAt, since))).orderBy(desc(briefingSchema.createdAt)).limit(30),
  ]);
  return workspaces.map((w) => {
    const link = (path: string) => workspaceUrl(w.slug, path, w.accountSlug ? { accountSlug: w.accountSlug } : {});
    return {
      workspace: { id: w.id, name: w.name, slug: w.slug },
      decided: decided.find(d => d.orgId === w.id)?.n ?? 0,
      runs: runs.filter(r => r.orgId === w.id).slice(0, 3).map(r => r.title),
      briefs: briefs.filter(b => b.orgId === w.id).slice(0, 2).map(b => ({ title: b.title, href: link(briefingHref(b.id)) })),
    };
  }).filter(t => t.decided > 0 || t.runs.length > 0 || t.briefs.length > 0);
}

/**
 * Gather everything one brief or wrap says.
 * @param input - Who, which, and when.
 * @param input.kind - Brief or wrap.
 * @param input.userId - The person.
 * @param input.accountId - Their Org.
 * @param input.personalOrgId - Their Personal workspace.
 * @param input.timeZone - Their zone.
 * @param input.since - When they last looked (the last brief or wrap), for "since you last looked".
 * @param input.now - The clock.
 * @param input.read - One workspace's open rows (a seam for tests).
 */
export async function gatherPersonalFacts(input: { kind: RhythmKind; userId: string; accountId: string; personalOrgId: string; timeZone: string; since: Date; now: Date; read?: (orgId: string) => Promise<InboxItem[]> }): Promise<PersonalFacts> {
  const { kind, userId, accountId, personalOrgId, timeZone: tz, now } = input;
  // Every Org the person's one Personal reaches, in place (`services/personal/reach.ts`):
  // content from Orgs that include themselves, counts only from the rest.
  const inbox = await listInboxForUser(userId, { reach: await personalReach(userId), ...(input.read ? { read: input.read } : {}) });
  // Every item says where it lives; with several Orgs, which Org too.
  const multiOrg = new Set(inbox.workspaces.map(w => w.accountId)).size > 1;
  const shared = inbox.workspaces.filter(w => w.kind !== 'personal').map(w => ({ id: w.id, name: placeLabel(w, multiOrg), slug: w.slug, accountSlug: w.accountSlug }));
  const today = dayKey(now, tz);
  const window = kind === 'brief'
    ? { from: startOfDay(today, tz), to: startOfDay(dayPlus(today, 1), tz) }
    : { from: startOfDay(dayPlus(today, 1), tz), to: startOfDay(dayPlus(today, 2), tz) };
  const dayStart = startOfDay(today, tz);
  const [user, meetings, waiting, team, doneRows, finishedRows] = await Promise.all([
    db.select({ name: userSchema.name }).from(userSchema).where(eq(userSchema.id, userId)).limit(1),
    readMeetings({ userId, personalOrgId, ...window }),
    readWaitingOnMe({ userId, accountId, orgId: personalOrgId, across: true, now, inbox }),
    kind === 'brief' ? readTeam(userId, shared, input.since) : Promise.resolve([]),
    kind === 'wrap' && inbox.workspaces.length > 0
      ? db.select({ id: askSchema.id, orgId: askSchema.orgId, title: askSchema.title }).from(askSchema).where(and(inArray(askSchema.orgId, inbox.workspaces.map(w => w.id)), eq(askSchema.decidedBy, userId), gte(askSchema.decidedAt, dayStart))).orderBy(desc(askSchema.decidedAt)).limit(10)
      : Promise.resolve([]),
    kind === 'wrap' && shared.length > 0
      ? db.select({ orgId: missionRunSchema.orgId, title: missionRunSchema.title }).from(missionRunSchema).where(and(inArray(missionRunSchema.orgId, shared.map(w => w.id)), eq(missionRunSchema.status, 'completed'), gte(missionRunSchema.completedAt, dayStart))).orderBy(desc(missionRunSchema.completedAt)).limit(10)
      : Promise.resolve([]),
  ]);
  const byId = new Map(inbox.workspaces.map(w => [w.id, w]));
  const { inboxHref } = await import('@/services/inbox/inboxRef');
  return {
    kind,
    userId,
    accountId,
    personalOrgId,
    name: user[0]?.name ?? null,
    now,
    timeZone: tz,
    meetings,
    waiting,
    team,
    since: input.since,
    doneToday: doneRows.map((r) => {
      const w = byId.get(r.orgId)!;
      return { title: r.title, workspace: w.name, href: workspaceUrl(w.slug, inboxHref('ask', r.id), w.accountSlug ? { accountSlug: w.accountSlug } : {}) };
    }),
    finishedToday: finishedRows.map(r => ({ title: r.title, workspace: byId.get(r.orgId)?.name ?? '' })),
    workspaces: shared.map(w => ({ id: w.id, name: w.name, slug: w.slug })),
    inbox,
  };
}
